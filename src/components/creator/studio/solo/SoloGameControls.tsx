'use client';

import { useMemo } from 'react';
import { useCastStudio } from '../CastStudioContext';
import { useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';

/**
 * SoloGameControls — Win/Loss submission and running session record.
 * Dispatches submit_solo_game to freeze the current game and advance.
 */
export default function SoloGameControls() {
  const { state, dispatchTracker } = useCastStudio();
  const { tracker } = state;
  const t = useT(creatorStudioMessages);

  const record = useMemo(() => {
    const p1Id = tracker.current_game.player1.player_id;
    let wins = 0;
    let losses = 0;
    for (const game of tracker.games_submitted) {
      if (game.winner_id === p1Id) wins++;
      else losses++;
    }
    return { wins, losses };
  }, [tracker.games_submitted, tracker.current_game.player1.player_id]);

  const handleResult = (won: boolean) => {
    dispatchTracker({ type: 'submit_solo_game', won });
  };

  return (
    <div className="rounded-poke-lg border border-poke-border bg-poke-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-heading text-sm font-bold text-poke-text-secondary uppercase tracking-wide">
            {t('solo.game', { n: tracker.current_game.game_number })}
          </h3>
          {tracker.games_submitted.length > 0 && (
            <p className="text-xs text-poke-text-secondary mt-0.5">
              {t.rich('solo.record', {
                wins: record.wins,
                losses: record.losses,
                win: (chunks) => <span className="text-green-400 font-bold">{chunks}</span>,
                loss: (chunks) => <span className="text-red-400 font-bold">{chunks}</span>,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleResult(true)}
            className="rounded-poke-md bg-green-500/20 px-4 py-2 text-sm font-heading font-bold text-green-400 hover:bg-green-500/30 transition-colors"
          >
            {t('solo.won')}
          </button>
          <button
            onClick={() => handleResult(false)}
            className="rounded-poke-md bg-red-500/20 px-4 py-2 text-sm font-heading font-bold text-red-400 hover:bg-red-500/30 transition-colors"
          >
            {t('solo.lost')}
          </button>
        </div>
      </div>
    </div>
  );
}
