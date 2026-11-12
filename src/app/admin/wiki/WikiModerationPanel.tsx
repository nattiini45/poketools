'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import SkewChip from '@/components/ui/SkewChip';
import Textarea from '@/components/ui/Textarea';
import AdminDialog from '@/components/admin/AdminDialog';
import AdminEmpty from '@/components/admin/AdminEmpty';
import AdminSectionHeading from '@/components/admin/AdminSectionHeading';
import { TOUCH } from '@/components/admin/admin-table';
import { cn } from '@/lib/utils/cn';
import type { WikiNote, WikiNoteReport } from '@/types/wiki';
import { useT } from '@/i18n/client';
import { useApiErrorText } from '@/i18n/use-api-error';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { errorsAdmin, errorsStats } from '@/i18n/messages/errors';
import { adminToolsMessages } from '@/i18n/messages/admin-tools';
import { commonMessages } from '@/i18n/messages/common';
import { noteModerationMachine, noteModerationState } from '@/lib/wiki/note-moderation-state';
import { noteReportMachine } from '@/lib/wiki/note-report-state';

/** One inbox item: a note or a report on its own hairline plate. */
const ITEM = 'rounded-poke-lg border border-hairline bg-surface p-4';

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

type SeenNote = Pick<WikiNote, 'approved' | 'rejected_at' | 'resubmission_blocked_at'> & { updated_at?: string };

/** Whether the machine offers the admin `event` from the note's state. */
function offers(note: SeenNote, event: string, actor: 'admin' | 'superadmin' = 'admin'): boolean {
  return noteModerationMachine.transitionsFrom(noteModerationState(note), actor).some((t) => t.event === event);
}

/** Only an approved note is live, so only a report on one can be answered by unpublishing the note. */
export function canUnpublishReportedNote(report: WikiNoteReport): boolean {
  return report.note !== undefined && offers(report.note, 'unpublish');
}

/** The state and version the moderator saw, so the route applies the verdict only to that note (compare-and-set). */
function seenFields(note: SeenNote | undefined): Record<string, string> {
  if (!note?.updated_at) return {};
  return { expected_state: noteModerationState(note), expected_updated_at: note.updated_at };
}

/** The approve PATCH for the note the moderator saw. */
export function noteApproveRequest(noteId: string, seen?: SeenNote): { url: string; init: RequestInit } {
  return {
    url: `/api/wiki/notes/${noteId}`,
    init: { method: 'PATCH', body: JSON.stringify({ approved: true, ...seenFields(seen) }) },
  };
}

/**
 * The request that takes a note out of public view: the admin reject PATCH (audited as `wiki.note.reject`).
 * An empty reason is omitted: the route stores null (no reason). No UI shows the stored reason today; one that
 * does labels null in the viewer's language (legacy English defaults map via engine-labels). `seen` is the note as
 * the moderator loaded it.
 */
export function noteRejectRequest(noteId: string, reason?: string, seen?: SeenNote): { url: string; init: RequestInit } {
  const trimmed = reason?.trim();
  return {
    url: `/api/wiki/notes/${noteId}`,
    init: {
      method: 'PATCH',
      body: JSON.stringify({
        rejected: true,
        ...(trimmed ? { rejection_reason: trimmed } : {}),
        ...seenFields(seen),
      }),
    },
  };
}

/** The superadmin's request that closes (`block`) or reopens a rejected note for resubmission. */
export function noteBlockRequest(noteId: string, block: boolean): { url: string; init: RequestInit } {
  return {
    url: `/api/wiki/notes/${noteId}`,
    init: { method: 'PATCH', body: JSON.stringify({ block_resubmission: block }) },
  };
}

function isBlocked(note: WikiNote): boolean {
  return noteModerationState(note) === 'blocked';
}

/** Only the superadmin may block, and only a rejected note that is not blocked yet. */
export function canBlockResubmission(note: WikiNote, isSuperadmin: boolean): boolean {
  return isSuperadmin && offers(note, 'block', 'superadmin');
}

/** Only the superadmin may lift a block. */
export function canAllowResubmission(note: WikiNote, isSuperadmin: boolean): boolean {
  return isSuperadmin && offers(note, 'unblock', 'superadmin');
}

interface RejectedNoteCardProps {
  note: WikiNote;
  isSuperadmin: boolean;
  onApprove: (note: WikiNote) => void;
  onDelete: (noteId: string) => void;
  onBlock: (noteId: string) => void;
  onAllow: (noteId: string) => void;
}

/** A rejected note in the moderation panel; the block actions show to the superadmin only. */
export function RejectedNoteCard({ note, isSuperadmin, onApprove, onDelete, onBlock, onAllow }: RejectedNoteCardProps) {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  return (
    <article className={ITEM}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
        <span className="break-all font-mono">{note.entity_type}:{note.entity_name}</span>
        {note.author_name && <span>{t('wiki.by', { name: note.author_name })}</span>}
        {isBlocked(note) && <SkewChip tone="loss">{t('wiki.blocked')}</SkewChip>}
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-body text-fg">{note.content}</p>
      {isBlocked(note) && <p className="mt-2 text-caption text-fg-muted">{t('wiki.blockedHint')}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {offers(note, 'approve') && (
          <Button type="button" size="sm" className={TOUCH} onClick={() => onApprove(note)}>{t('wiki.approve')}</Button>
        )}
        {canBlockResubmission(note, isSuperadmin) && (
          <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => onBlock(note.id)}>
            {t('wiki.blockResubmission')}
          </Button>
        )}
        {canAllowResubmission(note, isSuperadmin) && (
          <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => onAllow(note.id)}>
            {t('wiki.allowResubmission')}
          </Button>
        )}
        <Button type="button" size="sm" variant="danger" className={TOUCH} onClick={() => onDelete(note.id)}>{tc('actions.delete')}</Button>
      </div>
    </article>
  );
}

/** A moderator can close an open report as reviewed or dismissed (a closed one is no longer listed). */
export function canCloseReport(report: WikiNoteReport, to: 'reviewed' | 'dismissed'): boolean {
  return report.status !== to && noteReportMachine.nextStates(report.status, 'admin').includes(to);
}

function toPanelError(e: unknown, fallback: PanelErrorKey): PanelError {
  if (e instanceof ModerationRequestError) return { api: e.apiError, fallback };
  if (e instanceof TypeError) return { api: toApiErrorLike(e), fallback };
  return { local: fallback };
}

export default function WikiModerationPanel({ isSuperadmin = false }: { isSuperadmin?: boolean }) {
  const t = useT(adminToolsMessages);
  const tc = useT(commonMessages);
  const apiErrorText = useApiErrorText(errorsAdmin, errorsStats);

  const [notes, setNotes] = useState<WikiNote[]>([]);
  const [reports, setReports] = useState<WikiNoteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<PanelError | null>(null);
  const [rejecting, setRejecting] = useState<Record<string, string>>({});
  const [view, setView] = useState<'pending' | 'rejected'>('pending');
  const [blockTarget, setBlockTarget] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pendingNotes, openReports] = await Promise.all([
        readApi<WikiNote[]>(`/api/admin/wiki/notes?status=${view}&limit=50`),
        readApi<WikiNoteReport[]>('/api/admin/wiki/reports?status=open&limit=50'),
      ]);
      setNotes(pendingNotes);
      setReports(openReports);
    } catch (err) {
      setError(toPanelError(err, 'wiki.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [view]);

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

  async function approveNote(note: WikiNote) {
    const { url, init } = noteApproveRequest(note.id, note);
    await moderate(url, init);
  }

  async function rejectNote(note: WikiNote) {
    const { url, init } = noteRejectRequest(note.id, rejecting[note.id], note);
    await moderate(url, init);
  }

  /**
   * Unpublishes a reported, approved note and closes the report as reviewed. The report is closed only after the
   * note write succeeded; if closing fails, the note stays unpublished and the report stays open.
   */
  async function unpublishReportedNote(report: WikiNoteReport) {
    if (!report.note) return;
    const noteId = report.note.id;
    const { url, init } = noteRejectRequest(noteId, rejecting[noteId], report.note);
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

  async function confirmBlock() {
    if (!blockTarget) return;
    const { url, init } = noteBlockRequest(blockTarget, true);
    setBlocking(true);
    try {
      await moderate(url, init);
    } finally {
      setBlocking(false);
      setBlockTarget(null);
    }
  }

  async function allowResubmission(noteId: string) {
    const { url, init } = noteBlockRequest(noteId, false);
    await moderate(url, init);
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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <section aria-labelledby="wiki-notes-title" aria-busy={loading} className="min-w-0">
        <AdminSectionHeading
          id="wiki-notes-title"
          icon="old-amber"
          title={view === 'pending' ? t('wiki.pendingNotes') : t('wiki.rejectedNotes')}
          aside={!loading && notes.length > 0 && <SkewChip tone="tier-1">{notes.length}</SkewChip>}
        />
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            className={TOUCH}
            variant={view === 'pending' ? 'primary' : 'secondary'}
            aria-pressed={view === 'pending'}
            onClick={() => setView('pending')}
          >
            {t('wiki.viewPending')}
          </Button>
          <Button
            type="button"
            size="sm"
            className={TOUCH}
            variant={view === 'rejected' ? 'primary' : 'secondary'}
            aria-pressed={view === 'rejected'}
            onClick={() => setView('rejected')}
          >
            {t('wiki.viewRejected')}
          </Button>
          <Button type="button" variant="secondary" size="sm" className={cn(TOUCH, 'sm:ml-auto')} onClick={() => void load()} disabled={loading}>
            {tc('actions.refresh')}
          </Button>
        </div>

        {errorText && <Alert variant="error" className="mb-3">{errorText}</Alert>}
        {loading && <p className="text-body text-fg-muted">{t('wiki.loading')}</p>}
        {!loading && notes.length === 0 && (
          view === 'pending' ? (
            <AdminEmpty title={t('wiki.allCaughtUp')} hint={t('wiki.noPending')} icon="old-amber" />
          ) : (
            <AdminEmpty title={t('wiki.noRejected')} icon="old-amber" />
          )
        )}

        <div className="space-y-3">
          {view === 'rejected' && notes.map((note) => (
            <RejectedNoteCard
              key={note.id}
              note={note}
              isSuperadmin={isSuperadmin}
              onApprove={(target) => void approveNote(target)}
              onDelete={(noteId) => void deleteNote(noteId)}
              onBlock={setBlockTarget}
              onAllow={(noteId) => void allowResubmission(noteId)}
            />
          ))}
          {view === 'pending' && notes.map((note) => (
            <article key={note.id} className={ITEM}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
                <span className="break-all font-mono">{note.entity_type}:{note.entity_name}</span>
                {note.author_name && <span>{t('wiki.by', { name: note.author_name })}</span>}
                {note.moderation_flags && note.moderation_flags.length > 0 && (
                  <SkewChip tone="tier-1">{t('wiki.flags', { flags: note.moderation_flags.join(', ') })}</SkewChip>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-body text-fg">{note.content}</p>
              <div className="mt-4">
                <Textarea
                  aria-label={t('wiki.rejectionReason')}
                  value={rejecting[note.id] ?? ''}
                  onChange={(event) => setRejecting((current) => ({ ...current, [note.id]: event.target.value }))}
                  placeholder={t('wiki.rejectionReason')}
                  rows={2}
                  maxLength={500}
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {offers(note, 'approve') && (
                  <Button type="button" size="sm" className={TOUCH} onClick={() => void approveNote(note)}>{t('wiki.approve')}</Button>
                )}
                {offers(note, 'reject') && (
                  <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => void rejectNote(note)}>{t('wiki.reject')}</Button>
                )}
                <Button type="button" size="sm" variant="danger" className={TOUCH} onClick={() => void deleteNote(note.id)}>{tc('actions.delete')}</Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="wiki-reports-title" aria-busy={loading} className="min-w-0">
        <AdminSectionHeading
          id="wiki-reports-title"
          icon="scope-lens"
          title={t('wiki.openReports')}
          aside={!loading && reports.length > 0 && <SkewChip tone="loss">{reports.length}</SkewChip>}
        />
        {!loading && reports.length === 0 && (
          <AdminEmpty title={t('wiki.allCaughtUp')} hint={t('wiki.noReports')} icon="scope-lens" />
        )}
        <div className="space-y-3">
          {reports.map((report) => (
            <article key={report.id} className={ITEM}>
              <div className="text-caption text-fg-muted">
                <span className="break-all font-mono">{report.note?.entity_type}:{report.note?.entity_name}</span>
                {report.reporter_name && <span className="ml-2">{t('wiki.by', { name: report.reporter_name })}</span>}
              </div>
              <p className="mt-2 text-subtitle text-fg">
                {t.dynamic(`wiki.reportReasons.${reportReasonKey(report.reason)}`, undefined, report.reason)}
              </p>
              {report.details && <p className="mt-1 break-words text-body text-fg-muted">{report.details}</p>}
              {report.note?.content && (
                <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-poke-md border border-hairline bg-sunken p-3 text-caption text-fg-muted">
                  {report.note.content}
                </p>
              )}
              {report.note && (
                <p className="mt-2 text-caption font-medium text-fg-muted">
                  {report.note.approved ? t('wiki.noteLive') : t('wiki.noteHidden')}
                </p>
              )}
              {report.note && canUnpublishReportedNote(report) && (
                <div className="mt-3">
                  <Textarea
                    aria-label={t('wiki.rejectionReason')}
                    value={rejecting[report.note.id] ?? ''}
                    onChange={(event) => {
                      const noteId = report.note?.id;
                      if (noteId) setRejecting((current) => ({ ...current, [noteId]: event.target.value }));
                    }}
                    placeholder={t('wiki.rejectionReason')}
                    rows={2}
                    maxLength={500}
                  />
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {canUnpublishReportedNote(report) && (
                  <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => void unpublishReportedNote(report)}>
                    {t('wiki.unpublish')}
                  </Button>
                )}
                {canCloseReport(report, 'reviewed') && (
                  <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => void closeReport(report.id, 'reviewed')}>
                    {t('wiki.reviewed')}
                  </Button>
                )}
                {canCloseReport(report, 'dismissed') && (
                  <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => void closeReport(report.id, 'dismissed')}>
                    {t('wiki.dismiss')}
                  </Button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <AdminDialog open={blockTarget !== null} onClose={() => setBlockTarget(null)} title={t('wiki.blockDialog.title')} size="sm">
        <p className="mb-5 text-body text-fg-muted">{t('wiki.blockDialog.message')}</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" className={TOUCH} onClick={() => setBlockTarget(null)} disabled={blocking}>
            {tc('actions.cancel')}
          </Button>
          <Button variant="danger" className={TOUCH} onClick={() => void confirmBlock()} loading={blocking}>
            {t('wiki.blockDialog.confirm')}
          </Button>
        </div>
      </AdminDialog>
    </div>
  );
}
