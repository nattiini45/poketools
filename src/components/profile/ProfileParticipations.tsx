'use client';

import { useState } from 'react';
import Link from 'next/link';
import PokemonSprite from '@/components/shared/PokemonSprite';
import type { ProfileParticipation } from '@/types/profile';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { profileMessages } from '@/i18n/messages/profile';
import { ordinalSuffix } from './ordinal';

interface ProfileParticipationsProps {
  current: ProfileParticipation[];
  past: ProfileParticipation[];
}

const statusColors: Record<string, string> = {
  upcoming: 'bg-blue-100 text-blue-700',
  active: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-poke-muted text-poke-text-secondary',
};

function ParticipationCard({ p }: { p: ProfileParticipation }) {
  const t = useT(profileMessages);
  const tEnums = useT(enumMessages);
  return (
    <Link
      href={`/tournaments/${p.id}`}
      className="flex items-center gap-3 px-4 py-3 bg-poke-elevated border border-poke-border rounded-poke-lg hover:border-poke-blue transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-heading font-semibold text-sm text-poke-text-primary truncate">
            {p.name}
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[p.status]}`}>
            {enumLabel(tEnums, 'tournamentStatus', p.status)}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          {p.bracket_type && (
            <span className="text-xs text-poke-text-tertiary">
              {enumLabel(tEnums, 'bracketType', p.bracket_type)}
            </span>
          )}
          {p.standing && (
            <span className="text-xs text-poke-text-secondary font-medium">
              {t.rich('participations.standing', {
                rank: t(`ordinal.${ordinalSuffix(p.standing.rank)}`, { n: p.standing.rank }),
                total: p.standing.total,
                wins: p.standing.wins,
                losses: p.standing.losses,
                em: (chunks) =>
                  p.standing?.rank === 1 ? <span className="text-amber-500 font-bold">{chunks}</span> : chunks,
              })}
            </span>
          )}
        </div>
      </div>

      {p.best_pokemon && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <PokemonSprite name={p.best_pokemon.pokemon_name} size={28} />
          <span className="text-xs text-poke-text-secondary font-medium">
            {t('participations.kos', { count: p.best_pokemon.kos_dealt })}
          </span>
        </div>
      )}
    </Link>
  );
}

export default function ProfileParticipations({ current, past }: ProfileParticipationsProps) {
  const t = useT(profileMessages);
  const [tab, setTab] = useState<'current' | 'past'>('current');

  if (current.length === 0 && past.length === 0) return null;

  const items = tab === 'current' ? current : past;

  return (
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
      {/* Tab switcher */}
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => setTab('current')}
          className={`text-sm font-heading font-bold pb-1 border-b-2 transition-colors ${
            tab === 'current'
              ? 'text-poke-accent border-poke-accent'
              : 'text-poke-text-tertiary border-transparent hover:text-poke-text-secondary'
          }`}
        >
          {t('participations.current', { count: current.length })}
        </button>
        <button
          onClick={() => setTab('past')}
          className={`text-sm font-heading font-bold pb-1 border-b-2 transition-colors ${
            tab === 'past'
              ? 'text-poke-accent border-poke-accent'
              : 'text-poke-text-tertiary border-transparent hover:text-poke-text-secondary'
          }`}
        >
          {t('participations.past', { count: past.length })}
        </button>
      </div>

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((p) => (
            <ParticipationCard key={`${p.type}-${p.id}`} p={p} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-poke-text-tertiary py-4 text-center">
          {tab === 'current' ? t('participations.emptyCurrent') : t('participations.emptyPast')}
        </p>
      )}
    </div>
  );
}
