'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { cn } from '@/lib/utils/cn';
import { FOCUS } from './focus';
import { ordinalSuffix } from './ordinal';
import type { ProfilePokemonStat, ProfileKillRanking } from '@/types/profile';

interface ProfilePokemonSpotlightProps {
  mostUsed: ProfilePokemonStat[];
  bestKillers: ProfileKillRanking[];
}

function SpotlightRow({ name, displayName, children }: { name: string; displayName: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={`/pokemon/${encodeURIComponent(name)}`}
        className={cn('flex min-h-11 items-center gap-3 rounded-poke-sm text-fg transition-colors duration-80 ease-out hover:text-accent-ink', FOCUS)}
      >
        <PokemonSprite name={name} size={40} />
        <div className="min-w-0">
          <div className="truncate text-body font-[550]">{displayName}</div>
          <div className="text-caption text-fg-muted">{children}</div>
        </div>
      </Link>
    </li>
  );
}

export default function ProfilePokemonSpotlight({
  mostUsed,
  bestKillers,
}: ProfilePokemonSpotlightProps) {
  const t = useT(profileMessages);
  const dl = useDataLocale();
  const formatter = useFormatter();
  if (mostUsed.length === 0 && bestKillers.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-1">
      {/* Most Used */}
      {mostUsed.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-subtitle font-[550] text-fg">{t('spotlight.mostUsed')}</h3>
          <ul className="flex flex-col gap-1">
            {mostUsed.map((mon) => (
              <SpotlightRow key={mon.pokemon_name} name={mon.pokemon_name} displayName={localizeSpecies(mon.pokemon_name, dl)}>
                {mon.win_rate === null ? t('spotlight.knownGames', { count: mon.total_games ?? 0 }) : t('spotlight.gamesWinRate', {
                  count: mon.total_games ?? 0,
                  winRate: formatter.percentOf(mon.win_rate, 0),
                })}
              </SpotlightRow>
            ))}
          </ul>
        </div>
      )}

      {/* Top Killers */}
      {bestKillers.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-subtitle font-[550] text-fg">{t('spotlight.topKillers')}</h3>
          <ul className="flex flex-col gap-1">
            {bestKillers.map((mon) => (
              <SpotlightRow key={mon.pokemon_name} name={mon.pokemon_name} displayName={localizeSpecies(mon.pokemon_name, dl)}>
                {mon.rank === null ? t('spotlight.knownKos', { count: mon.kos_dealt }) : t.rich('spotlight.kosOverall', {
                  count: mon.kos_dealt,
                  rank: t(`overallRank.${ordinalSuffix(mon.rank)}`, { n: mon.rank }),
                  em: (chunks) => <span className="font-[550] text-accent-ink">{chunks}</span>,
                })}
              </SpotlightRow>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
