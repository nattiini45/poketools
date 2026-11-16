'use client';

import { useState } from 'react';
import { Button } from '@ui-sdk/react/button';
import PokemonSprite from '@/components/shared/PokemonSprite';
import SkewPlate from '@/components/ui/SkewPlate';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyBoardMessages } from '@/i18n/messages/draft/legacy/board';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import type { EvolutionTier, DraftTierLimit, PowerTier } from '@/types/evolution';
import { POWER_TIERS } from '@/types/evolution';
import { compareSortValues, cycleColumnSort, type ColumnSortState } from '@/lib/ui/table-params';

interface TierListDisplayProps {
  tiers: EvolutionTier[];
  tierLimits: DraftTierLimit[];
}

/** S to C on the four rank plates (Direction B): gold, peach, blue, green. */
const TIER_PLATE: Record<PowerTier, 1 | 2 | 3 | 4> = { S: 1, A: 2, B: 3, C: 4 };

export default function TierListDisplay({ tiers, tierLimits }: TierListDisplayProps) {
  const t = useT(draftLegacyBoardMessages);
  const dataLocale = useDataLocale();
  const [sort, setSort] = useState<ColumnSortState | null>(null);
  // Group tiers by power tier
  const tiersByPower: Record<PowerTier, EvolutionTier[]> = { S: [], A: [], B: [], C: [] };
  for (const tier of tiers) {
    const pt = (tier.power_tier || 'C') as PowerTier;
    if (tiersByPower[pt]) tiersByPower[pt].push(tier);
  }
  if (sort) {
    const value = (tier: EvolutionTier) => sort.key === 'next'
      ? tier.stage2_kos
      : tier.stage3_pokemon ? tier.stage3_kos ?? tier.stage2_kos : tier.stage2_kos;
    for (const group of Object.values(tiersByPower)) {
      group.sort((a, b) => compareSortValues(value(a), value(b)) * (sort.direction === 'asc' ? 1 : -1));
    }
  }

  // Build limits lookup
  const limitsMap: Record<string, number> = {};
  for (const limit of tierLimits) {
    limitsMap[limit.power_tier] = limit.max_picks;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(['next', 'total'] as const).map((key) => (
          <Button
            key={key}
            onClick={() => setSort(cycleColumnSort(sort, key))}
            className="min-h-11 rounded-poke-md border border-hairline bg-elevated px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t(`tierList.sort.${key}`)}
            {sort?.key === key ? ` ${sort.direction === 'asc' ? '↑' : '↓'}` : ''}
          </Button>
        ))}
      </div>
      {/* Limits summary */}
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        {POWER_TIERS.map((pt) => {
          const count = tiersByPower[pt].length;
          if (count === 0) return null;
          const limit = limitsMap[pt];
          return (
            <li key={pt} className="flex items-center gap-2 text-body">
              <SkewPlate variant="rank" tier={TIER_PLATE[pt]} className="font-heading">
                {t('tierList.tier', { tier: pt })}
              </SkewPlate>
              <span className="text-fg-muted">
                {limit && limit > 0
                  ? t('tierList.availableLimited', { count, max: limit })
                  : t('tierList.availableUnlimited', { count })}
              </span>
            </li>
          );
        })}
      </ul>

      {/* Tier groups */}
      {POWER_TIERS.map((pt) => {
        const tiersInGroup = tiersByPower[pt];
        if (tiersInGroup.length === 0) return null;

        return (
          <section key={pt} className="overflow-hidden rounded-poke-lg border border-hairline bg-surface">
            <div className="flex items-center gap-3 border-b border-hairline bg-elevated px-3 py-2">
              <SkewPlate variant="rank" tier={TIER_PLATE[pt]} className="font-heading">
                {t('tierList.tier', { tier: pt })}
              </SkewPlate>
              <span className="text-caption text-fg-muted">
                {limitsMap[pt] && limitsMap[pt] > 0
                  ? t('tierList.groupCountLimited', { count: tiersInGroup.length, max: limitsMap[pt] })
                  : t('tierList.groupCount', { count: tiersInGroup.length })}
              </span>
            </div>
            <ul className="grid grid-cols-1 gap-px bg-hairline sm:grid-cols-2 lg:grid-cols-3">
              {tiersInGroup.map((tier) => (
                <li key={tier.id} className="flex items-center gap-2 bg-surface px-3 py-2 text-body">
                  <PokemonSprite name={tier.base_pokemon} size={28} />
                  <div className="min-w-0">
                    <div className="truncate font-[550] text-fg">{localizeSpecies(tier.base_pokemon, dataLocale)}</div>
                    <div className="truncate text-caption text-fg-muted">
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
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
