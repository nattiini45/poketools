'use client';

import Link from 'next/link';
import { useFormatter, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { profileMessages } from '@/i18n/messages/profile';
import PlayerAvatar from '@/components/shared/PlayerAvatar';
import type { ProfileMatch } from '@/types/profile';

interface ProfileMatchListProps {
  title: string;
  matches: ProfileMatch[];
  playerId: string;
  emptyMessage?: string;
}

function MatchResult({ match, playerId }: { match: ProfileMatch; playerId: string }) {
  const t = useT(profileMessages);
  const tCommon = useT(commonMessages);
  const formatter = useFormatter();
  const isWin = match.winner_id === playerId;
  const isLoss = match.winner_id !== null && match.winner_id !== playerId;
  const isScheduled = match.status === 'scheduled' || match.status === 'in_progress';

  const resultBadge = isScheduled ? (
    <span className="text-xs font-bold text-poke-accent-strong bg-poke-accent-light px-1.5 py-0.5 rounded">
      VS
    </span>
  ) : isWin ? (
    <span className="text-xs font-bold text-poke-green bg-poke-green-light px-1.5 py-0.5 rounded">
      {tCommon('record.winShort')}
    </span>
  ) : isLoss ? (
    <span className="text-xs font-bold text-poke-danger bg-poke-danger-light px-1.5 py-0.5 rounded">
      {tCommon('record.lossShort')}
    </span>
  ) : (
    <span className="text-xs font-bold text-poke-text-secondary bg-poke-muted px-1.5 py-0.5 rounded">
      {tCommon('record.drawShort')}
    </span>
  );

  return (
    <div className="relative flex items-center gap-3 px-4 py-2.5 bg-poke-elevated border border-poke-border rounded-poke-lg hover:border-poke-blue/50 transition-colors">
      <Link
        href={`/tournaments/${match.tournament_id}/matches/${match.id}`}
        className="absolute inset-0 z-0"
        aria-label={t('matchList.viewMatch', { opponent: match.opponent_name })}
      />
      <div className="w-7 flex justify-center flex-shrink-0">{resultBadge}</div>

      <Link
        href={`/players/${match.opponent_id}`}
        className="relative z-10 flex items-center gap-2 min-w-0 flex-shrink-0 hover:opacity-80 transition-opacity"
      >
        <PlayerAvatar
          avatarUrl={match.opponent_avatar_url}
          name={match.opponent_name}
          size={28}
        />
        <span className="text-sm font-semibold text-poke-text-primary truncate max-w-[120px]">
          {match.opponent_name}
        </span>
      </Link>

      {!isScheduled && (
        <span className="text-sm font-heading font-bold text-poke-text-primary flex-shrink-0">
          {match.game_score}
        </span>
      )}

      <Link
        href={`/tournaments/${match.tournament_id}`}
        className="relative z-10 text-xs text-poke-text-tertiary truncate flex-1 text-right hover:text-poke-accent transition-colors"
      >
        {match.tournament_name}
      </Link>

      {match.date_played && (
        <span className="text-[10px] text-poke-text-tertiary flex-shrink-0">
          {formatter.instant(match.date_played, 'date')}
        </span>
      )}
    </div>
  );
}

export default function ProfileMatchList({
  title: _title,
  matches,
  playerId,
  emptyMessage,
}: ProfileMatchListProps) {
  const t = useT(profileMessages);
  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
      {matches.length > 0 ? (
        <div className="space-y-2">
          {matches.map((m) => (
            <MatchResult key={m.id} match={m} playerId={playerId} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-poke-text-tertiary py-4 text-center">{emptyMessage ?? t('matchList.empty')}</p>
      )}
    </div>
  );
}
