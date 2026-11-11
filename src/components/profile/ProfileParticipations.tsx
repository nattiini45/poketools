'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import PokemonSprite from '@/components/shared/PokemonSprite';
import SkewChip, { type SkewChipTone } from '@/components/ui/SkewChip';
import SkewPlate from '@/components/ui/SkewPlate';
import type { ProfileParticipation } from '@/types/profile';
import { useT } from '@/i18n/client';
import { enumLabel } from '@/i18n/content/enum-label';
import { enumMessages } from '@/i18n/messages/enums';
import { profileMessages } from '@/i18n/messages/profile';
import { cn } from '@/lib/utils/cn';
import { FOCUS } from './focus';
import { ordinalSuffix } from './ordinal';

interface ProfileParticipationsProps {
  current: ProfileParticipation[];
  past: ProfileParticipation[];
}

const STATUS_TONE: Record<ProfileParticipation['status'], SkewChipTone> = {
  upcoming: 'accent',
  active: 'live',
  completed: 'neutral',
};

const RANK_TONE: Record<number, SkewChipTone> = { 1: 'tier-1', 2: 'tier-2', 3: 'tier-3', 4: 'tier-4' };

function ParticipationRow({ p }: { p: ProfileParticipation }) {
  const t = useT(profileMessages);
  const tEnums = useT(enumMessages);
  return (
    <li>
      <Link
        href={`/tournaments/${p.id}`}
        className={cn(
          'flex items-center gap-3 rounded-poke-md border border-hairline bg-elevated px-3 py-2.5 transition-colors duration-80 ease-out hover:border-hairline-strong hover:bg-hover',
          FOCUS,
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="min-w-0 truncate text-body font-[550] text-fg">{p.name}</span>
            <SkewChip tone={STATUS_TONE[p.status]}>{enumLabel(tEnums, 'tournamentStatus', p.status)}</SkewChip>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
            {p.bracket_type && <span>{enumLabel(tEnums, 'bracketType', p.bracket_type)}</span>}
            {p.standing && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {t.rich('participations.standing', {
                  rank: t(`ordinal.${ordinalSuffix(p.standing.rank)}`, { n: p.standing.rank }),
                  total: p.standing.total,
                  wins: p.standing.wins,
                  losses: p.standing.losses,
                  em: (chunks) => {
                    const tone = p.standing ? RANK_TONE[p.standing.rank] : undefined;
                    return tone ? <SkewChip tone={tone}>{chunks}</SkewChip> : <span className="font-[550] text-fg">{chunks}</span>;
                  },
                })}
              </span>
            )}
          </div>
        </div>

        {p.best_pokemon && (
          <div className="flex shrink-0 items-center gap-1.5">
            <PokemonSprite name={p.best_pokemon.pokemon_name} size={32} />
            <span className="font-mono text-caption text-fg-muted tabular-nums">
              {t('participations.kos', { count: p.best_pokemon.kos_dealt })}
            </span>
          </div>
        )}
      </Link>
    </li>
  );
}

export default function ProfileParticipations({ current, past }: ProfileParticipationsProps) {
  const t = useT(profileMessages);
  const [tab, setTab] = useState<'current' | 'past'>('current');
  const glideId = useId();

  if (current.length === 0 && past.length === 0) return null;

  const items = tab === 'current' ? current : past;

  return (
    <div className="flex flex-col gap-3">
      {/* Tab switcher */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1.5">
        {(['current', 'past'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className="inline-flex min-h-11 cursor-pointer items-center text-body sm:min-h-9"
          >
            <SkewPlate variant="tab" active={tab === key} glideId={glideId}>
              {key === 'current' ? t('participations.current', { count: current.length }) : t('participations.past', { count: past.length })}
            </SkewPlate>
          </button>
        ))}
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((p) => (
            <ParticipationRow key={`${p.type}-${p.id}`} p={p} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-fg-muted">
          {tab === 'current' ? t('participations.emptyCurrent') : t('participations.emptyPast')}
        </p>
      )}
    </div>
  );
}
