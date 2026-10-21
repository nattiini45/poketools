'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type {
  SubstituteApplyError,
  SubstitutePartialApply,
  SubstituteSkippedMatch,
  SubstituteSummary,
} from '@/lib/season/substitute';
import type { ApiResponse, ApiResult } from '@/types/api';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import { useLocale, useT } from '@/i18n/client';
import { createTranslator } from '@/i18n/core';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { useApiErrorText } from '@/i18n/use-api-error';
import { errorsSeasons } from '@/i18n/messages/errors/seasons';
import { leagueRosterMessages } from '@/i18n/messages/league-roster';
import type { LeagueRosterT } from './LeagueRosterManager';

/** English step lines for `describeSubstitutePartial` when no translator is passed (tests). */
const EN_ROSTER_T: LeagueRosterT = createTranslator(leagueRosterMessages, 'en');

/** Rich-text renderer for the `<b>` tags of the dialog's sentences. */
const bold = (chunks: ReactNode) => <strong className="text-poke-text-primary">{chunks}</strong>;

interface SubstituteDialogProps {
  seasonId: string;
  outPlayerId: string;
  outPlayerName: string;
  inPlayerId: string;
  inPlayerName: string;
  scope: 'league' | string;
  open: boolean;
  onClose: () => void;
  /** Reload the roster: after an apply, failed ones included (a failed apply keeps the steps before the failure). */
  onSuccess: () => void;
}

/**
 * Whether confirming the preview would change anything. A phase-scope
 * preview with no phase to move is rejected by the server (`OUT_NOT_IN_PHASE`);
 * this keeps Confirm off for any preview that would write nothing.
 */
export function substitutePreviewHasWork(preview: SubstituteSummary): boolean {
  return preview.roster_swapped || preview.phases.length > 0 || preview.affected_matches.length > 0;
}

/** A stable description of what a preview would do, to compare two of them. */
function previewKey(preview: SubstituteSummary): string {
  return JSON.stringify({
    roster: preview.roster_swapped,
    phases: preview.phases.map((phase) => [phase.phase_id, phase.group?.id ?? null]),
    matches: preview.affected_matches.map((match) => match.match_id).sort(),
  });
}

/**
 * After a failed apply that brought no partial signal back (the request
 * itself failed, so the server's answer is unknown): did it write part of the
 * substitution? The preview checked again after the failure lists only what
 * is still open, so any difference from the preview that was confirmed is
 * what the apply wrote. When the server answers, its signal is exact and
 * these guesses are not used (see `applySubstitute`).
 */
export function substituteApplyWasPartial(
  confirmed: SubstituteSummary,
  recheck: SubstituteSummary,
): boolean {
  return previewKey(confirmed) !== previewKey(recheck);
}

/**
 * After a failed apply whose re-checked preview equals the confirmed one: may
 * it still have written something? Two steps leave the preview as it was. The
 * group step hands the outgoing player's group row over, and the re-check then
 * finds the same group on the incoming player's row; cancelling a match's
 * pending proposals leaves the match listed until its repair lands. So an
 * apply that failed after either (a network or database error at the
 * enrollment swap, say) looks untouched. The client cannot tell that apart
 * from a failure before the first write, so a confirmed preview with a group
 * slot or a match to repair counts as possibly partial.
 */
export function substituteApplyMayBePartial(
  confirmed: SubstituteSummary,
  recheck: SubstituteSummary,
): boolean {
  if (substituteApplyWasPartial(confirmed, recheck)) return false;
  return (
    confirmed.phases.some((phase) => phase.group !== null) || confirmed.affected_matches.length > 0
  );
}

/** How far a failed apply is known to have got: wrote part of it, may have, or no sign of either. */
export type SubstitutePartialState = 'partial' | 'possibly_partial' | null;

/** Classify a failed apply from the preview confirmed and the one checked after the failure. */
export function substitutePartialState(
  confirmed: SubstituteSummary,
  recheck: SubstituteSummary,
): SubstitutePartialState {
  if (substituteApplyWasPartial(confirmed, recheck)) return 'partial';
  if (substituteApplyMayBePartial(confirmed, recheck)) return 'possibly_partial';
  return null;
}

/** The apply request's answer: the summary, or the error with its partial signal. */
export type SubstituteApplyResponse = ApiResponse<SubstituteSummary> | SubstituteApplyError;

/**
 * A failed preview or apply: the server's refusal (shown by its code, in the
 * viewer's language), or a request that got no answer (a message key).
 */
export type SubstituteError = { api: ApiErrorLike } | { key: 'previewFailed' | 'applyFailed' };

/** What `applySubstitute` ended with. */
export type SubstituteApplyOutcome =
  | { ok: true; summary: SubstituteSummary }
  | {
      ok: false;
      error: SubstituteError;
      /** Wrote part of it (exact when `written` is set), may have, or wrote nothing. */
      partial: SubstitutePartialState;
      /** The server's exact partial signal; null when it sent none or nothing was written. */
      written: SubstitutePartialApply | null;
      /** The preview checked again after the failure; null when that check failed too. */
      preview: SubstituteSummary | null;
    };

/**
 * Apply a confirmed substitution and, when it fails, settle what the dialog
 * shows. The steps are not one transaction, so a failed apply may have
 * written part of it:
 * - The server answered: its `partial` field is exact (null, or no field at
 *   all for a request rejected before the substitution ran: nothing written).
 * - The request itself failed (network, a non-JSON answer): the outcome is
 *   unknown, so it is inferred from the re-checked preview
 *   (`substitutePartialState`), or counts as possibly partial when the
 *   re-check fails as well.
 * The preview is checked again either way (what is still open), and a failed
 * re-check never clears the partial state.
 */
export async function applySubstitute(
  confirmed: SubstituteSummary,
  apply: () => Promise<SubstituteApplyResponse>,
  recheck: () => Promise<ApiResult<SubstituteSummary>>,
): Promise<SubstituteApplyOutcome> {
  let error: SubstituteError;
  /** undefined: no answer from the server, so no signal. */
  let signal: SubstitutePartialApply | null | undefined;
  try {
    const json = await apply();
    if (json.success) return { ok: true, summary: json.data };
    error = { api: toApiErrorLike(json) };
    signal = json.partial ?? null;
  } catch {
    error = { key: 'applyFailed' };
    signal = undefined;
  }

  let preview: SubstituteSummary | null = null;
  try {
    const json = await recheck();
    if (json.success) preview = json.data;
  } catch {
    // No preview: nothing stale is left to confirm.
  }

  let partial: SubstitutePartialState;
  if (signal !== undefined) partial = signal ? 'partial' : null;
  else partial = preview ? substitutePartialState(confirmed, preview) : 'possibly_partial';

  return { ok: false, error, partial, written: signal ?? null, preview };
}

/** The partial warning the dialog shows, carried across failed applies until one succeeds. */
export interface SubstituteFailureNotice {
  partial: Exclude<SubstitutePartialState, null>;
  /** Every exact signal so far, merged; null when none came back. */
  written: SubstitutePartialApply | null;
  /** The first preview confirmed, to name the phases. */
  confirmed: SubstituteSummary;
}

function mergeWritten(
  a: SubstitutePartialApply | null,
  b: SubstitutePartialApply | null,
): SubstitutePartialApply | null {
  if (!a || !b) return a ?? b;
  return {
    written: {
      proposals_cancelled: [...a.written.proposals_cancelled, ...b.written.proposals_cancelled],
      matches_repaired: [...a.written.matches_repaired, ...b.written.matches_repaired],
      matches_skipped: [...a.written.matches_skipped, ...b.written.matches_skipped],
      groups_handed_over: [...a.written.groups_handed_over, ...b.written.groups_handed_over],
      enrollments_swapped: [...a.written.enrollments_swapped, ...b.written.enrollments_swapped],
      roster_swapped: a.written.roster_swapped || b.written.roster_swapped,
    },
    phase_ids: [...new Set([...a.phase_ids, ...b.phase_ids])],
    stopped_at: b.stopped_at,
  };
}

/**
 * The notice after another failed apply. One that wrote nothing keeps the
 * earlier notice (those writes still stand); one that wrote adds to it.
 */
export function nextSubstituteFailureNotice(
  previous: SubstituteFailureNotice | null,
  outcome: Extract<SubstituteApplyOutcome, { ok: false }>,
  confirmed: SubstituteSummary,
): SubstituteFailureNotice | null {
  if (outcome.partial === null) return previous;
  if (!previous) return { partial: outcome.partial, written: outcome.written, confirmed };
  return {
    partial: previous.partial === 'partial' || outcome.partial === 'partial' ? 'partial' : 'possibly_partial',
    written: mergeWritten(previous.written, outcome.written),
    confirmed: previous.confirmed,
  };
}

/**
 * The steps a failed apply wrote, in words, from its exact partial signal.
 * Phases are named from the confirmed preview. `t` picks the language
 * (English by default).
 */
export function describeSubstitutePartial(
  written: SubstitutePartialApply,
  confirmed: SubstituteSummary | null,
  t: LeagueRosterT = EN_ROSTER_T,
): string[] {
  const phaseName = (phaseId: string) =>
    confirmed?.phases.find((phase) => phase.phase_id === phaseId)?.phase_name ??
    t('partial.steps.phaseFallback');
  const names = (phaseIds: readonly string[]) => phaseIds.map(phaseName).join(', ');
  const steps = written.written;
  const lines: string[] = [];
  if (steps.proposals_cancelled.length > 0) {
    lines.push(t('partial.steps.proposalsCancelled', { count: steps.proposals_cancelled.length }));
  }
  if (steps.matches_repaired.length > 0) {
    lines.push(t('partial.steps.matchesRepaired', { count: steps.matches_repaired.length }));
  }
  if (steps.groups_handed_over.length > 0) {
    lines.push(
      t('partial.steps.groupHandedOver', {
        phases: names(steps.groups_handed_over.map((step) => step.phase_id)),
      }),
    );
  }
  if (steps.enrollments_swapped.length > 0) {
    lines.push(t('partial.steps.enrollmentMoved', { phases: names(steps.enrollments_swapped) }));
  }
  if (steps.roster_swapped) lines.push(t('partial.steps.rosterSwapped'));
  return lines;
}

/** The warning after a failed apply that wrote, or may have written, part of the substitution. */
export function SubstitutePartialWarning({
  state,
  inPlayerName,
  written = null,
  confirmed = null,
  hasPreview = true,
}: {
  state: SubstitutePartialState;
  inPlayerName: string;
  /** The server's exact signal: lists what was written. */
  written?: SubstitutePartialApply | null;
  /** The preview that was confirmed, to name the phases. */
  confirmed?: SubstituteSummary | null;
  /** Whether a fresh preview (what is still open) is shown below. */
  hasPreview?: boolean;
}) {
  const t = useT(leagueRosterMessages);
  if (state === 'partial') {
    const steps = written ? describeSubstitutePartial(written, confirmed, t) : [];
    return (
      <Alert variant="warning">
        <p>
          {t('partial.stopped')} {hasPreview ? t('partial.previewBelow') : t('partial.recheckFailed')}{' '}
          {t('partial.finish', { name: inPlayerName })}
        </p>
        {steps.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        )}
      </Alert>
    );
  }
  if (state === 'possibly_partial') {
    return (
      <Alert variant="warning">
        {hasPreview
          ? t('partial.possiblyWithPreview', { name: inPlayerName })
          : t('partial.possiblyNoPreview', { name: inPlayerName })}
      </Alert>
    );
  }
  return null;
}

/** What a preview would write. */
export function SubstitutePreviewView({ preview }: { preview: SubstituteSummary }) {
  const t = useT(leagueRosterMessages);
  const locale = useLocale();
  const strong = (chunks: ReactNode) => <strong>{chunks}</strong>;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-poke-text-secondary">
        {t.rich('preview.rosterSwap', {
          answer: preview.roster_swapped ? t('preview.yes') : t('preview.no'),
          b: strong,
        })}
      </p>
      <p className="text-poke-text-secondary">
        {t.rich('preview.phaseEnrollments', { count: preview.phases.length, b: strong })}
        {preview.phases.length > 0 && (
          <span className="text-poke-text-muted">
            {' '}
            ({preview.phases
              .map((p) =>
                p.group ? `${p.phase_name}: ${translateEngineLabel('group', p.group.name, locale)}` : p.phase_name,
              )
              .join(', ')})
          </span>
        )}
      </p>

      {preview.affected_matches.length === 0 ? (
        <p className="text-poke-text-muted">{t('preview.noMatches')}</p>
      ) : (
        <div>
          <p className="font-heading font-semibold text-poke-text-primary mb-2">
            {t('preview.matchesHeading', { count: preview.affected_matches.length })}
          </p>
          <ul className="max-h-40 overflow-y-auto space-y-1 rounded-poke-md border border-poke-border bg-poke-elevated p-2">
            {preview.affected_matches.map((match) => (
              <li key={match.match_id} className="text-poke-text-secondary">
                <span className="text-poke-text-muted">{match.tournament_name}:</span>{' '}
                {t('preview.match', { player1: match.player_1_name, player2: match.player_2_name })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!substitutePreviewHasWork(preview) && (
        <Alert variant="warning">{t('preview.nothingToSubstitute')}</Alert>
      )}
    </div>
  );
}

/** What an apply left as it was: planned matches it did not repair. */
export function SubstituteSkippedMatches({ matches }: { matches: readonly SubstituteSkippedMatch[] }) {
  const t = useT(leagueRosterMessages);
  if (matches.length === 0) return null;
  return (
    <Alert variant="warning">
      <p>{t('skipped.heading', { count: matches.length })}</p>
      <ul className="mt-1 space-y-0.5 text-xs">
        {matches.map((match) => (
          <li key={match.match_id}>
            {t('skipped.match', {
              tournament: match.tournament_name,
              player1: match.player_1_name,
              player2: match.player_2_name,
              reason: t(`skipped.reason.${match.reason}`),
            })}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

export default function SubstituteDialog({
  seasonId,
  outPlayerId,
  outPlayerName,
  inPlayerId,
  inPlayerName,
  scope,
  open,
  onClose,
  onSuccess,
}: SubstituteDialogProps) {
  const t = useT(leagueRosterMessages);
  const errorText = useApiErrorText(errorsSeasons);
  const [preview, setPreview] = useState<SubstituteSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<SubstituteError | null>(null);
  /** An apply ran (whatever its outcome): the roster reloads on close. */
  const [applied, setApplied] = useState(false);
  /** A failed apply wrote (or possibly wrote) part of the substitution; kept until one succeeds. */
  const [failure, setFailure] = useState<SubstituteFailureNotice | null>(null);
  /** The last apply succeeded but left planned matches as they were. */
  const [skipped, setSkipped] = useState<SubstituteSkippedMatch[] | null>(null);

  function requestSubstitute(dryRun: boolean): Promise<SubstituteApplyResponse> {
    return fetch(`/api/seasons/${seasonId}/participants/substitute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        out_player_id: outPlayerId,
        in_player_id: inPlayerId,
        scope,
        dry_run: dryRun,
      }),
    }).then((res) => res.json());
  }

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      setApplied(false);
      setFailure(null);
      setSkipped(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/seasons/${seasonId}/participants/substitute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        out_player_id: outPlayerId,
        in_player_id: inPlayerId,
        scope,
        dry_run: true,
      }),
    })
      .then((res) => res.json())
      .then((json: ApiResult<SubstituteSummary>) => {
        if (cancelled) return;
        if (json.success) {
          setPreview(json.data);
        } else {
          setError({ api: toApiErrorLike(json) });
        }
      })
      .catch(() => {
        if (!cancelled) setError({ key: 'previewFailed' });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, seasonId, outPlayerId, inPlayerId, scope]);

  function handleClose() {
    if (applied) onSuccess();
    onClose();
  }

  /**
   * Apply, and after a failure show the error, the partial warning (from the
   * server's exact signal; see `applySubstitute`) and the preview checked
   * again (what is still open; none when that check failed, which leaves
   * nothing stale to confirm but keeps the warning).
   */
  async function handleConfirm() {
    if (!preview) return;
    const confirmed = preview;
    setCommitting(true);
    setError(null);
    setApplied(true);
    try {
      const outcome = await applySubstitute(
        confirmed,
        () => requestSubstitute(false),
        () => requestSubstitute(true),
      );
      if (!outcome.ok) {
        setError(outcome.error);
        setPreview(outcome.preview);
        setFailure((previous) => nextSubstituteFailureNotice(previous, outcome, confirmed));
        return;
      }
      if (outcome.summary.matches_skipped.length > 0) {
        // Done, but say which planned matches it left as they were.
        setSkipped(outcome.summary.matches_skipped);
        return;
      }
      onSuccess();
      onClose();
    } finally {
      setCommitting(false);
    }
  }

  if (skipped) {
    return (
      <Modal open={open} onClose={handleClose} title={t('dialog.doneTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-poke-text-secondary">
            {t.rich('dialog.replaced', { inName: inPlayerName, outName: outPlayerName, b: bold })}
          </p>
          <SubstituteSkippedMatches matches={skipped} />
          <div className="flex justify-end pt-2">
            <Button variant="primary" size="sm" onClick={handleClose}>
              {t('dialog.close')}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={t('dialog.confirmTitle')}>
      <div className="space-y-4">
        <p className="text-sm text-poke-text-secondary">
          {t.rich(scope === 'league' ? 'dialog.replaceLeague' : 'dialog.replacePhase', {
            outName: outPlayerName,
            inName: inPlayerName,
            b: bold,
          })}
        </p>

        {error && (
          <Alert variant="error">
            {'api' in error ? errorText(error.api) : t(`dialog.errors.${error.key}`)}
          </Alert>
        )}
        <SubstitutePartialWarning
          state={failure?.partial ?? null}
          inPlayerName={inPlayerName}
          written={failure?.written ?? null}
          confirmed={failure?.confirmed ?? null}
          hasPreview={preview !== null}
        />

        {loading && (
          <p className="text-sm text-poke-text-muted">{t('dialog.loadingMatches')}</p>
        )}

        {preview && !loading && <SubstitutePreviewView preview={preview} />}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={committing}>
            {t('dialog.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={loading || committing || !preview || !substitutePreviewHasWork(preview)}
          >
            {committing ? t('dialog.substituting') : t('dialog.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
