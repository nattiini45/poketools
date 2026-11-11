'use client';

import Link from 'next/link';
import { useFormatter, useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import SkewChip from '@/components/ui/SkewChip';
import type { PublicPlayer } from '@/types/player';
import type { ProfileMatch } from '@/types/profile';
import ResultToken from './ResultToken';

interface ProfileMatchListProps {
  title: string;
  matches: ProfileMatch[];
  playerId: string;
  emptyMessage?: string;
  /** The profile's own trainer, so a row carries both sides of the match. */
  player?: Pick<PublicPlayer, 'name' | 'avatar_url'>;
}

function MatchRow({ match, playerId, player }: { match: ProfileMatch; playerId: string; player?: ProfileMatchListProps['player'] }) {
  const t = useT(profileMessages);
  const formatter = useFormatter();
  const isWin = match.winner_id === playerId;
  const isLoss = match.winner_id !== null && match.winner_id !== playerId;
  const isScheduled = match.status === 'scheduled' || match.status === 'in_progress';

  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-poke-md border border-hairline bg-elevated px-3 py-2 transition-colors duration-80 ease-out hover:border-hairline-strong hover:bg-hover">
      <Link
        href={`/tournaments/${match.tournament_id}/matches/${match.id}`}
        className="absolute inset-0 z-0 rounded-poke-md"
        aria-label={t('matchList.viewMatch', { opponent: match.opponent_name })}
      />
      <div className="flex min-w-0 items-center gap-2.5">
        {!isScheduled && <ResultToken result={isWin ? 'W' : isLoss ? 'L' : 'D'} />}
        {player && <PlayerAvatar avatarUrl={player.avatar_url} name={player.name} size={28} />}
        {isScheduled ? (
          <SkewChip tone="accent">{t('matchList.versus')}</SkewChip>
        ) : (
          <span className="shrink-0 font-heading text-title text-fg tabular-nums">{match.game_score}</span>
        )}
        <Link
          href={`/players/${match.opponent_id}`}
          className="relative z-10 flex min-h-7 min-w-0 items-center gap-2 rounded-poke-sm text-body font-[550] text-fg hover:text-accent-ink"
        >
          <PlayerAvatar avatarUrl={match.opponent_avatar_url} name={match.opponent_name} size={28} />
          <span className="truncate">{match.opponent_name}</span>
        </Link>
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-3">
        <Link
          href={`/tournaments/${match.tournament_id}`}
          className="relative z-10 truncate text-caption text-fg-muted hover:text-accent-ink"
        >
          {match.tournament_name}
        </Link>
        {match.date_played && (
          <span className="shrink-0 font-mono text-micro text-fg-muted tabular-nums">{formatter.instant(match.date_played, 'date')}</span>
        )}
      </div>
    </li>
  );
}

export default function ProfileMatchList({ title: _title, matches, playerId, emptyMessage, player }: ProfileMatchListProps) {
  const t = useT(profileMessages);
  if (matches.length === 0) {
    return <p className="text-body text-fg-muted">{emptyMessage ?? t('matchList.empty')}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {matches.map((m) => (
        <MatchRow key={m.id} match={m} playerId={playerId} player={player} />
      ))}
    </ul>
  );
}
