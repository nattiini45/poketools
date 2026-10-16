'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsStats } from '@/i18n/messages/errors/stats';
import { wikiMessages } from '@/i18n/messages/wiki';
import type { WikiNote, WikiEntityType } from '@/types/wiki';

/** Report reasons the API accepts; labels come from `wiki.notes.reasons.<reason>`. */
const REPORT_REASONS = ['inaccurate', 'spam', 'abusive', 'off_topic', 'other'] as const;
type ReportReason = (typeof REPORT_REASONS)[number];

/** Message key of each reason (`other` is a reserved plural-form key, so it maps to `otherReason`). */
const REPORT_REASON_KEYS = {
  inaccurate: 'inaccurate',
  spam: 'spam',
  abusive: 'abusive',
  off_topic: 'off_topic',
  other: 'otherReason',
} as const satisfies Record<ReportReason, string>;

/**
 * What to show after a failed request: the API's error (rendered in the viewer's language), or one of this
 * form's own messages. Stored as data, never as translated text, so a language switch re-renders it.
 */
type NoteFeedback =
  | { kind: 'api'; error: ApiErrorLike }
  | { kind: 'message'; key: 'submitFailed' | 'submitFailedRetry' | 'reportFailed' | 'reportFailedRetry' | 'reportSubmitted' };

interface WikiNotesSectionProps {
  entityType: WikiEntityType;
  entityName: string;
  notes: WikiNote[];
  /** When true, notes are hidden and a sign-in CTA is shown */
  unauthenticated?: boolean;
}

function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value);
}

/** The failed response as an `ApiErrorLike`, or null when it carries neither an `error` nor a `code`. */
function apiFailure(json: { error?: unknown; code?: unknown; params?: unknown }): ApiErrorLike | null {
  const like = toApiErrorLike(json);
  return like.error || like.code ? like : null;
}

function WikiNotesSignInPrompt() {
  const t = useT(wikiMessages);
  return (
    <div className="space-y-3">
      <h2 className="font-heading text-sm font-semibold text-poke-text-secondary uppercase tracking-wide">
        {t('notes.title')}
      </h2>
      <p className="text-sm text-poke-text-muted">{t('notes.signInPrompt')}</p>
      <Link
        href="/api/auth/signin"
        className="inline-block text-sm font-heading font-semibold text-poke-accent hover:underline"
      >
        {t('notes.signIn')}
      </Link>
    </div>
  );
}

function WikiNotesAuthenticated({
  entityType,
  entityName,
  notes,
}: Omit<WikiNotesSectionProps, 'unauthenticated'>) {
  const t = useT(wikiMessages);
  const formatter = useFormatter();
  const apiErrorText = useApiErrorText(errorsStats);
  const [localNotes] = useState<WikiNote[]>(notes);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<NoteFeedback | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [reportingNoteId, setReportingNoteId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>('inaccurate');
  const [reportDetails, setReportDetails] = useState('');
  const [reportMessage, setReportMessage] = useState<NoteFeedback | null>(null);

  const feedbackText = (feedback: NoteFeedback): string =>
    feedback.kind === 'api' ? apiErrorText(feedback.error) : t(`notes.${feedback.key}`);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/wiki/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_type: entityType,
          entity_name: entityName,
          content: content.trim(),
        }),
      });

      const json = await res.json() as { success: boolean; error?: string; code?: string; params?: unknown };

      if (!json.success) {
        const failure = apiFailure(json);
        setError(failure ? { kind: 'api', error: failure } : { kind: 'message', key: 'submitFailed' });
        return;
      }

      setContent('');
      setSubmitted(true);
    } catch {
      setError({ kind: 'message', key: 'submitFailedRetry' });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReport(noteId: string) {
    setReportMessage(null);
    try {
      const res = await fetch(`/api/wiki/notes/${noteId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        }),
      });
      const json = await res.json() as { success: boolean; error?: string; code?: string; params?: unknown };
      if (!json.success) {
        const failure = apiFailure(json);
        setReportMessage(failure ? { kind: 'api', error: failure } : { kind: 'message', key: 'reportFailed' });
        return;
      }
      setReportingNoteId(null);
      setReportDetails('');
      setReportReason('inaccurate');
      setReportMessage({ kind: 'message', key: 'reportSubmitted' });
    } catch {
      setReportMessage({ kind: 'message', key: 'reportFailedRetry' });
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="font-heading text-lg font-bold text-poke-text-primary">
        {t('notes.title')}
      </h2>

      {/* Existing notes */}
      {localNotes.length > 0 ? (
        <div className="space-y-3">
          {localNotes.map((note) => (
            <div
              key={note.id}
              className="bg-poke-surface rounded-poke-md p-4 shadow-poke-sm border border-poke-border"
            >
              <p className="font-body text-sm text-poke-text-primary leading-relaxed">
                {note.content}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-poke-text-secondary font-body">
                {note.author_name && <span>{t('notes.byAuthor', { name: note.author_name })}</span>}
                <span>
                  {formatter.instant(note.created_at, 'date')}
                </span>
                <button
                  type="button"
                  onClick={() => setReportingNoteId(reportingNoteId === note.id ? null : note.id)}
                  className="ml-auto text-poke-text-secondary hover:text-poke-accent"
                >
                  {t('notes.report')}
                </button>
              </div>
              {reportingNoteId === note.id && (
                <div className="mt-3 space-y-2 border-t border-poke-border pt-3">
                  <select
                    value={reportReason}
                    onChange={(event) => {
                      if (isReportReason(event.target.value)) setReportReason(event.target.value);
                    }}
                    className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-xs text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-poke-accent"
                  >
                    {REPORT_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {t(`notes.reasons.${REPORT_REASON_KEYS[reason]}`)}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder={t('notes.reportDetails')}
                    className="w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-xs text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-poke-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void submitReport(note.id)}
                    className="px-3 py-1 rounded-poke-md bg-poke-muted text-xs font-heading font-semibold text-poke-text-secondary hover:bg-poke-accent/20"
                  >
                    {t('notes.submitReport')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-poke-text-secondary font-body">{t('notes.empty')}</p>
      )}

      {/* Submission form */}
      {submitted ? (
        <div className="bg-poke-surface rounded-poke-md p-4 border border-poke-border">
          <p className="font-body text-sm text-poke-text-primary">{t('notes.submitted')}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('notes.placeholder')}
            maxLength={2000}
            rows={3}
            className="w-full px-4 py-2.5 rounded-poke-md bg-poke-surface border border-poke-border
                       text-poke-text-primary font-body text-sm placeholder:text-poke-text-secondary
                       focus:outline-none focus:ring-2 focus:ring-poke-accent resize-y"
          />
          {error && (
            <p className="text-xs text-poke-danger-ink font-body" role="alert">{feedbackText(error)}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-poke-text-secondary font-body">
              {content.length}/2000
            </span>
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="px-4 py-1.5 rounded-poke-md bg-poke-accent text-poke-surface text-sm font-heading font-semibold
                         hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? t('notes.submitting') : t('notes.submit')}
            </button>
          </div>
        </form>
      )}

      {reportMessage && (
        <p className="text-xs text-poke-text-secondary font-body">{feedbackText(reportMessage)}</p>
      )}
    </div>
  );
}

export default function WikiNotesSection({
  entityType,
  entityName,
  notes,
  unauthenticated = false,
}: WikiNotesSectionProps) {
  if (unauthenticated) {
    return <WikiNotesSignInPrompt />;
  }

  return (
    <WikiNotesAuthenticated
      entityType={entityType}
      entityName={entityName}
      notes={notes}
    />
  );
}
