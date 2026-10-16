'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import PokemonSprite from '@/components/shared/PokemonSprite';
import PokemonLink from '@/components/shared/PokemonLink';
import AnimatedSprite from '@/components/shared/AnimatedSprite';
import PickSelector from './PickSelector';
import EvolutionRosterCard from './EvolutionRosterCard';
import EvolutionEventBanner from './EvolutionEventBanner';
import DraftStallNotice from './DraftStallNotice';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Table, { type Column } from '@/components/ui/Table';
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

  async function handlePick(pokemonName: string, pointsSpent?: number, stage3Pokemon?: string | null) {
    try {
      const body: Record<string, unknown> = {
        player_id: (state && pickerOf(state, { currentPlayerId, isAdmin, pickFor })) ?? currentPlayerId,
        pokemon_name: pokemonName,
      };
      if (pointsSpent !== undefined) body.points_spent = pointsSpent;
      if (stage3Pokemon !== undefined) body.stage3_pokemon = stage3Pokemon;

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
        render: (pick) => <span className="text-poke-text-muted">{pick.pick_number}</span>,
      },
      {
        key: 'round',
        header: t('board.columns.round'),
        sortable: true,
        sortValue: (pick) => pick.round,
        render: (pick) => <span className="text-poke-text-muted">{pick.round}</span>,
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
        render: (pick) => <span className="text-poke-text-muted">{pick.points_spent ?? '-'}</span>,
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
    return <div className="p-8 text-center text-poke-text-muted">{t('board.loading')}</div>;
  }

  if (!state) {
    return <div className="p-8 text-center text-poke-danger">{errorText || t('board.errors.loadFailed')}</div>;
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

  return (
    <div className="space-y-6">
      {isEpb && epbMeta && (
        <Card variant="outlined" padding="sm">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-poke-text-muted">{t('board.epb.pointsUsed')}</p>
              <p className="text-lg font-bold">{myPointsSpent ?? 0} / {epbMeta.draft_budget}</p>
            </div>
            <div>
              <p className="text-poke-text-muted">{t('board.epb.pointsRemaining')}</p>
              <p className="text-lg font-bold">{myBudgetRemaining ?? epbMeta.draft_budget}</p>
            </div>
            <div>
              <p className="text-poke-text-muted">{t('board.epb.picksUsed')}</p>
              <p className="text-lg font-bold">{myPicksUsed} / {epbMeta.draft_picks}</p>
            </div>
            <div>
              <p className="text-poke-text-muted">{t('board.epb.picksRemaining')}</p>
              <p className="text-lg font-bold">{myPicksRemaining ?? epbMeta.draft_picks}</p>
            </div>
          </div>
          {state.pool.status === 'complete' && (
            <p className="mt-3 text-xs text-poke-text-secondary">
              {t.rich('board.epb.purchasableTokens', {
                count: epbMeta.purchasable_tokens_by_player[currentPlayerId] ?? 0,
                ratio: epbMeta.token_ratio,
                max: epbMeta.token_max,
                b: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          )}
        </Card>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between p-4 bg-poke-surface rounded-poke-lg border border-poke-border shadow-poke-card">
        <div className="flex items-center">
          <StatusBadge status={state.pool.status} label={enumLabel(tEnums, 'draftPoolStatus', state.pool.status)} />
          <span className="ml-3 text-sm text-poke-text-muted">
            {t('board.roundPick', { round: state.current_round, pick: state.next_pick_number })}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && state.pool.status === 'pending' && (
            <Button variant="success" size="sm" onClick={() => handleStatusChange('in_progress')}>
              {t('board.startDraft')}
            </Button>
          )}
          {isAdmin && state.pool.status === 'in_progress' && state.picks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleUndo} className="text-yellow-600 hover:bg-poke-yellow-light">
              {t('board.undoLastPick')}
            </Button>
          )}
        </div>
      </div>

      {/* Free order: no turn, so no "your turn" / "waiting for"; admins choose whose pick they enter. */}
      {state.pool.status === 'in_progress' && state.current_picker && !turnEnforced && (
        <div className="p-4 rounded-poke-lg border-2 border-poke-blue bg-poke-blue-light text-center space-y-2">
          <p className="text-sm text-poke-text-primary">{t('board.freeOrder')}</p>
          {isAdmin && (
            <label className="inline-flex items-center gap-2 text-sm text-poke-text-primary">
              <span className="font-semibold">{t('board.pickFor')}</span>
              <select
                value={picker ?? ''}
                onChange={(e) => setPickFor(e.currentTarget.value)}
                className="px-2 py-1 border border-poke-border bg-poke-surface rounded-poke-md text-sm"
              >
                {Object.keys(state.rosters).map((playerId) => (
                  <option key={playerId} value={playerId}>
                    {playerNames[playerId] ?? tLegacy('unknownPlayer')}
                  </option>
                ))}
              </select>
            </label>
          )}
          {canPick && (
            <div>
              <Button variant="primary" onClick={() => setShowPicker(true)}>
                {t('board.makePick')}
              </Button>
            </div>
          )}
          {isAdmin && (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setConfirming('end')}>
                {t('board.endDraft')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Current picker callout (snake and linear order) */}
      {state.pool.status === 'in_progress' && state.current_picker && turnEnforced && (
        <div
          className={`p-4 rounded-poke-lg border-2 text-center ${
            isMyTurn
              ? 'border-poke-green bg-poke-green-light'
              : 'border-poke-blue bg-poke-blue-light'
          }`}
        >
          <p className="text-lg font-heading font-semibold text-poke-text-primary">
            {isMyTurn
              ? t('board.yourTurn')
              : t('board.waitingFor', { name: playerNames[state.current_picker] ?? tLegacy('unknownPlayer') })}
          </p>
          {canPick && (
            <div className="mt-2">
              <Button variant="primary" onClick={() => setShowPicker(true)}>
                {t('board.makePick')}
              </Button>
            </div>
          )}
        </div>
      )}

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

      {state.pool.status === 'complete' && (
        <Alert variant="success">
          <p className="text-lg font-heading font-bold">{t('board.complete')}</p>
        </Alert>
      )}

      {showTokenCta && seasonId && (
        <Card variant="outlined" padding="md">
          <p className="text-sm text-poke-text-secondary mb-4">
            {t('board.tokens.intro')}
          </p>
          <Button asChild variant="primary">
            <Link href={`/leagues/${seasonId}/tokens`}>{t('board.tokens.title')}</Link>
          </Button>
        </Card>
      )}

      {errorText && (
        <Alert variant="error">{errorText}</Alert>
      )}

      {/* Evolution events banner */}
      {evolutionEvents.length > 0 && (
        <EvolutionEventBanner
          events={evolutionEvents}
          playerNames={playerNames}
        />
      )}

      {/* Rosters grid */}
      <div>
        <h3 className="font-heading font-semibold text-lg text-poke-text-primary mb-3">{t('board.rosters')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>

      {/* Pick history */}
      {state.picks.length > 0 && (
        <div>
          <h3 className="font-heading font-semibold text-lg text-poke-text-primary mb-3">{t('board.pickHistory')}</h3>
          <Table
            columns={pickColumns}
            data={state.picks}
            keyExtractor={(pick) => pick.id}
          />
        </div>
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

/** The pool status badge; the label comes from `enums.draftPoolStatus` (i18n-core §5.3). */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const variants: Record<string, 'yellow' | 'blue' | 'green'> = {
    pending: 'yellow',
    in_progress: 'blue',
    complete: 'green',
  };

  return (
    <Badge variant={variants[status] ?? 'gray'} size="sm">
      {label}
    </Badge>
  );
}

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
    <Card
      variant="outlined"
      padding="sm"
      className={isCurrentPicker ? 'border-poke-border-focus ring-1 ring-poke-border-focus/30' : ''}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-heading font-medium text-sm text-poke-text-primary">{playerName}</span>
        <div className="text-xs text-poke-text-muted text-right">
          {budget !== null && <div>{tLegacy('ptsRemaining', { n: budget })}</div>}
          {picksRemaining !== undefined && <div>{tLegacy('picksLeft', { count: picksRemaining })}</div>}
        </div>
      </div>
      {pokemon.length === 0 ? (
        <p className="text-xs text-poke-text-muted">{tLegacy('noPicksYet')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {pokemon.map((name) => (
            <div
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-poke-muted rounded-poke-sm text-xs text-poke-text-secondary"
            >
              <AnimatedSprite>
                <PokemonSprite name={name} size={20} />
              </AnimatedSprite>
              <span>{localizeSpecies(name, dataLocale)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
