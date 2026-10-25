'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Section from '@/components/ui/Section';
import Alert from '@/components/ui/Alert';
import ReasonDialog from '@/components/admin/ReasonDialog';
import type { MatchStatus, GameSummary } from '@/types/match';
import type { MatchRecalculationSummary } from '@/types/game';
import { useFormatter, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { enumLabel } from '@/i18n/content/enum-label';
import { adminCoreMessages } from '@/i18n/messages/admin-core';
import { adminMatchMessages } from '@/i18n/messages/admin-match';
import { enumMessages } from '@/i18n/messages/enums';
import GameChangeAlerts from '@/components/match/GameChangeAlerts';
import { gameChangeFailureHints, sendGameChange } from '@/lib/match/game-change-outcome';
import { computeSeriesTally } from '@/lib/match/series-tally';
import type { MatchResetPreview } from '@/lib/admin/match-detail';
import { hasReachedBoThreshold } from '@/lib/tournament/match-state';
import ConfirmResultDialog, { SeriesTallyLine, type ConfirmResultKind } from './ConfirmResultDialog';

interface PlayerInfo {
  id: string;
  name: string;
}

interface AdminMatchActionsProps {
  matchId: string;
  currentStatus: MatchStatus;
  player1: PlayerInfo;
  player2: PlayerInfo;
  currentWinnerId: string | null;
  games: GameSummary[];
  tournamentId: string;
  /**
   * The round's best-of (null when the round could not be read): it drives the
   * series tally and tells what a deleted game leaves behind.
   */
  bestOf: number | null;
  /** The viewer is a site admin (the admin data tools are site-admin only). */
  isSiteAdmin: boolean;
}

type LocalError = 'selectWinner' | 'updateFailed' | 'resetFailed' | 'deleteFailed';
/** An API failure (translated by its code) or a local message key; never translated text (i18n-core §1.7). */
type ActionError = { api: ApiErrorLike } | { local: LocalError };
type ActionSuccess =
  | { kind: 'completed' | 'disputed' }
  | { kind: 'reset' | 'gameDeleted'; count: number };

/** The reset dialog's read of what a reset touches. */
type ResetPreviewState =
  | { status: 'loading' }
  | { status: 'ready'; preview: MatchResetPreview }
  | { status: 'failed' };

/** The status a match lands in after one of its games is deleted. */
export type StatusAfterDelete = 'scheduled' | 'in_progress' | 'pending_confirmation';

export interface DeleteGameImpact {
  remainingGames: number;
  /** The status the remaining games put the match in; null when the best-of is unknown. */
  nextStatus: StatusAfterDelete | null;
}

/**
 * What deleting `gameId` leaves behind: the games that remain and the status
 * they put the match in (none: scheduled; a best-of threshold reached:
 * awaiting confirmation; else in progress). Without a known best-of the
 * status is unknown (null) as soon as games remain.
 */
export function deleteGameImpact(
  games: readonly GameSummary[],
  gameId: string,
  player1Id: string,
  player2Id: string,
  bestOf: number | null,
): DeleteGameImpact {
  const remaining = games.filter((game) => game.id !== gameId);
  if (remaining.length === 0) return { remainingGames: 0, nextStatus: 'scheduled' };
  if (bestOf === null) return { remainingGames: remaining.length, nextStatus: null };
  const wins1 = remaining.filter((game) => game.winner_id === player1Id).length;
  const wins2 = remaining.filter((game) => game.winner_id === player2Id).length;
  const { reached } = hasReachedBoThreshold(bestOf, wins1, wins2);
  return { remainingGames: remaining.length, nextStatus: reached ? 'pending_confirmation' : 'in_progress' };
}

/**
 * Failure codes of the override and the reopen after which the page shows a
 * match that is no longer current, so it reloads its data at once instead of
 * waiting.
 */
export function errorNeedsRefresh(code: string | null | undefined): boolean {
  return code === 'match_state_changed' || code === 'match_reopen_incomplete';
}

function toCount(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** What a reset will touch, from the reset preview (or the notice that it could not be read). */
export function ResetImpact({ state }: { state: ResetPreviewState }) {
  const tMatch = useT(adminMatchMessages);
  const tEnums = useT(enumMessages);
  if (state.status === 'loading') return <p>{tMatch('impact.loading')}</p>;
  if (state.status === 'failed') return <Alert variant="warning">{tMatch('impact.loadFailed')}</Alert>;
  const { preview } = state;
  return (
    <>
      <p>{tMatch('impact.gamesToDelete', { count: preview.games_to_delete })}</p>
      {preview.was_completed && <p>{tMatch('impact.ratingsRebuilt')}</p>}
      {preview.downstream.length > 0 && (
        <div>
          <p className="font-semibold text-poke-text-primary">{tMatch('impact.downstreamHeading')}</p>
          <ul className="mt-1 list-disc pl-5">
            {preview.downstream.map((m) => (
              <li key={m.id}>
                {tMatch('impact.downstreamItem', {
                  player1: m.player_1_name,
                  player2: m.player_2_name,
                  round: m.round_name,
                  status: enumLabel(tEnums, 'matchStatus', m.status),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** What deleting a game leaves behind: the games that remain, the match status and, for a completed match, the rebuild. */
export function DeleteGameImpactNotice({ impact, ratingsRebuilt }: { impact: DeleteGameImpact; ratingsRebuilt: boolean }) {
  const tMatch = useT(adminMatchMessages);
  return (
    <>
      <p>{tMatch('impact.deleteGameLine', { count: impact.remainingGames })}</p>
      {impact.nextStatus && <p>{tMatch(`impact.afterDelete.${impact.nextStatus}`)}</p>}
      {ratingsRebuilt && <p>{tMatch('impact.deleteRatingsRebuilt')}</p>}
    </>
  );
}

export default function AdminMatchActions({
  matchId,
  currentStatus,
  player1,
  player2,
  currentWinnerId,
  games,
  bestOf,
  isSiteAdmin,
}: AdminMatchActionsProps) {
  const router = useRouter();
  const t = useT(adminCoreMessages);
  const tMatch = useT(adminMatchMessages);
  const formatter = useFormatter();
  const [winnerId, setWinnerId] = useState(currentWinnerId ?? '');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [success, setSuccess] = useState<ActionSuccess | null>(null);
  /** Warnings of a saved reset or game delete (e.g. the EPB recheck failed), rendered by catalogue code. */
  const [warnings, setWarnings] = useState<ApiErrorLike[]>([]);
  // Itemized recalculation summary from the last reset (spec §24). Rendered as
  // a compact list below the success banner instead of a plain "N games deleted"
  // string, so the admin can confirm what was recalculated.
  const [recalculation, setRecalculation] = useState<MatchRecalculationSummary | null>(null);
  const [downstreamWarning, setDownstreamWarning] = useState(false);

  // Confirm dialog state
  const [confirmKind, setConfirmKind] = useState<ConfirmResultKind | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [cascadeDialogOpen, setCascadeDialogOpen] = useState(false);
  /** Later matches the refused reset reported (`DOWNSTREAM_PLAYED` params), for the cascade dialog's text. */
  const [cascadeCount, setCascadeCount] = useState<number | null>(null);
  /** The reason typed in the reset dialog, offered again in the cascade dialog it can lead to. */
  const [resetReason, setResetReason] = useState('');
  const [resetPreview, setResetPreview] = useState<ResetPreviewState>({ status: 'loading' });
  const [deleteGameId, setDeleteGameId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const isTerminal = currentStatus === 'completed';
  const isScheduled = currentStatus === 'scheduled';
  const tally = useMemo(
    () => computeSeriesTally(games, player1.id, player2.id, bestOf),
    [games, player1.id, player2.id, bestOf],
  );
  const leader = tally.leaderId === player1.id ? player1 : tally.leaderId === player2.id ? player2 : null;

  function openResetDialog() {
    setResetPreview({ status: 'loading' });
    setResetDialogOpen(true);
  }

  // Opening the reset dialog reads what the reset will touch. A failed read does not block the
  // reset: the dialog then behaves as before and asks about later matches only if the API refuses.
  useEffect(() => {
    if (!resetDialogOpen) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/admin/matches/${matchId}/reset-preview`, { signal: controller.signal });
        const json = await res.json();
        if (controller.signal.aborted) return;
        setResetPreview(
          json.success && json.data ? { status: 'ready', preview: json.data as MatchResetPreview } : { status: 'failed' },
        );
      } catch {
        if (!controller.signal.aborted) setResetPreview({ status: 'failed' });
      }
    })();
    return () => controller.abort();
  }, [resetDialogOpen, matchId]);

  /** Ask first: Complete needs a winner, then both actions open the confirmation. */
  function requestOverride(targetStatus: ConfirmResultKind) {
    setError(null);
    setSuccess(null);
    setWarnings([]);

    if (targetStatus === 'completed' && !winnerId) {
      setError({ local: 'selectWinner' });
      return;
    }
    setConfirmKind(targetStatus);
  }

  async function handleOverride(targetStatus: ConfirmResultKind) {
    setError(null);
    setSuccess(null);
    setWarnings([]);

    setLoading(true);
    try {
      const res = await fetch(`/api/confirm-match/${matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: targetStatus === 'completed' ? 'confirm' : 'dispute',
          winner_id: targetStatus === 'completed' ? winnerId : undefined,
          notes: notes.trim() || undefined,
        }),
      });

      const json = await res.json();

      if (json.success) {
        setSuccess({ kind: targetStatus });
        setTimeout(() => router.refresh(), 1500);
      } else {
        const apiError = toApiErrorLike(json);
        setError({ api: apiError });
        // The match moved on meanwhile (`match_state_changed`): show its current state at once.
        if (gameChangeFailureHints(apiError).reload) router.refresh();
      }
    } catch {
      setError({ local: 'updateFailed' });
    } finally {
      setLoading(false);
      setConfirmKind(null);
    }
  }

  async function handleResetMatch(cascade: boolean, reason: string) {
    setResetReason(reason);
    setError(null);
    setSuccess(null);
    setWarnings([]);
    setRecalculation(null);
    setDownstreamWarning(false);
    setCascadeCount(null);
    setResetting(true);
    try {
      const result = await sendGameChange(`/api/admin/matches/${matchId}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cascade, reason }),
      });

      if (result.ok) {
        const data = result.data;
        setSuccess({ kind: 'reset', count: toCount(data.games_deleted) });
        setWarnings(result.warnings);
        setDownstreamWarning(Boolean(data.has_downstream_matches));
        // Surface the itemized recalculation summary when the API provides it
        // (spec §24). Falls back to the plain success banner otherwise.
        if (data.recalculation) {
          setRecalculation(data.recalculation as MatchRecalculationSummary);
        }
        setResetDialogOpen(false);
        setCascadeDialogOpen(false);
        setTimeout(() => router.refresh(), 2000);
      } else if (result.error.code === 'DOWNSTREAM_PLAYED' && !cascade) {
        const count = result.error.params?.count;
        setCascadeCount(typeof count === 'number' && Number.isFinite(count) ? count : null);
        setResetDialogOpen(false);
        setCascadeDialogOpen(true);
      } else {
        setError({ api: result.error });
        setResetDialogOpen(false);
        setCascadeDialogOpen(false);
      }
    } catch {
      setError({ local: 'resetFailed' });
      setResetDialogOpen(false);
      setCascadeDialogOpen(false);
    } finally {
      setResetting(false);
    }
  }

  async function handleDeleteGame(reason: string) {
    if (!deleteGameId) return;
    setError(null);
    setSuccess(null);
    setWarnings([]);
    // Clear any prior reset summary so a stale itemized summary doesn't bleed
    // across actions (spec §24): a delete must not leave the previous reset's
    // recalculation/rendered list visible under the new "Game deleted" message.
    setRecalculation(null);
    setDownstreamWarning(false);
    setResetting(true);
    try {
      const result = await sendGameChange(`/api/admin/games/${deleteGameId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });

      if (result.ok) {
        const data = result.data;
        setSuccess({ kind: 'gameDeleted', count: toCount(data.games_remaining) });
        setWarnings(result.warnings);
        // Surface the EPB game-deletion recalculation summary when the API
        // provides it (deleteGame returns its own, smaller recalculation). If
        // absent (legacy season / no EPB rebuild), the success banner renders
        // cleanly without a stale summary — recalculation stays null above.
        if (data.recalculation) {
          setRecalculation(data.recalculation as MatchRecalculationSummary);
        }
        setDeleteGameId(null);
        setTimeout(() => router.refresh(), 1500);
      } else {
        setError({ api: result.error });
        setDeleteGameId(null);
      }
    } catch {
      setError({ local: 'deleteFailed' });
      setDeleteGameId(null);
    } finally {
      setResetting(false);
    }
  }

  /** The children-cleanup line: every active category, or null when nothing was cleaned. */
  function cleanupLine(c: NonNullable<MatchRecalculationSummary['childrenCleanup']>): string | null {
    const parts: string[] = [];
    if (c.matchPrepTeamsDeleted) parts.push(t('actions.recalc.matchPrepTeams', { count: c.matchPrepTeamsDeleted }));
    if (c.matchProposalsDeleted) parts.push(t('actions.recalc.proposals', { count: c.matchProposalsDeleted }));
    if (c.broadcastMomentsDeleted) parts.push(t('actions.recalc.broadcastMoments', { count: c.broadcastMomentsDeleted }));
    if (c.animationViewsDeleted) parts.push(t('actions.recalc.animationViews', { count: c.animationViewsDeleted }));
    if (c.teamPointersCleared) parts.push(t('actions.recalc.teamPointers', { count: c.teamPointersCleared }));
    if (c.castSessionPointersCleared) parts.push(t('actions.recalc.castPointers', { count: c.castSessionPointersCleared }));
    if (c.agentSuggestionPointersCleared) {
      parts.push(t('actions.recalc.agentSuggestionPointers', { count: c.agentSuggestionPointersCleared }));
    }
    if (c.socialImageCleared) parts.push(t('actions.recalc.socialImage'));
    if (parts.length === 0) return null;
    return t('actions.recalc.cleaned', { items: formatter.list(parts, 'unit') });
  }

  function successText(s: ActionSuccess): string {
    switch (s.kind) {
      case 'completed':
        return t('actions.success.completed');
      case 'disputed':
        return t('actions.success.disputed');
      case 'reset':
        return t('actions.success.reset', { count: s.count });
      case 'gameDeleted':
        return t('actions.success.gameDeleted', { count: s.count });
    }
  }

  const downstreamCount = resetPreview.status === 'ready' ? resetPreview.preview.downstream.length : 0;
  const deleteImpact = deleteGameId ? deleteGameImpact(games, deleteGameId, player1.id, player2.id, bestOf) : null;

  const cleaned = recalculation?.childrenCleanup ? cleanupLine(recalculation.childrenCleanup) : null;

  return (
    <>
      {/* Reset Match Controls — shown for non-scheduled matches */}
      {!isScheduled && !(isTerminal && games.length === 0) && (
        <Section title={t('actions.resetSection')}>
          <div className="space-y-4">
            {/* Per-game actions */}
            {games.length > 0 && (
              <div>
                <p className="text-xs text-poke-text-muted mb-2">{t('actions.gameActions')}</p>
                <div className="space-y-2">
                  {games.map((game) => (
                    <div
                      key={game.id}
                      className="flex items-center justify-between px-3 py-2 bg-poke-surface-alt rounded-poke-md border border-poke-border"
                    >
                      <div className="text-sm">
                        <span className="font-heading font-semibold text-poke-text-secondary">
                          {t('actions.gameNumber', { number: game.game_number })}
                        </span>
                        {game.winner_id && (
                          <span className="ml-2 text-poke-text-muted">
                            {t('actions.gameWinner', {
                              name: game.winner_id === player1.id ? player1.name : player2.name,
                            })}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Link
                          href={`/admin/matches/${matchId}/games/${game.id}/edit`}
                          className="text-xs text-poke-blue hover:underline font-heading"
                        >
                          {t('actions.edit')}
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteGameId(game.id)}
                          className="text-xs text-poke-accent hover:underline font-heading"
                        >
                          {t('actions.delete')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reset entire match. A completed match has its reset in the Admin Actions card below. */}
            {!isTerminal && (
              <Button
                variant="danger"
                size="sm"
                onClick={openResetDialog}
                disabled={loading}
              >
                {t('actions.resetMatch')}
              </Button>
            )}
          </div>
        </Section>
      )}

      {/* Override Actions — for non-terminal, non-scheduled states */}
      {!isTerminal && !isScheduled && (
        <Section title={t('actions.overrideSection')}>
          {/* Recorded games, so the result is picked with the series in view */}
          <div className="mb-4 space-y-1 text-sm">
            <p className="font-heading text-poke-text-muted">{t('actions.tally.label')}</p>
            <p className="text-poke-text-primary">
              <SeriesTallyLine tally={tally} player1={player1} player2={player2} />
            </p>
            {tally.bestOf !== null && tally.winsNeeded !== null && (
              <p className="text-xs text-poke-text-muted">
                {t('actions.tally.bestOf', { bestOf: tally.bestOf, needed: tally.winsNeeded })}
              </p>
            )}
          </div>

          {/* Winner Selection */}
          <div>
            <label className="block text-sm font-heading text-poke-text-muted mb-2">{t('actions.setWinner')}</label>
            <div className="flex gap-3">
              {[player1, player2].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setWinnerId(p.id)}
                  className={`px-4 py-2 rounded-poke-md text-sm border transition-colors font-heading font-semibold ${
                    winnerId === p.id
                      ? 'bg-poke-accent text-poke-surface border-poke-accent shadow-poke-sm'
                      : 'bg-poke-surface text-poke-text-secondary border-poke-border hover:border-poke-blue'
                  }`}
                >
                  {p.name}
                  {leader?.id === p.id && (
                    <span className="ml-2 text-xs font-normal opacity-80">{t('actions.tally.byGames')}</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="mt-4">
            <label htmlFor="admin-notes" className="block text-sm font-heading text-poke-text-muted mb-1">
              {t('actions.notesLabel')}
            </label>
            <textarea
              id="admin-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-poke-border bg-poke-surface text-poke-text-primary rounded-poke-md text-sm placeholder:text-poke-text-muted focus:outline-none focus:border-poke-border-focus focus:ring-2 focus:ring-poke-border-focus/20"
              placeholder={t('actions.notesPlaceholder')}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-4">
            <Button
              variant="success"
              loading={loading}
              onClick={() => requestOverride('completed')}
            >
              {t('actions.completeMatch')}
            </Button>

            {currentStatus !== 'disputed' && (
              <Button
                variant="danger"
                loading={loading}
                onClick={() => requestOverride('disputed')}
              >
                {t('actions.markDisputed')}
              </Button>
            )}
          </div>
        </Section>
      )}

      {/* Completed match — show reset option only */}
      {isTerminal && (
        <Section title={t('actions.adminActions')}>
          <p className="text-sm text-poke-text-muted mb-3">{t('actions.completedHint')}</p>
          <Button
            variant="danger"
            size="sm"
            onClick={openResetDialog}
          >
            {t('actions.resetMatch')}
          </Button>
        </Section>
      )}

      {/* Feedback */}
      {error && 'local' in error && (
        <Alert variant="error" className="mt-4">
          {t(`actions.errors.${error.local}`)}
        </Alert>
      )}
      {/* API failures with their recovery (reload after a concurrent change, data tools
          for a game left uncounted) and the warnings of a saved change. */}
      {((error && 'api' in error) || warnings.length > 0) && (
        <div className="mt-4">
          <GameChangeAlerts error={error && 'api' in error ? error.api : null} warnings={warnings} isSiteAdmin={isSiteAdmin} />
        </div>
      )}
      {success && (
        <Alert variant="success" className="mt-4">
          <div className="space-y-1">
            <p>{successText(success)}</p>
            {/* Itemized recalculation summary (spec §24). Rendered when the
                reset API returned a `recalculation` object so the admin can
                confirm exactly which derived records were rebuilt. */}
            {recalculation && (
              <ul className="mt-2 space-y-1 text-xs">
                <li>{t('actions.recalc.gamesDeleted', { count: recalculation.gamesDeleted })}</li>
                {/*
                  Children cleanup — render EVERY field of MatchChildrenCleanup
                  that cleanMatchChildren returns (spec §17/§18). Each category
                  is listed only when it had activity (non-zero count / true
                  boolean) so the list stays compact, but no active category is
                  silently dropped. When nothing was cleaned, the line is
                  omitted entirely rather than showing a misleading "cleaned
                  0 ..." line.
                */}
                {cleaned && <li>{cleaned}</li>}
                {recalculation.ratingsRebuilt && recalculation.ratingsRebuilt.players.length > 0 && (
                  <li>{t('actions.recalc.ratingsRebuilt', { count: recalculation.ratingsRebuilt.players.length })}</li>
                )}
                {recalculation.evolutionRepaired && (
                  <li>
                    {t('actions.recalc.evolutionRebuilt', {
                      trackers: t('actions.recalc.trackers', { count: recalculation.evolutionRepaired.trackersUpdated }),
                      events: t('actions.recalc.events', { count: recalculation.evolutionRepaired.eventsRewritten }),
                      points: t('actions.recalc.evolutionPoints', {
                        count: recalculation.evolutionRepaired.evolutionPoints,
                      }),
                    })}
                  </li>
                )}
                {recalculation.impossibleLineups.length > 0 && (
                  <li className="text-poke-danger">
                    {t('actions.recalc.impossibleLineups', { count: recalculation.impossibleLineups.length })}
                  </li>
                )}
              </ul>
            )}
            {downstreamWarning && <p className="text-xs">{t('actions.downstreamWarning')}</p>}
          </div>
        </Alert>
      )}

      {confirmKind && (
        <ConfirmResultDialog
          open
          onClose={() => setConfirmKind(null)}
          onConfirm={() => handleOverride(confirmKind)}
          kind={confirmKind}
          player1={player1}
          player2={player2}
          winnerId={confirmKind === 'completed' ? winnerId : (currentWinnerId ?? '')}
          tally={tally}
          note={notes}
          loading={loading}
        />
      )}

      {/* Reset dialog: the impact comes from the reset preview; later played matches reset with it */}
      <ReasonDialog
        open={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        onConfirm={(reason) => handleResetMatch(downstreamCount > 0, reason)}
        title={t('actions.dialogs.resetTitle')}
        message={t('actions.dialogs.resetMessage', { count: games.length })}
        confirmLabel={
          downstreamCount > 0
            ? tMatch('impact.resetAlsoLater', { count: downstreamCount })
            : t('actions.dialogs.resetConfirm')
        }
        loading={resetting}
        confirmDisabled={resetPreview.status === 'loading'}
        reasonLabel={tMatch('actions.resetReasonLabel')}
        reasonPlaceholder={tMatch('actions.resetReasonPlaceholder')}
      >
        <ResetImpact state={resetPreview} />
      </ReasonDialog>

      <ReasonDialog
        open={cascadeDialogOpen}
        onClose={() => setCascadeDialogOpen(false)}
        onConfirm={(reason) => handleResetMatch(true, reason)}
        title={t('actions.dialogs.cascadeTitle')}
        message={
          cascadeCount !== null
            ? tMatch('actions.cascadeMessage', { count: cascadeCount })
            : t('actions.dialogs.cascadeMessage')
        }
        confirmLabel={t('actions.dialogs.cascadeConfirm')}
        loading={resetting}
        reasonLabel={tMatch('actions.resetReasonLabel')}
        reasonPlaceholder={tMatch('actions.resetReasonPlaceholder')}
        initialReason={resetReason}
      />

      {/* Delete game dialog */}
      <ReasonDialog
        open={deleteGameId !== null}
        onClose={() => setDeleteGameId(null)}
        onConfirm={handleDeleteGame}
        title={t('actions.dialogs.deleteTitle')}
        message={t('actions.dialogs.deleteMessage')}
        confirmLabel={t('actions.dialogs.deleteConfirm')}
        loading={resetting}
        reasonLabel={tMatch('actions.deleteReasonLabel')}
        reasonPlaceholder={tMatch('actions.deleteReasonPlaceholder')}
      >
        {deleteImpact && <DeleteGameImpactNotice impact={deleteImpact} ratingsRebuilt={isTerminal} />}
      </ReasonDialog>
    </>
  );
}
