'use client';

import type { TrackerState } from '@/types/broadcast';
import type { TrackerDispatchAction } from '@/lib/broadcast/tracker-reducer';
import { useT } from '@/i18n/client';
import { broadcastCasterMessages } from '@/i18n/messages/broadcast-caster';
import { usePlayerDisplayName } from './usePlayerDisplayName';

interface TrackerScorebarProps {
  state: TrackerState;
  dispatch: (action: TrackerDispatchAction) => void;
  /** Show turn counter (Producer Mode) */
  showTurnCounter?: boolean;
}

export default function TrackerScorebar({
  state,
  dispatch,
  showTurnCounter = false,
}: TrackerScorebarProps) {
  const t = useT(broadcastCasterMessages);
  const displayName = usePlayerDisplayName();
  const { games_submitted, current_game } = state;
  const p1Wins = games_submitted.filter(
    (g) => g.winner_id === current_game.player1.player_id
  ).length;
  const p2Wins = games_submitted.filter(
    (g) => g.winner_id === current_game.player2.player_id
  ).length;

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Series score */}
      <div className="flex items-center gap-4">
        <div className="text-right">
          <span className="text-2xl font-bold text-poke-text">{p1Wins}</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-poke-text-secondary uppercase tracking-wider">{t('tracker.game', { game: current_game.game_number })}</span>
          <span className="text-lg font-bold text-poke-text">VS</span>
        </div>
        <div className="text-left">
          <span className="text-2xl font-bold text-poke-text">{p2Wins}</span>
        </div>
      </div>

      {/* Turn counter (Producer Mode) */}
      {showTurnCounter && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => dispatch({ type: 'decrement_turn' })}
            disabled={current_game.turn === 0}
            aria-label={t('tracker.previousTurn')}
            className="w-7 h-7 rounded-lg bg-poke-elevated text-poke-text-secondary hover:text-poke-text hover:bg-poke-border transition-colors disabled:opacity-30 text-sm font-bold"
          >
            −
          </button>
          <span className="text-xs text-poke-text-secondary min-w-[60px] text-center">
            {t('tracker.turn', { turn: current_game.turn })}
          </span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'increment_turn' })}
            aria-label={t('tracker.nextTurn')}
            className="w-7 h-7 rounded-lg bg-poke-elevated text-poke-text-secondary hover:text-poke-text hover:bg-poke-border transition-colors text-sm font-bold"
          >
            +
          </button>
        </div>
      )}

      {/* Game history pills */}
      {games_submitted.length > 0 && (
        <div className="flex items-center gap-1 mt-1">
          {games_submitted.map((g, i) => {
            const isP1Win = g.winner_id === current_game.player1.player_id;
            return (
              <div
                key={g.id}
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  isP1Win
                    ? 'bg-blue-500/30 text-blue-300'
                    : 'bg-red-500/30 text-red-300'
                }`}
                title={t('tracker.gameWonBy', {
                  game: i + 1,
                  name: displayName(
                    isP1Win ? current_game.player1.player_name : current_game.player2.player_name,
                  ),
                })}
              >
                {i + 1}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
