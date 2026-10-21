'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { EvolutionTier, DraftTierLimit, PowerTier } from '@/types/evolution';
import { POWER_TIERS, POWER_TIER_COLORS } from '@/types/evolution';

interface TierListDisplayProps {
  tiers: EvolutionTier[];
  tierLimits: DraftTierLimit[];
}

export default function TierListDisplay({ tiers, tierLimits }: TierListDisplayProps) {
  const t = useT(draftLegacyBoardMessages);
  const dataLocale = useDataLocale();
  // Group tiers by power tier
  const tiersByPower: Record<PowerTier, EvolutionTier[]> = { S: [], A: [], B: [], C: [] };
  for (const tier of tiers) {
    const pt = (tier.power_tier || 'C') as PowerTier;
    if (tiersByPower[pt]) tiersByPower[pt].push(tier);
  }

  // Build limits lookup
  const limitsMap: Record<string, number> = {};
  for (const limit of tierLimits) {
    limitsMap[limit.power_tier] = limit.max_picks;
  }

  return (
    <div className="space-y-4">
      {/* Limits summary */}
      <div className="flex flex-wrap gap-2">
        {POWER_TIERS.map((pt) => {
          const count = tiersByPower[pt].length;
          if (count === 0) return null;
          const limit = limitsMap[pt];
          const colors = POWER_TIER_COLORS[pt];
          return (
            <div
              key={pt}
              className={`px-3 py-1.5 rounded-poke-md border ${colors.border} ${colors.bg} text-sm`}
            >
              <span className={`font-heading font-bold ${colors.text}`}>{t('tierList.tier', { tier: pt })}</span>
              <span className="text-poke-text-muted ml-1.5">
                {limit && limit > 0
                  ? t('tierList.availableLimited', { count, max: limit })
                  : t('tierList.availableUnlimited', { count })}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tier groups */}
      {POWER_TIERS.map((pt) => {
        const tiersInGroup = tiersByPower[pt];
        if (tiersInGroup.length === 0) return null;
        const colors = POWER_TIER_COLORS[pt];

        return (
          <div key={pt} className={`border ${colors.border} rounded-poke-lg overflow-hidden`}>
            <div className={`px-3 py-1.5 ${colors.bg} flex items-center gap-2`}>
              <span className={`font-heading font-bold text-sm ${colors.text}`}>
                {t('tierList.tier', { tier: pt })}
              </span>
              <span className="text-xs text-poke-text-muted">
                {limitsMap[pt] && limitsMap[pt] > 0
                  ? t('tierList.groupCountLimited', { count: tiersInGroup.length, max: limitsMap[pt] })
                  : t('tierList.groupCount', { count: tiersInGroup.length })}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 divide-poke-border">
              {tiersInGroup.map((tier) => (
                <div
                  key={tier.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm sm:border-b sm:border-r border-poke-border"
                >
                  <PokemonSprite name={tier.base_pokemon} size={28} />
                  <div className="min-w-0">
                    <div className="font-medium text-poke-text-primary truncate">
                      {localizeSpecies(tier.base_pokemon, dataLocale)}
                    </div>
                    <div className="text-xs text-poke-text-muted truncate">
                      {t('tierList.nextStage', {
                        name: localizeSpecies(tier.stage2_pokemon, dataLocale),
                        count: tier.stage2_kos,
                      })}
                      {tier.stage3_pokemon &&
                        ` ${t('tierList.nextStage', {
                          name: localizeSpecies(tier.stage3_pokemon, dataLocale),
                          count: tier.stage3_kos ?? 0,
                        })}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
