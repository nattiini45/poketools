'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import PickSelector from './PickSelector';
import EvolutionRosterCard from './EvolutionRosterCard';
import EvolutionEventBanner from './EvolutionEventBanner';
import DraftStallNotice from './DraftStallNotice';
import PickWarnings, { knownPickWarnings, type PickWarning } from './PickWarnings';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Table, { type Column } from '@/components/ui/Table';
import Select from '@/components/ui/Select';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import ItemIcon from '@/components/ui/ItemIcon';
import { cn } from '@/lib/utils/cn';
import { useDataLocale, useT } from '@/i18n/client';
import { toApiErrorLike, type ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { errorsDraft } from '@/i18n/messages/errors/draft';
import { errorsDraftLegacy } from '@/i18n/messages/errors/draft-legacy';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useVisiblePoll } from '@/lib/draft/use-visible-poll';
import { draftPoolStatusMachine } from '@/lib/draft/pool-status-state';
import {
  DRAFT_STATE_LOAD_ERROR,
  makeDraftBoardTick,
  pickerOf,
  shouldOfferTokenAllocator,
  type DraftBoardState,
  type FetchLike,
  type TrackersByPlayer,
} from './draft-board-sync';
import type { PublicDraftPick } from '@/lib/draft/public-pick';
import type { DraftPoolEntry } from '@/types/draft-pool';
import type { EvolutionTier, DraftTierLimit, EvolutionEvent } from '@/types/evolution';

/** Bound browser fetch (a detached `window.fetch` call can throw Illegal invocation). */
const browserFetch: FetchLike = (input, init) => fetch(input, init);

/** A board error: a server error (translated by its code) or one of the board's own fallbacks. */
type BoardError =
  | { kind: 'api'; error: ApiErrorLike }
  | { kind: 'local'; key: 'loadState' | 'makePick' | 'undo' | 'statusChange' | 'freeOrder' };

/** The current picker's stall, if any (only the current picker can be stalled; an older server sends no field). */
function stallOf(state: DraftBoardState) {
  const stall = state.stalled_picker ?? null;
  return state.turn_enforced && stall && stall.player_id === state.current_picker ? stall : null;
}

function pollError(message: string, detail?: ApiErrorLike): BoardError {
  if (detail) return { kind: 'api', error: detail };
  return message === DRAFT_STATE_LOAD_ERROR
    ? { kind: 'local', key: 'loadState' }
    : { kind: 'api', error: { error: message } };
}

interface DraftBoardProps {
  poolId: string;
  currentPlayerId: string;
  isAdmin: boolean;
  /** Map of player_id → player_name for display */
  playerNames: Record<string, string>;
  /** Season ID for fetching evolution state (if evo-league) */
  seasonId?: string;
  /** Universal draft pool entries — restricts which Pokémon can be picked */
  poolEntries?: DraftPoolEntry[];
  /** Evo-league tier list (base pokemon with power tiers) — restricts pick pool */
  evoTiers?: EvolutionTier[];
  /** Per-tier draft limits */
  tierLimits?: DraftTierLimit[];
  /** Evolution Point Buy draft room mode */
  isEpb?: boolean;
}

export default function DraftBoard({
  poolId,
  currentPlayerId,
  isAdmin,
  playerNames,
  seasonId,
  poolEntries,
  evoTiers,
  tierLimits,
  isEpb = false,
}: DraftBoardProps) {
  const t = useT(draftLegacyBoardMessages);
  const tLegacy = useT(draftLegacyMessages);
  const tEnums = useT(enumMessages);
  const dataLocale = useDataLocale();
  const apiErrorText = useApiErrorText(errorsDraft, errorsDraftLegacy);
  const [state, setState] = useState<DraftBoardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BoardError | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  // Follow-up steps that failed after a pick was saved; kept until the next pick (a poll must not hide them).
  const [pickWarnings, setPickWarnings] = useState<PickWarning[]>([]);
  // Free pick order, admins: whose pick to enter (null = the suggested next seat).
  const [pickFor, setPickFor] = useState<string | null>(null);
  // Admin confirmations: switch a stalled draft to free order, end a free-order draft.
  const [confirming, setConfirming] = useState<'freeOrder' | 'end' | null>(null);
  const [busy, setBusy] = useState(false);

  // Evolution state
  const [evoTrackers, setEvoTrackers] = useState<TrackersByPlayer>({});
  const [isEvoLeague, setIsEvoLeague] = useState(false);
  const [evolutionEvents, setEvolutionEvents] = useState<EvolutionEvent[]>([]);
  // Last poll's trackers, read by the next poll to detect evolutions. A ref,
  // not state: the poll callback must see the latest value, not the value it
  // closed over at creation (the old stale-closure bug never fired events).
  const evoTrackersRef = useRef<TrackersByPlayer>({});

  // EPB boards get the season's trackers inside the one state request.
  const withTrackers = Boolean(seasonId && isEpb);

  useEffect(() => {
    evoTrackersRef.current = {};
  }, [poolId, seasonId]);

  // The ref is only touched inside the tick (never during render).
  const pollTick = useCallback(
    (signal: AbortSignal) =>
      makeDraftBoardTick({
        fetchImpl: browserFetch,
        poolId,
        withTrackers,
        trackersRef: evoTrackersRef,
        sink: {
          onState: (next) => {
            setState(next);
            // The stall cleared (another admin switched, an undo, the pool completed): close its confirmation.
            if (!stallOf(next)) setConfirming((open) => (open === 'freeOrder' ? null : open));
            setError(null);
            setLoading(false);
          },
          onError: (message, detail) => {
            setError(pollError(message, detail));
            setLoading(false);
          },
          onEvolution: (trackers, events) => {
            setIsEvoLeague(true);
            if (events.length > 0) setEvolutionEvents(events);
            setEvoTrackers(trackers);
          },
        },
      })(signal),
    [poolId, withTrackers],
  );

  // 3 s while live and visible, paused while hidden, 60 s once complete.
  const { refresh: fetchState } = useVisiblePoll(pollTick, {
    resetKey: `${poolId}|${withTrackers}`,
  });

  async function handlePick(pokemonName: string, pointsSpent?: number) {
    try {
      const body: Record<string, unknown> = {
        player_id: (state && pickerOf(state, { currentPlayerId, isAdmin, pickFor })) ?? currentPlayerId,
        pokemon_name: pokemonName,
      };
      if (pointsSpent !== undefined) body.points_spent = pointsSpent;

      const res = await fetch(`/api/drafts/${poolId}/picks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!json.success) {
        setError({ kind: 'api', error: toApiErrorLike(json) });
        return;
      }

      setPickWarnings(knownPickWarnings(json.warnings));
      setShowPicker(false);
      await fetchState();
    } catch (err) {
      console.error('[DraftBoard] make pick failed:', err);
      setError({ kind: 'local', key: 'makePick' });
    }
  }

  async function handleUndo() {
    try {
      const res = await fetch(`/api/drafts/${poolId}/undo`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) {
        setError({ kind: 'api', error: toApiErrorLike(json) });
        return;
      }
      await fetchState();
    } catch (err) {
      console.error('[DraftBoard] undo pick failed:', err);
      setError({ kind: 'local', key: 'undo' });
    }
  }

  async function handleFreeOrder() {
    setBusy(true);
    try {
      const res = await fetch(`/api/drafts/${poolId}/free-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!json.success) {
        setError({ kind: 'api', error: toApiErrorLike(json) });
        return;
      }
      await fetchState();
    } catch (err) {
      console.error('[DraftBoard] switch to free order failed:', err);
      setError({ kind: 'local', key: 'freeOrder' });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  async function handleStatusChange(status: 'in_progress' | 'complete') {
    try {
      const res = await fetch(`/api/drafts/${poolId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!json.success) {
        setError({ kind: 'api', error: toApiErrorLike(json) });
        return;
      }
      await fetchState();
    } catch (err) {
      console.error('[DraftBoard] status change failed:', err);
      setError({ kind: 'local', key: 'statusChange' });
    }
  }

  const showPickCost = Boolean(state && (state.budgets !== null || isEpb));

  const pickColumns = useMemo((): Column<PublicDraftPick>[] => {
    const columns: Column<PublicDraftPick>[] = [
      {
        key: 'pick_number',
        header: '#',
        sortable: true,
        sortValue: (pick) => pick.pick_number,
        render: (pick) => <span className="font-mono text-fg-muted tabular-nums">{pick.pick_number}</span>,
      },
      {
        key: 'round',
        header: t('board.columns.round'),
        sortable: true,
        sortValue: (pick) => pick.round,
        render: (pick) => <span className="font-mono text-fg-muted tabular-nums">{pick.round}</span>,
      },
      {
        key: 'player',
        header: t('board.columns.player'),
        sortable: true,
        sortValue: (pick) => pick.player_name,
        render: (pick) => pick.player_name,
      },
      {
        key: 'pokemon',
        header: t('board.columns.pokemon'),
        sortable: true,
        sortValue: (pick) => pick.pokemon_name,
        render: (pick) => (
          <PokemonLink name={pick.pokemon_name}>
            <AnimatedSprite>
              <PokemonSprite name={pick.pokemon_name} size={24} />
            </AnimatedSprite>
            {localizeSpecies(pick.pokemon_name, dataLocale)}
          </PokemonLink>
        ),
      },
    ];

    if (showPickCost) {
      columns.push({
        key: 'cost',
        header: t('board.columns.cost'),
        sortable: true,
        sortValue: (pick) => pick.points_spent ?? 0,
        render: (pick) => <span className="font-mono text-fg-muted tabular-nums">{pick.points_spent ?? '-'}</span>,
      });
    }

    return columns;
  }, [showPickCost, t, dataLocale]);

  const errorText = error
    ? error.kind === 'api'
      ? apiErrorText(error.error)
      : t(`board.errors.${error.key}`)
    : null;

  if (loading) {
    return <div className="rounded-poke-lg border border-hairline bg-surface p-8 text-center text-body text-fg-muted">{t('board.loading')}</div>;
  }

  if (!state) {
    return <div className="rounded-poke-lg border border-hairline bg-surface p-8 text-center text-body text-poke-danger-ink">{errorText || t('board.errors.loadFailed')}</div>;
  }

  const turnEnforced = state.turn_enforced;
  const isMyTurn = turnEnforced && state.current_picker === currentPlayerId;
  const isParticipant = currentPlayerId in state.rosters;
  // Turn order: the player whose turn it is, or an admin for them. Free order: an admin for anyone, and a
  // participant for themselves, except in an auction, where an admin records the winning bid.
  const canPick =
    state.pool.status === 'in_progress' &&
    state.current_picker !== null &&
    (turnEnforced ? isMyTurn || isAdmin : isAdmin || (isParticipant && state.pool.draft_type !== 'auction'));
  const picker = pickerOf(state, { currentPlayerId, isAdmin, pickFor });
  // Admin status buttons come from the machine: Start (pending) and End draft (in progress).
  const adminEvents = isAdmin ? draftPoolStatusMachine.transitionsFrom(state.pool.status, 'admin').map((tr) => tr.event) : [];
  const stall = stallOf(state);
  const stalledName = stall ? (playerNames[stall.player_id] ?? tLegacy('unknownPlayer')) : '';

  const epbMeta = state.epb;
  const myBudgetRemaining = state.budgets?.[currentPlayerId] ?? null;
  const myPicksUsed = epbMeta?.picks_by_player[currentPlayerId] ?? 0;
  const myPicksRemaining = epbMeta ? Math.max(0, epbMeta.draft_picks - myPicksUsed) : null;
  const myPointsSpent = epbMeta
    ? epbMeta.draft_budget - (myBudgetRemaining ?? epbMeta.draft_budget)
    : null;

  // EPB: use server-owned line identities; never re-derive from client trackers
  const takenSet = new Set(
    isEpb && state.taken_line_identities
      ? state.taken_line_identities
      : state.taken_pokemon,
  );

  // Draft Kill Tokens are bought in the token centre (draft-frontend §6.2); the
  // legacy board only points there (the old allocator endpoint answers 410).
  const showTokenCta = shouldOfferTokenAllocator({
    state,
    viewerId: currentPlayerId,
    seasonId,
    isEpb,
  });

  const totalRounds = state.total_rounds;
  // A complete draft has no next pick: its counter has run past the last round ("Round 7 · Pick #13"),
  // so it shows the result instead.
  let progressLabel: string;
  if (state.pool.status === 'complete') {
    progressLabel =
      totalRounds !== undefined
        ? t('board.completeSummary', { count: totalRounds, picks: state.picks.length })
        : t('board.completeNoRounds', { picks: state.picks.length });
  } else if (totalRounds !== undefined) {
    progressLabel = t('board.roundPickOf', {
      round: state.current_round,
      total: totalRounds,
      pick: state.next_pick_number,
    });
  } else {
    progressLabel = t('board.roundPick', { round: state.current_round, pick: state.next_pick_number });
  }

  const status = state.pool.status;
  const statusTone: SkewChipTone = status === 'in_progress' ? 'live' : status === 'complete' ? 'tier-1' : 'neutral';
  const live = status === 'in_progress' && state.current_picker !== null;
  const showSeats = live && turnEnforced && state.pick_order.length > 0;
  const showEnd = live && !turnEnforced && adminEvents.includes('complete');
  const showUndo = isAdmin && status === 'in_progress' && state.picks.length > 0;
  const hasActions = (live && canPick) || adminEvents.includes('start') || showUndo || showEnd || (live && !turnEnforced && isAdmin);

  return (
    <div className="flex flex-col gap-6">
      {isEpb && epbMeta && (
        <div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t('board.epb.pointsUsed'), `${myPointsSpent ?? 0} / ${epbMeta.draft_budget}`],
              [t('board.epb.pointsRemaining'), String(myBudgetRemaining ?? epbMeta.draft_budget)],
              [t('board.epb.picksUsed'), `${myPicksUsed} / ${epbMeta.draft_picks}`],
              [t('board.epb.picksRemaining'), String(myPicksRemaining ?? epbMeta.draft_picks)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-poke-md border border-hairline bg-surface px-3 py-2">
                <dt className="text-caption text-fg-muted">{label}</dt>
                <dd className="font-heading text-title text-fg tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          {status === 'complete' && (
            <p className="mt-3 text-caption text-fg-muted">
              {t.rich('board.epb.purchasableTokens', {
                count: epbMeta.purchasable_tokens_by_player[currentPlayerId] ?? 0,
                ratio: epbMeta.token_ratio,
                max: epbMeta.token_max,
                b: (chunks) => <strong className="text-fg">{chunks}</strong>,
              })}
            </p>
          )}
        </div>
      )}

      {/* The clock: status, whose pick it is, this round's seat order and the actions, on one slab. */}
      <section
        className={cn(
          'relative isolate overflow-hidden rounded-poke-lg border bg-surface',
          isMyTurn && live ? 'border-accent-fill' : 'border-hairline-strong',
        )}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 -right-12 -z-10 hidden w-[46%] border-l-4 border-accent-fill bg-sunken [transform:skewX(var(--skew))] md:block"
        />
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between md:gap-10 md:p-5">
          <div className="flex min-w-0 flex-col gap-2 md:w-1/2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <SkewChip tone={statusTone}>{enumLabel(tEnums, 'draftPoolStatus', status)}</SkewChip>
              <span className="font-mono text-caption text-fg-muted tabular-nums">{progressLabel}</span>
            </div>
            {status === 'pending' && <p className="font-heading text-title text-fg">{t('board.notStarted')}</p>}
            {status === 'complete' && <p className="font-heading text-display text-fg">{t('board.complete')}</p>}
            {/* Current picker callout (snake and linear order) */}
            {live && turnEnforced && state.current_picker && (
              <p className={cn('font-heading text-fg', isMyTurn ? 'text-display' : 'text-title')}>
                {isMyTurn
                  ? t('board.yourTurn')
                  : t('board.waitingFor', { name: playerNames[state.current_picker] ?? tLegacy('unknownPlayer') })}
              </p>
            )}
            {/* Free order: no turn, so no "your turn" / "waiting for"; admins choose whose pick they enter. */}
            {live && !turnEnforced && <p className="text-body text-fg">{t('board.freeOrder')}</p>}
          </div>

          <div className="flex min-w-0 flex-col gap-3 md:w-[42%] md:items-end">
            {showSeats && (
              <div className="flex flex-col gap-1 md:items-end">
                <p className="text-caption text-fg-muted">{t('board.seatOrder')}</p>
                <ol className="-mx-1 flex flex-wrap gap-y-1 md:justify-end">
                  {state.pick_order.map((playerId, seat) => (
                    <li key={playerId} aria-current={playerId === state.current_picker ? 'true' : undefined}>
                      <SkewPlate variant="nav" active={playerId === state.current_picker} className="text-body">
                        <span className="mr-1.5 font-mono text-caption tabular-nums">{seat + 1}</span>
                        {playerNames[playerId] ?? tLegacy('unknownPlayer')}
                      </SkewPlate>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {live && !turnEnforced && isAdmin && (
              <Select
                label={t('board.pickFor')}
                value={picker ?? ''}
                onChange={(e) => setPickFor(e.currentTarget.value)}
                className="h-9 py-1"
              >
                {Object.keys(state.rosters).map((playerId) => (
                  <option key={playerId} value={playerId}>
                    {playerNames[playerId] ?? tLegacy('unknownPlayer')}
                  </option>
                ))}
              </Select>
            )}
            {hasActions ? (
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                {live && canPick && (
                  <Button variant="primary" size={isMyTurn ? 'lg' : 'md'} onClick={() => setShowPicker(true)}>
                    {t('board.makePick')}
                  </Button>
                )}
                {adminEvents.includes('start') && (
                  <Button variant="success" size="sm" onClick={() => handleStatusChange('in_progress')}>
                    {t('board.startDraft')}
                  </Button>
                )}
                {showUndo && (
                  <Button variant="ghost" size="sm" onClick={handleUndo}>
                    {t('board.undoLastPick')}
                  </Button>
                )}
                {showEnd && (
                  <Button variant="ghost" size="sm" onClick={() => setConfirming('end')}>
                    {t('board.endDraft')}
                  </Button>
                )}
              </div>
            ) : (
              !showSeats && <ItemIcon item="premier-ball" size={48} className="hidden md:inline-block" />
            )}
          </div>
        </div>
      </section>

      {/* Fixed prices in turn order: the current picker can afford nothing that completes their roster. */}
      {state.pool.status === 'in_progress' && stall && (
        <DraftStallNotice
          stall={stall}
          name={stalledName}
          currentPlayerId={currentPlayerId}
          isAdmin={isAdmin}
          onSwitch={() => setConfirming('freeOrder')}
        />
      )}

      <ConfirmDialog
        open={confirming === 'freeOrder' && stall !== null}
        onClose={() => setConfirming(null)}
        onConfirm={handleFreeOrder}
        title={t('board.stall.confirmTitle')}
        message={t('board.stall.confirmBody', { name: stalledName })}
        confirmLabel={t('board.stall.switch')}
        confirmVariant="primary"
        loading={busy}
      />
      <ConfirmDialog
        open={confirming === 'end'}
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          setConfirming(null);
          await handleStatusChange('complete');
        }}
        title={t('board.endConfirmTitle')}
        message={t('board.endConfirmBody')}
        confirmLabel={t('board.endDraft')}
      />

      {showTokenCta && seasonId && (
        <div className="flex flex-col gap-3 rounded-poke-lg border border-hairline bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ItemIcon item="amulet-coin" className="mt-0.5" />
            <p className="text-body text-fg-muted">{t('board.tokens.intro')}</p>
          </div>
          <Button asChild variant="primary" className="shrink-0">
            <Link href={`/leagues/${seasonId}/tokens`}>{t('board.tokens.title')}</Link>
          </Button>
        </div>
      )}

      {errorText && (
        <Alert variant="error">{errorText}</Alert>
      )}

      <PickWarnings warnings={pickWarnings} />

      {/* Evolution events banner */}
      {evolutionEvents.length > 0 && (
        <EvolutionEventBanner
          events={evolutionEvents}
          playerNames={playerNames}
        />
      )}

      {/* Rosters grid */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 font-heading text-title text-fg">
          <ItemIcon item="choice-scarf" />
          {t('board.rosters')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[18px]">
          {Object.entries(state.rosters).map(([playerId, pokemon]) => {
            const playerTrackers = evoTrackers[playerId] ?? [];

            if (isEvoLeague && playerTrackers.length > 0) {
              const trackedBaseNames = new Set(
                playerTrackers.map((t) => t.base_pokemon)
              );
              const regularPokemon = pokemon.filter(
                (name) => !trackedBaseNames.has(name)
              );

              return (
                <EvolutionRosterCard
                  key={playerId}
                  playerName={playerNames[playerId] ?? tLegacy('unknownPlayer')}
                  trackers={playerTrackers}
                  regularPokemon={regularPokemon}
                  budget={state.budgets?.[playerId] ?? null}
                  isCurrentPicker={turnEnforced && playerId === state.current_picker}
                  picksRemaining={
                    epbMeta
                      ? Math.max(0, epbMeta.draft_picks - (epbMeta.picks_by_player[playerId] ?? 0))
                      : undefined
                  }
                />
              );
            }

            return (
              <RosterCard
                key={playerId}
                playerName={playerNames[playerId] ?? tLegacy('unknownPlayer')}
                pokemon={pokemon}
                budget={state.budgets?.[playerId] ?? null}
                isCurrentPicker={turnEnforced && playerId === state.current_picker}
                picksRemaining={
                  epbMeta
                    ? Math.max(0, epbMeta.draft_picks - (epbMeta.picks_by_player[playerId] ?? 0))
                    : undefined
                }
              />
            );
          })}
        </div>
      </section>

      {/* Pick history */}
      {state.picks.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading text-title text-fg">
            <ItemIcon item="metronome" />
            {t('board.pickHistory')}
          </h2>
          <Table
            columns={pickColumns}
            data={state.picks}
            keyExtractor={(pick) => pick.id}
          />
        </section>
      )}

      {/* Pick modal */}
      {showPicker && (
        <PickSelector
          takenPokemon={takenSet}
          draftType={state.pool.draft_type}
          defaultPointCost={state.pool.default_point_cost}
          remainingBudget={state.budgets && picker ? state.budgets[picker] ?? 0 : null}
          onPick={handlePick}
          onClose={() => setShowPicker(false)}
          poolEntries={poolEntries}
          evoTiers={evoTiers}
          tierLimits={tierLimits}
          playerRoster={picker ? state.rosters[picker] ?? [] : []}
          isEpb={isEpb}
          error={errorText}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function RosterCard({
  playerName,
  pokemon,
  budget,
  isCurrentPicker,
  picksRemaining,
}: {
  playerName: string;
  pokemon: string[];
  budget: number | null;
  isCurrentPicker: boolean;
  picksRemaining?: number;
}) {
  const tLegacy = useT(draftLegacyMessages);
  const dataLocale = useDataLocale();
  return (
    <div
      className={cn(
        'overflow-hidden rounded-poke-lg border bg-surface',
        isCurrentPicker ? 'border-accent-fill' : 'border-hairline',
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-3 border-b px-3 py-2',
          isCurrentPicker ? 'border-accent-fill bg-accent-subtle' : 'border-hairline bg-elevated',
        )}
      >
        <span className="min-w-0 break-words font-heading text-title text-fg">{playerName}</span>
        <div className="shrink-0 text-right font-mono text-caption text-fg-muted tabular-nums">
          {budget !== null && <div>{tLegacy('ptsRemaining', { n: budget })}</div>}
          {picksRemaining !== undefined && <div>{tLegacy('picksLeft', { count: picksRemaining })}</div>}
        </div>
      </div>
      <div className="p-3">
        {pokemon.length === 0 ? (
          <p className="text-caption text-fg-muted">{tLegacy('noPicksYet')}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {pokemon.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1.5 rounded-poke-sm bg-elevated py-0.5 pr-2 pl-1 text-caption text-fg"
              >
                <AnimatedSprite>
                  <PokemonSprite name={name} size={28} />
                </AnimatedSprite>
                <span>{localizeSpecies(name, dataLocale)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
