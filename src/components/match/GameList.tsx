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
    return <p className="text-sm text-poke-text-muted">{t('detail.noGames')}</p>;
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-heading font-medium text-poke-text-secondary">{t('detail.games')}</h4>
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
            className="flex items-center gap-3 p-2 bg-poke-muted border border-poke-border rounded-poke-md text-sm"
          >
            <span className="text-poke-text-muted w-6">{t('gameList.gameShort', { n: game.game_number })}</span>
            <span className="flex-1">
              {winnerName ? (
                <span className="font-medium text-poke-text-primary">{t('gameList.wins', { name: winnerName })}</span>
              ) : (
                <span className="text-poke-text-muted">{t('gameList.pending')}</span>
              )}
            </span>
            <Badge variant="gray" size="sm">{enumLabel(tEnum, 'gameSource', game.source)}</Badge>
            {game.replay_url && (
              <a
                href={game.replay_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-poke-blue hover:underline font-heading"
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
