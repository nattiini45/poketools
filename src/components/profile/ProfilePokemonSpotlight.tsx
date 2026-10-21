'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useFormatter, useT } from '@/i18n/client';
import { profileMessages } from '@/i18n/messages/profile';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { ordinalSuffix } from './ordinal';
import PokemonLink from '@/components/shared/PokemonLink';
import type { ProfilePokemonStat, ProfileKillRanking } from '@/types/profile';

interface ProfilePokemonSpotlightProps {
  mostUsed: ProfilePokemonStat[];
  bestKillers: ProfileKillRanking[];
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
    <div className="bg-poke-surface border border-poke-border rounded-poke-xl p-6 shadow-poke">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Most Used */}
        {mostUsed.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
              {t('spotlight.mostUsed')}
            </h3>
            <div className="space-y-3">
              {mostUsed.map((mon) => (
                <PokemonLink key={mon.pokemon_name} name={mon.pokemon_name} className="gap-3">
                  <PokemonSprite name={mon.pokemon_name} size={40} showContainer />
                  <div className="min-w-0">
                    <div className="font-heading font-semibold text-poke-text-primary text-sm truncate">
                      {localizeSpecies(mon.pokemon_name, dl)}
                    </div>
                    <div className="text-xs text-poke-text-secondary">
                      {t('spotlight.gamesWinRate', {
                        count: mon.total_games,
                        winRate: formatter.percentOf(mon.win_rate, 0),
                      })}
                    </div>
                  </div>
                </PokemonLink>
              ))}
            </div>
          </div>
        )}

        {/* Top Killers */}
        {bestKillers.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-poke-text-secondary uppercase tracking-wide mb-3">
              {t('spotlight.topKillers')}
            </h3>
            <div className="space-y-3">
              {bestKillers.map((mon) => (
                <PokemonLink key={mon.pokemon_name} name={mon.pokemon_name} className="gap-3">
                  <PokemonSprite name={mon.pokemon_name} size={40} showContainer />
                  <div className="min-w-0">
                    <div className="font-heading font-semibold text-poke-text-primary text-sm truncate">
                      {localizeSpecies(mon.pokemon_name, dl)}
                    </div>
                    <div className="text-xs text-poke-text-secondary">
                      {t.rich('spotlight.kosOverall', {
                        count: mon.kos_dealt,
                        rank: t(`overallRank.${ordinalSuffix(mon.rank)}`, { n: mon.rank }),
                        em: (chunks) => <span className="text-poke-text-link font-semibold">{chunks}</span>,
                      })}
                    </div>
                  </div>
                </PokemonLink>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
