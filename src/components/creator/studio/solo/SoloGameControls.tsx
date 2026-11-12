'use client';

import { useMemo } from 'react';
import { useCastStudio } from '../CastStudioContext';
import Button from '@/components/ui/Button';
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
    <div className="rounded-poke-lg border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div>
          <h3 className="font-heading text-subtitle text-fg">
            {t('solo.game', { n: tracker.current_game.game_number })}
          </h3>
          {tracker.games_submitted.length > 0 && (
            <p className="mt-0.5 text-caption text-fg-muted">
              {t.rich('solo.record', {
                wins: record.wins,
                losses: record.losses,
                win: (chunks) => <span className="font-[550] text-win">{chunks}</span>,
                loss: (chunks) => <span className="font-[550] text-loss">{chunks}</span>,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="success" onClick={() => handleResult(true)}>
            {t('solo.won')}
          </Button>
          <Button variant="danger" onClick={() => handleResult(false)}>
            {t('solo.lost')}
          </Button>
        </div>
      </div>
    </div>
  );
}
