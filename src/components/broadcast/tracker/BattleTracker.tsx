'use client';

import { useReducer, useCallback, useState } from 'react';
import TrackerTeamColumn from './TrackerTeamColumn';
import TrackerScorebar from './TrackerScorebar';
import TrackerControls from './TrackerControls';
import TrackerQuickEntry from './TrackerQuickEntry';
import TrackerToolsPanel from './TrackerToolsPanel';
import MomentumIndicator from './MomentumIndicator';
import MomentumTimeline from './MomentumTimeline';
import RatingChangePreview from './RatingChangePreview';
import NextMatchTeaser from './NextMatchTeaser';
import CommentaryPrompts from './CommentaryPrompts';
import { CasterDataProvider } from './CasterDataContext';
import { usePlayerDisplayName } from './usePlayerDisplayName';
import HotkeyHelpModal from './HotkeyHelpModal';
import { HotkeyProvider } from '@/hooks/useHotkeyContext';
import { useHotkeys } from '@/hooks/useHotkeys';
import type { GameSummary } from '@/types/match';
import type { CasterData } from '@/types/caster';
import { useT } from '@/i18n/client';
import type { ApiErrorLike } from '@/i18n/api-errors';
import { useApiErrorText } from '@/i18n/use-api-error';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { errorsMatches } from '@/i18n/messages/errors/matches';
import {
  trackerReducer,
  createInitialState,
  buildGamePayload,
  type TrackerDispatchAction,
} from '@/lib/broadcast/tracker-reducer';
import { nextTrackerWarning, submitManualResult } from '@/lib/broadcast/manual-result-response';
import TrackerWarningBanner from './TrackerWarningBanner';

/** Error marker for a failed response that carries neither `error` nor `code`. */
const SUBMIT_FAILED = Symbol('submitFailed');

interface BattleTrackerProps {
  matchId: string;
  player1: { id: string; name: string; avatar_url: string | null; pokemon?: string[] };
  player2: { id: string; name: string; avatar_url: string | null; pokemon?: string[] };
  gamesSubmitted?: GameSummary[];
  /** Best-of count for the match (e.g. 3 for Bo3) */
  bestOf?: number;
  /** Pre-fetched caster enrichment data */
  casterData?: CasterData | null;
  /** Cast session ID for auto-save features (notes, etc.) */
  sessionId?: string;
}

export default function BattleTracker({
  matchId,
  player1,
  player2,
  gamesSubmitted = [],
  bestOf,
  casterData = null,
  sessionId,
}: BattleTrackerProps) {
  const [state, dispatch] = useReducer(
    trackerReducer,
    createInitialState(matchId, player1, player2, gamesSubmitted)
  );

  const [producerMode, setProducerMode] = useState(false);
  const [quickEntry, setQuickEntry] = useState<{ player: 1 | 2; slot: number } | null>(null);
  const t = useT(broadcastCasterMessages);
  const displayName = usePlayerDisplayName();
  const errorText = useApiErrorText(errorsMatches);
  // Store the error object (or the local fallback marker), never translated text.
  const [error, setError] = useState<ApiErrorLike | typeof SUBMIT_FAILED | null>(null);
  // A warning the server sent with a recorded game (e.g. its moments were not
  // saved): the game counts, but the caster must see what was lost.
  const [warning, setWarning] = useState<ApiErrorLike | null>(null);

  const handleSubmitGame = useCallback(
    async (payload: ReturnType<typeof buildGamePayload>) => {
      setError(null);
      setWarning((current) => nextTrackerWarning(current, { type: 'submit' }));
      const outcome = await submitManualResult(payload);
      setWarning((current) => nextTrackerWarning(current, { type: 'outcome', outcome }));
      if (!outcome.ok) {
        setError(outcome.error ?? SUBMIT_FAILED);
        return;
      }
      // Record the submitted game and advance
      const game: GameSummary = {
        id: outcome.gameId ?? crypto.randomUUID(),
        game_number: state.current_game.game_number,
        winner_id: payload.winner_id,
        replay_url: '',
        source: 'manual',
        stats_locked: false,
      };
      dispatch({ type: 'submit_game', game });
    },
    [state.current_game.game_number]
  );

  // Check if match is complete
  const p1Wins = state.games_submitted.filter(
    (g) => g.winner_id === state.current_game.player1.player_id
  ).length;
  const p2Wins = state.games_submitted.filter(
    (g) => g.winner_id === state.current_game.player2.player_id
  ).length;
  const winsNeeded = bestOf ? Math.ceil(bestOf / 2) : Infinity;
  const matchComplete = p1Wins >= winsNeeded || p2Wins >= winsNeeded;

  // Wrap dispatch to handle quick-entry opens for empty slots
  const trackerDispatch = useCallback(
    (action: TrackerDispatchAction) => {
      // If tapping an empty slot, open quick entry instead
      if (
        'slot' in action &&
        'player' in action &&
        (action.type === 'mark_brought' || action.type === 'mark_lead')
      ) {
        const key = action.player === 1 ? 'player1' : 'player2';
        const slot = state.current_game[key].slots[action.slot];
        if (!slot.pokemon_name) {
          setQuickEntry({ player: action.player, slot: action.slot });
          return;
        }
      }
      dispatch(action);
    },
    [state]
  );

  return (
    <HotkeyProvider>
    <CasterDataProvider data={casterData}>
    <div className="flex flex-col gap-4 max-w-4xl mx-auto">
      {/* Mode toggle */}
      <div className="flex items-center justify-between px-2">
        <h2 className="text-lg font-bold text-poke-text">
          {t('tracker.title')}
        </h2>
        <label className="flex items-center gap-2 text-xs text-poke-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={producerMode}
            onChange={(e) => setProducerMode(e.target.checked)}
            className="rounded border-poke-border"
          />
          {t('tracker.producerMode')}
        </label>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error === SUBMIT_FAILED ? t('tracker.submitFailed') : errorText(error)}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 text-red-300 hover:text-red-100"
            aria-label={t('tracker.dismissError')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Warning banner: the game was recorded, something attached to it was not */}
      {warning && (
        <TrackerWarningBanner
          warning={warning}
          onDismiss={() => setWarning((current) => nextTrackerWarning(current, { type: 'dismiss' }))}
        />
      )}

      {/* Series momentum timeline */}
      {state.games_submitted.length > 0 && (
        <div className="flex justify-center">
          <MomentumTimeline gamesSubmitted={state.games_submitted} />
        </div>
      )}

      {/* Match complete banner */}
      {matchComplete && (
        <div className="space-y-3">
          <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
            <div className="text-lg font-bold text-emerald-400">{t('tracker.matchComplete')}</div>
            <div className="text-sm text-poke-text-secondary mt-1">
              {t('tracker.matchWinner', {
                name:
                  displayName(
                    p1Wins > p2Wins
                      ? state.current_game.player1.player_name
                      : state.current_game.player2.player_name,
                  ),
                a: Math.max(p1Wins, p2Wins),
                b: Math.min(p1Wins, p2Wins),
              })}
            </div>
          </div>
          {/* Post-match: Rating preview + Next match */}
          <RatingChangePreview />
          <NextMatchTeaser />
        </div>
      )}

      {/* Main tracker grid */}
      {!matchComplete && (
        <>
          {/* Score bar */}
          <TrackerScorebar
            state={state}
            dispatch={dispatch}
            showTurnCounter={producerMode}
          />

          {/* Momentum indicator */}
          {casterData && <MomentumIndicator state={state} />}

          {/* Two-column layout */}
          <div className="grid grid-cols-2 gap-4 relative">
            {/* Player 1 */}
            <TrackerTeamColumn
              playerState={state.current_game.player1}
              player={1}
              dispatch={trackerDispatch}
              showMoves={producerMode}
            />

            {/* Player 2 */}
            <TrackerTeamColumn
              playerState={state.current_game.player2}
              player={2}
              dispatch={trackerDispatch}
              showMoves={producerMode}
            />

            {/* Quick entry overlay */}
            {quickEntry && (
              <div
                className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 rounded-xl"
                onClick={() => setQuickEntry(null)}
              >
                <div
                  className="w-72"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TrackerQuickEntry
                    player={quickEntry.player}
                    slotIndex={quickEntry.slot}
                    dispatch={dispatch}
                    onClose={() => setQuickEntry(null)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <TrackerControls
            state={state}
            dispatch={dispatch}
            onSubmitGame={handleSubmitGame}
            producerMode={producerMode}
          />

          {/* Commentary prompts (Producer Mode) */}
          {producerMode && casterData && (
            <CommentaryPrompts
              state={state}
              seriesScore={[p1Wins, p2Wins]}
            />
          )}

          {/* Tools panel (Speed Tiers, Type Matrix, etc.) */}
          {casterData && <TrackerToolsPanel sessionId={sessionId} />}
        </>
      )}

      <TrackerHotkeys dispatch={dispatch} setProducerMode={setProducerMode} enabled={!matchComplete} />
      <HotkeyHelpModal />
    </div>
    </CasterDataProvider>
    </HotkeyProvider>
  );
}

// ─── Child component: runs inside HotkeyProvider ─────────────────────

function TrackerHotkeys({
  dispatch,
  setProducerMode,
  enabled,
}: {
  dispatch: (action: TrackerDispatchAction) => void;
  setProducerMode: React.Dispatch<React.SetStateAction<boolean>>;
  enabled: boolean;
}) {
  const t = useT(broadcastCasterMessages);
  const hotkeyBindings = [
    ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({
      key: String(n),
      handler: () => dispatch({ type: 'mark_brought' as const, player: 1 as const, slot: n - 1 }),
      description: t('hotkeys.toggleBring', { player: 'P1', slot: n }),
    })),
    ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({
      key: `shift+${n}`,
      handler: () => dispatch({ type: 'mark_brought' as const, player: 2 as const, slot: n - 1 }),
      description: t('hotkeys.toggleBring', { player: 'P2', slot: n }),
    })),
    ...(['q', 'w', 'e', 'r', 't', 'y'] as const).map((key, i) => ({
      key,
      handler: () => dispatch({ type: 'mark_ko' as const, player: 1 as const, slot: i }),
      description: t('hotkeys.toggleKo', { player: 'P1', slot: i + 1 }),
    })),
    ...(['q', 'w', 'e', 'r', 't', 'y'] as const).map((key, i) => ({
      key: `shift+${key}`,
      handler: () => dispatch({ type: 'mark_ko' as const, player: 2 as const, slot: i }),
      description: t('hotkeys.toggleKo', { player: 'P2', slot: i + 1 }),
    })),
    { key: 'ctrl+z', handler: () => dispatch({ type: 'undo' as const }), description: t('hotkeys.undo') },
    { key: 'u', handler: () => dispatch({ type: 'undo' as const }), description: t('hotkeys.undoAlt') },
    { key: 'p', handler: () => setProducerMode((m: boolean) => !m), description: t('hotkeys.toggleProducer') },
  ];
  useHotkeys(hotkeyBindings, { scope: 'tracker', enabled });
  return null;
}
