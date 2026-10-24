'use client';

import { useCallback, useEffect, useState } from 'react';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import type { WikiNote, WikiNoteReport } from '@/types/wiki';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin, errorsStats } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { commonMessages } from '@/i18n/messages/common';

type ApiPayload<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string; params?: Record<string, string | number> };

/** A failed moderation request; carries the API body so it can be shown in the viewer's language. */
class ModerationRequestError extends Error {
  constructor(readonly apiError: ApiErrorLike) {
    super(apiError.error ?? 'Moderation request failed');
    this.name = 'ModerationRequestError';
  }
}

async function readApi<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json() as ApiPayload<T>;
  if (!payload.success) throw new ModerationRequestError(toApiErrorLike(payload));
  return payload.data;
}

async function writeApi<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await response.json() as ApiPayload<T>;
  if (!payload.success) throw new ModerationRequestError(toApiErrorLike(payload));
  return payload.data;
}

type PanelErrorKey = 'wiki.loadFailed' | 'wiki.actionFailed';

/** A failed request, translated at render: the API body, or a local message. */
type PanelError = { api: ApiErrorLike; fallback: PanelErrorKey } | { local: PanelErrorKey };

/** Message key of a report reason: `other` is a reserved plural key, so it is stored as `otherReason`. */
export function reportReasonKey(reason: string): string {
  return reason === 'other' ? 'otherReason' : reason;
}

/** Only an approved note is live, so only a report on one can be answered by unpublishing the note. */
export function canUnpublishReportedNote(report: WikiNoteReport): boolean {
  return report.note?.approved === true;
}

/**
 * The request that takes a note out of public view: the admin reject PATCH (audited as `wiki.note.reject`).
 * An empty reason is omitted: the route stores null (no reason). No UI shows the stored reason today; one that
 * does labels null in the viewer's language (legacy English defaults map via engine-labels).
 */
export function noteRejectRequest(noteId: string, reason?: string): { url: string; init: RequestInit } {
  const trimmed = reason?.trim();
  return {
    url: `/api/wiki/notes/${noteId}`,
    init: {
      method: 'PATCH',
      body: JSON.stringify(trimmed ? { rejected: true, rejection_reason: trimmed } : { rejected: true }),
    },
  };
}

function toPanelError(e: unknown, fallback: PanelErrorKey): PanelError {
  if (e instanceof ModerationRequestError) return { api: e.apiError, fallback };
  if (e instanceof TypeError) return { api: toApiErrorLike(e), fallback };
  return { local: fallback };
}

export default function WikiModerationPanel() {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  const apiErrorText = useApiErrorText(errorsAdmin, errorsStats);

  const [notes, setNotes] = useState<WikiNote[]>([]);
  const [reports, setReports] = useState<WikiNoteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PanelError | null>(null);
  const [rejecting, setRejecting] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingNotes, openReports] = await Promise.all([
        readApi<WikiNote[]>('/api/admin/wiki/notes?status=pending&limit=50'),
        readApi<WikiNoteReport[]>('/api/admin/wiki/reports?status=open&limit=50'),
      ]);
      setNotes(pendingNotes);
      setReports(openReports);
    } catch (err) {
      setError(toPanelError(err, 'wiki.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs one moderation write; a failure is shown instead of escaping as an unhandled rejection. */
  async function write(url: string, init: RequestInit): Promise<boolean> {
    try {
      await writeApi(url, init);
      return true;
    } catch (err) {
      setError(toPanelError(err, 'wiki.actionFailed'));
      return false;
    }
  }

  /** Runs one moderation write, then reloads. */
  async function moderate(url: string, init: RequestInit) {
    if (await write(url, init)) await load();
  }

  async function approveNote(noteId: string) {
    await moderate(`/api/wiki/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify({ approved: true }),
    });
  }

  async function rejectNote(noteId: string) {
    const { url, init } = noteRejectRequest(noteId, rejecting[noteId]);
    await moderate(url, init);
  }

  /**
   * Unpublishes a reported, approved note and closes the report as reviewed. The report is closed only after the
   * note write succeeded; if closing fails, the note stays unpublished and the report stays open.
   */
  async function unpublishReportedNote(report: WikiNoteReport) {
    if (!report.note) return;
    const noteId = report.note.id;
    const { url, init } = noteRejectRequest(noteId, rejecting[noteId]);
    if (!(await write(url, init))) return;
    const closed = await write(`/api/admin/wiki/reports/${report.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'reviewed' }),
    });
    if (closed) {
      await load();
      return;
    }
    setReports((current) =>
      current.map((r) => (r.note?.id === noteId && r.note ? { ...r, note: { ...r.note, approved: false } } : r)),
    );
  }

  async function deleteNote(noteId: string) {
    await moderate(`/api/wiki/notes/${noteId}`, { method: 'DELETE' });
  }

  async function closeReport(reportId: string, status: 'reviewed' | 'dismissed') {
    await moderate(`/api/admin/wiki/reports/${reportId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  const errorText =
    error === null
      ? null
      : 'local' in error
        ? t(error.local)
        : error.api.error || error.api.code
          ? apiErrorText(error.api)
          : t(error.fallback);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold text-poke-text-primary">{t('wiki.pendingNotes')}</h2>
          <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            {tc('actions.refresh')}
          </Button>
        </div>

        {errorText && <p className="text-sm text-poke-danger-ink">{errorText}</p>}
        {loading && <p className="text-sm text-poke-text-secondary">{t('wiki.loading')}</p>}
        {!loading && notes.length === 0 && <p className="text-sm text-poke-text-secondary">{t('wiki.noPending')}</p>}

        <div className="space-y-3">
          {notes.map((note) => (
            <Card key={note.id} padding="md">
              <div className="flex flex-wrap items-center gap-2 text-xs text-poke-text-secondary">
                <span className="font-mono">{note.entity_type}:{note.entity_name}</span>
                {note.author_name && <span>{t('wiki.by', { name: note.author_name })}</span>}
                {note.moderation_flags && note.moderation_flags.length > 0 && (
                  <span className="text-yellow-500">{t('wiki.flags', { flags: note.moderation_flags.join(', ') })}</span>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-poke-text-primary">{note.content}</p>
              <textarea
                value={rejecting[note.id] ?? ''}
                onChange={(event) => setRejecting((current) => ({ ...current, [note.id]: event.target.value }))}
                placeholder={t('wiki.rejectionReason')}
                rows={2}
                maxLength={500}
                className="mt-4 w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-poke-accent"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void approveNote(note.id)}>{t('wiki.approve')}</Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void rejectNote(note.id)}>{t('wiki.reject')}</Button>
                <Button type="button" size="sm" variant="danger" onClick={() => void deleteNote(note.id)}>{tc('actions.delete')}</Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-poke-text-primary">{t('wiki.openReports')}</h2>
        {!loading && reports.length === 0 && <p className="text-sm text-poke-text-secondary">{t('wiki.noReports')}</p>}
        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id} padding="sm" variant="outlined">
              <div className="text-xs text-poke-text-secondary">
                <span className="font-mono">{report.note?.entity_type}:{report.note?.entity_name}</span>
                {report.reporter_name && <span className="ml-2">{t('wiki.by', { name: report.reporter_name })}</span>}
              </div>
              <p className="mt-2 text-sm font-semibold text-poke-text-primary">
                {t.dynamic(`wiki.reportReasons.${reportReasonKey(report.reason)}`, undefined, report.reason)}
              </p>
              {report.details && <p className="mt-1 text-sm text-poke-text-secondary">{report.details}</p>}
              {report.note?.content && (
                <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-poke-text-secondary">{report.note.content}</p>
              )}
              {report.note && (
                <p className="mt-2 text-xs font-medium text-poke-text-secondary">
                  {report.note.approved ? t('wiki.noteLive') : t('wiki.noteHidden')}
                </p>
              )}
              {report.note && canUnpublishReportedNote(report) && (
                <textarea
                  value={rejecting[report.note.id] ?? ''}
                  onChange={(event) => {
                    const noteId = report.note?.id;
                    if (noteId) setRejecting((current) => ({ ...current, [noteId]: event.target.value }));
                  }}
                  placeholder={t('wiki.rejectionReason')}
                  rows={2}
                  maxLength={500}
                  className="mt-3 w-full rounded-poke-md border border-poke-border bg-poke-surface px-3 py-2 text-sm text-poke-text-primary focus:outline-none focus:ring-2 focus:ring-poke-accent"
                />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canUnpublishReportedNote(report) && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => void unpublishReportedNote(report)}>
                    {t('wiki.unpublish')}
                  </Button>
                )}
                <Button type="button" size="sm" variant="secondary" onClick={() => void closeReport(report.id, 'reviewed')}>
                  {t('wiki.reviewed')}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void closeReport(report.id, 'dismissed')}>
                  {t('wiki.dismiss')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
