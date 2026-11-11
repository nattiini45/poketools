'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsStats } from '@/i18n/messages/errors/stats';
import { wikiMessages } from '@/i18n/messages/wiki';
import type { WikiNote, WikiEntityType } from '@/types/wiki';
import { useSignInHref } from '@/components/shared/use-sign-in-href';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import SkewPlate from '@/components/ui/SkewPlate';
import Textarea from '@/components/ui/Textarea';
import { WikiEmptyState, WikiSection } from '@/components/wiki/WikiParts';

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

function WikiNotesSignInLink({ href }: { href: string }) {
  const t = useT(wikiMessages);
  return (
    <Link href={href} className="inline-block self-start rounded-poke-sm">
      <SkewPlate variant="button" className="min-h-11 px-5">
        {t('notes.signIn')}
      </SkewPlate>
    </Link>
  );
}

function WikiNotesSignInLinkForPage() {
  return <WikiNotesSignInLink href={useSignInHref()} />;
}

function WikiNotesSignInPrompt() {
  const t = useT(wikiMessages);
  return (
    <WikiSection title={t('notes.title')}>
      <p className="text-body text-fg-muted">{t('notes.signInPrompt')}</p>
      <Suspense fallback={<WikiNotesSignInLink href="/auth/signin" />}>
        <WikiNotesSignInLinkForPage />
      </Suspense>
    </WikiSection>
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
    <WikiSection title={t('notes.title')}>
      {/* Existing notes */}
      {localNotes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {localNotes.map((note) => (
            <li key={note.id} className="rounded-poke-lg border border-hairline bg-surface p-4">
              <p className="max-w-[72ch] whitespace-pre-line text-body text-fg">{note.content}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
                {note.author_name && <span>{t('notes.byAuthor', { name: note.author_name })}</span>}
                <span>
                  {formatter.instant(note.created_at, 'date')}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-expanded={reportingNoteId === note.id}
                  onClick={() => setReportingNoteId(reportingNoteId === note.id ? null : note.id)}
                  className="ml-auto max-md:min-h-11"
                >
                  {t('notes.report')}
                </Button>
              </div>
              {reportingNoteId === note.id && (
                <div className="mt-3 flex flex-col gap-3 border-t border-hairline pt-3">
                  <Select
                    aria-label={t('notes.report')}
                    value={reportReason}
                    onChange={(event) => {
                      if (isReportReason(event.target.value)) setReportReason(event.target.value);
                    }}
                    className="sm:max-w-xs"
                  >
                    {REPORT_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {t(`notes.reasons.${REPORT_REASON_KEYS[reason]}`)}
                      </option>
                    ))}
                  </Select>
                  <Textarea
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder={t('notes.reportDetails')}
                    aria-label={t('notes.reportDetails')}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void submitReport(note.id)}
                    className="self-start max-md:min-h-11"
                  >
                    {t('notes.submitReport')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <WikiEmptyState title={t('notes.emptyTitle')} hint={t('notes.empty')} />
      )}

      {/* Submission form */}
      {submitted ? (
        <p role="status" className="rounded-poke-lg border border-hairline bg-surface p-4 text-body text-fg">
          {t('notes.submitted')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('notes.placeholder')}
            aria-label={t('notes.submit')}
            maxLength={2000}
            rows={3}
          />
          {error && (
            <p className="text-caption text-poke-danger-ink" role="alert">{feedbackText(error)}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-caption tabular-nums text-fg-muted">
              {content.length}/2000
            </span>
            <Button type="submit" disabled={submitting || !content.trim()} className="max-md:min-h-11">
              {submitting ? t('notes.submitting') : t('notes.submit')}
            </Button>
          </div>
        </form>
      )}

      {reportMessage && (
        <p role="status" className="text-caption text-fg-muted">{feedbackText(reportMessage)}</p>
      )}
    </WikiSection>
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
