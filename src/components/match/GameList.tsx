'use client';

import Badge from '@/components/ui/Badge';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { matchMessages } from '@/i18n/messages/match';
import type { GameSummary } from '@/types/match';

interface GameListProps {
  games: GameSummary[];
  player1Name: string;
  player2Name: string;
  player1Id: string;
  player2Id: string;
}

export default function GameList({
  games,
  player1Name,
  player2Name,
  player1Id,
  player2Id,
}: GameListProps) {
  const t = useT(matchMessages);
  const tEnum = useT(enumMessages);

  if (games.length === 0) {
    return <p className="text-body text-fg-muted">{t('detail.noGames')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-caption font-[550] text-fg-muted">{t('detail.games')}</h4>
      {games.map((game) => {
        const winnerName =
          game.winner_id === player1Id
            ? player1Name
            : game.winner_id === player2Id
              ? player2Name
              : null;

        return (
          <div
            key={game.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-poke-md border border-hairline bg-elevated px-3 py-2 text-body"
          >
            <span className="min-w-6 font-heading text-fg-muted">{t('gameList.gameShort', { n: game.game_number })}</span>
            <span className="min-w-0 flex-1">
              {winnerName ? (
                <span className="font-[550] text-fg">{t('gameList.wins', { name: winnerName })}</span>
              ) : (
                <span className="text-fg-muted">{t('gameList.pending')}</span>
              )}
            </span>
            <Badge variant="gray" size="sm">{enumLabel(tEnum, 'gameSource', game.source)}</Badge>
            {game.replay_url && (
              <a
                href={game.replay_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-caption font-[550] text-accent-ink underline-offset-4 hover:underline"
              >
                {t('gameList.replay')}
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
