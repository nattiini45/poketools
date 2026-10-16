'use client';

/**
 * The secret drop submission (draft-frontend §6.1; SPEC:700-765).
 *
 * One row per own line: checkbox, price refund and the real KOs that would
 * transfer (self-earned only). Participation and no-redraft lines are locked. A hard
 * cap of `submission.max` lines. **Save** sends the full set (PUT), **Withdraw
 * all** sends `[]`. The redraft budget preview is `leftover_budget` + Σ refunds.
 * After the deadline (or once the server says `locked`) the panel is read-only.
 *
 * State holds line ids, the DTO and the `ApiErrorLike`, never translated text.
 */
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { LocalTime, RelativeTime } from '@/i18n/LocalTime';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { draftRedraftMessages } from '@/i18n/messages/draft/redraft';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { glossaryMessages } from '@/i18n/messages/glossary';
import type { DraftLineCatalog } from '@/lib/draft-finder/line-catalog';
import { formatCountdown } from '@/lib/draft-ui/clock';
import type { DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId, RedraftSubmissionDTO } from '@/types/draft-queue';
import { entriesById, makeLineLabel, makePreEvolutionLabel } from './line-label';
import { refundOf, sameLineSet, toOwnLineVMs } from './own-lines';
import type { RedraftSource } from './redraft-source';
import { useServerNow } from './use-server-now';

export interface RedraftSubmissionPanelProps {
  vm: DraftViewModel;
  catalog: DraftLineCatalog;
  submission: RedraftSubmissionDTO;
  source: RedraftSource;
  /** `useDraftSnapshot().serverOffsetMs`; the countdown runs on the server clock. */
  serverOffsetMs?: number;
}

const BUTTON =
  'min-h-[44px] rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-poke-focus';

export default function RedraftSubmissionPanel({
  vm,
  catalog,
  submission: initial,
  source,
  serverOffsetMs = 0,
}: RedraftSubmissionPanelProps) {
  const t = useT(draftRedraftMessages);
  const tShared = useT(draftSharedMessages);
  const tGlossary = useT(glossaryMessages);
  const f = useFormatter();
  const dl = useDataLocale();
  const errorText = useApiErrorText(errorsDraft);
  const headingId = useId();
  const noteId = useId();

  const [submission, setSubmission] = useState<RedraftSubmissionDTO>(initial);
  const [chosen, setChosen] = useState<ReadonlySet<LineId>>(() => new Set(initial.line_ids));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiErrorLike | null>(null);
  const [lockedByServer, setLockedByServer] = useState(false);

  const now = useServerNow(serverOffsetMs);
  const deadlineMs = Date.parse(submission.deadline_at);
  const remainingMs = now === null || !Number.isFinite(deadlineMs) ? null : deadlineMs - now;
  const locked =
    submission.locked || lockedByServer || vm.redraft?.phase !== 'submissions' || (remainingMs !== null && remainingMs <= 0);

  const byId = useMemo(() => entriesById(catalog), [catalog]);
  const label = useMemo(() => makeLineLabel(byId, dl), [byId, dl]);
  const preEvolutions = useMemo(() => makePreEvolutionLabel(byId, dl), [byId, dl]);
  const lines = useMemo(() => toOwnLineVMs(submission, catalog), [submission, catalog]);
  const refund = refundOf(lines, chosen);
  const dirty = !sameLineSet(submission.line_ids, chosen);
  const atCap = chosen.size >= submission.max;

  // Unsaved changes: the browser asks before leaving (its own text; none of ours).
  useEffect(() => {
    if (!dirty || locked) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty, locked]);

  const toggle = useCallback(
    (lineId: LineId) => {
      setError(null);
      setChosen((prev) => {
        const next = new Set(prev);
        if (next.has(lineId)) next.delete(lineId);
        else if (next.size < submission.max) next.add(lineId);
        return next;
      });
    },
    [submission.max],
  );

  const submit = useCallback(
    async (lineIds: LineId[]) => {
      setSaving(true);
      setError(null);
      const result = await source.putSubmission(lineIds);
      setSaving(false);
      if (result.ok) {
        setSubmission(result.data);
        setChosen(new Set(result.data.line_ids));
        return;
      }
      if (result.error.code === 'SUBMISSION_LOCKED') setLockedByServer(true);
      setError(result.error);
    },
    [source],
  );

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-xl border border-poke-border bg-poke-card p-4">
      <header className="flex flex-col gap-1">
        <h2 id={headingId} className="text-lg font-bold">
          {t('panel.title')}
        </h2>
        <p className="text-sm text-poke-text-secondary">{t('panel.intro', { max: submission.max })}</p>
        <p className="text-sm">
          <span className="font-semibold">{tGlossary('draft.deadline')}: </span>
          <LocalTime value={submission.deadline_at} preset="weekdayDateTime" zone="both" />
          {!locked && remainingMs !== null ? (
            <span className="ml-2 tabular-nums text-poke-text-secondary">
              {t('panel.timeLeft', { time: formatCountdown(remainingMs, 'slow', f, tShared) })}
            </span>
          ) : null}
        </p>
      </header>

      {locked ? (
        <p role="status" className="rounded-lg border border-poke-border bg-poke-surface p-3 text-sm">
          {t('lockedAfterDeadline')}
        </p>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-sm text-poke-text-secondary">{t('panel.noLines')}</p>
      ) : (
        <fieldset disabled={locked || saving} aria-describedby={noteId} className="flex min-w-0 flex-col gap-2">
          <legend className="sr-only">{t('panel.listLabel')}</legend>
          <p className="text-sm font-semibold tabular-nums" aria-live="polite">
            {t('counter', { n: chosen.size, max: submission.max })}
          </p>
          <ul className="flex flex-col gap-2">
            {lines.map((line) => {
              const checked = chosen.has(line.lineId);
              const blocked = line.locked !== null;
              return (
                <li key={line.lineId}>
                  <label
                    className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
                      checked ? 'border-poke-accent bg-poke-accent-light' : 'border-poke-border'
                    } ${blocked ? 'opacity-70' : 'cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked || (!checked && atCap)}
                      onChange={() => toggle(line.lineId)}
                      className="h-4 w-4 accent-current"
                    />
                    <span className="flex flex-1 flex-col">
                      <span className="font-semibold">{label(line.lineId)}</span>
                      {blocked ? (
                        <span className="flex items-center gap-1 text-xs text-poke-text-secondary">
                          <Lock aria-hidden="true" className="h-3 w-3" />
                          {line.locked === 'cosmog'
                            ? t('locked.cosmog', { line: preEvolutions(line.lineId) })
                            : t('locked.noRedraft')}
                        </span>
                      ) : (
                        <span className="text-xs text-poke-text-secondary">
                          {t('panel.kosTransfer', { count: line.realKills })}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums">{t('panel.refund', { n: line.price })}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {atCap && !locked ? (
            <p className="text-xs text-poke-text-secondary">{t('panel.capReached', { max: submission.max })}</p>
          ) : null}
        </fieldset>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <p className="font-semibold tabular-nums">
          {t('budgetPreview', {
            n: submission.leftover_budget + refund,
            left: submission.leftover_budget,
            refund,
          })}
        </p>
        <p className="text-xs text-poke-text-secondary">{t('tokenNote')}</p>
      </div>

      <div id={noteId} className="flex flex-col gap-1 text-sm" role="status">
        {dirty && !locked ? (
          <p className="font-semibold text-poke-amber-ink">{t('unsaved')}</p>
        ) : submission.updated_at ? (
          <p>
            {t('saved')} <RelativeTime value={submission.updated_at} />
          </p>
        ) : null}
        {!dirty && submission.line_ids.length === 0 ? (
          <p className="text-poke-text-secondary">{t('panel.nothingChosen')}</p>
        ) : null}
        <p className="text-xs text-poke-text-secondary">{t('secretNote')}</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-poke-amber-ink">
          {errorText(error)}
        </p>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${BUTTON} bg-poke-accent text-poke-surface hover:bg-poke-accent-strong`}
            disabled={saving || !dirty}
            onClick={() => void submit([...chosen])}
          >
            {saving ? t('saving') : t('save')}
          </button>
          <button
            type="button"
            className={`${BUTTON} border border-poke-border`}
            disabled={saving || (submission.line_ids.length === 0 && chosen.size === 0)}
            onClick={() => void submit([])}
          >
            {t('withdrawAll')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
