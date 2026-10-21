'use client';

import PlayerAvatar from '@/components/shared/PlayerAvatar';
import { useFormatter, useT } from '@/i18n/client';
import { commonMessages } from '@/i18n/messages/common';
import { profileMessages } from '@/i18n/messages/profile';
import type { PublicPlayer } from '@/types/player';
import type { ProfileHeadlineStats } from '@/types/profile';

interface ProfileHeaderProps {
  player: PublicPlayer;
  headline: ProfileHeadlineStats;
  recentForm: ('W' | 'L' | 'D')[];
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-poke-elevated border border-poke-border rounded-poke-lg px-4 py-3 text-center min-w-[80px]">
      <div className="text-lg font-heading font-bold text-poke-text-primary">{value}</div>
      <div className="text-xs text-poke-text-secondary font-medium">{label}</div>
    </div>
  );
}

function FormDot({ result }: { result: 'W' | 'L' | 'D' }) {
  const colors = {
    W: 'bg-emerald-500',
    L: 'bg-red-500',
    D: 'bg-gray-400',
  };
  const t = useT(commonMessages);
  const labels = { W: t('record.win'), L: t('record.loss'), D: t('record.draw') };

  return (
    <span
      className={`inline-block w-3 h-3 rounded-full ${colors[result]}`}
      title={labels[result]}
    />
  );
}

export default function ProfileHeader({ player, headline, recentForm }: ProfileHeaderProps) {
  const t = useT(profileMessages);
  const formatter = useFormatter();
  const joinedDate = player.joined_date ? formatter.instant(player.joined_date, 'monthYear') : null;

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
      {/* Identity */}
      <div className="flex items-center gap-5 mb-5">
        <PlayerAvatar
          avatarUrl={player.avatar_url}
          name={player.name}
          size={96}
          className="ring-4"
        />
        <div className="min-w-0">
          <h1 className="text-2xl font-heading font-bold text-poke-text-primary truncate">
            {player.name}
          </h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {player.ps_username && (
              <span className="text-sm text-poke-text-secondary">
                <span className="font-semibold text-poke-text-tertiary">{t('header.ps')}</span>{' '}
                {player.ps_username}
              </span>
            )}
            {player.champions_username && (
              <span className="text-sm text-poke-text-secondary">
                <span className="font-semibold text-poke-text-tertiary">{t('header.champions')}</span>{' '}
                {player.champions_username}
              </span>
            )}
          </div>
          {joinedDate && (
            <p className="text-xs text-poke-text-tertiary mt-1">{t('header.memberSince', { date: joinedDate })}</p>
          )}
        </div>
      </div>

      {/* Headline stats */}
      <div className="flex flex-wrap gap-3 mb-4">
        <StatCard
          label={t('header.record')}
          value={t('header.recordValue', { wins: headline.total_wins, losses: headline.total_losses })}
        />
        <StatCard label={t('header.winRate')} value={formatter.percentOf(headline.win_rate, 0)} />
        <StatCard label={t('header.totalKos')} value={formatter.number(headline.total_kos_dealt)} />
        <StatCard label={t('header.pokemon')} value={formatter.number(headline.unique_pokemon_used)} />
        {headline.tournaments_won > 0 && (
          <StatCard label={t('header.titles')} value={formatter.number(headline.tournaments_won)} />
        )}
      </div>

      {/* Recent form */}
      {recentForm.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-poke-text-tertiary uppercase">{t('header.form')}</span>
          <div className="flex gap-1.5">
            {recentForm.map((r, i) => (
              <FormDot key={i} result={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
