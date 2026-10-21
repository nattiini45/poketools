'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import TypeBadge from '@/components/shared/TypeBadge';
import ProgressSourceChips from '@/components/evolution/ProgressSourceChips';
import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyMessages } from '@/i18n/messages/draft/legacy';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeMove } from '@/lib/pkmn/i18n/names/moves';
import { breakdown } from '@/lib/draft-ui/progress-display';
import { progressChipLabels } from '@/lib/draft-ui/progress-labels';
import { getTeraEligibility } from '@/lib/draft/point-buy-engine';
import type { EvolutionTracker } from '@/types/evolution';
import type { TeamRole } from '@/types/format-rules';
import type { MatchupSpeciesTypeInfo } from '@/lib/evolution/matchup-types';

interface MatchupRosterPanelProps {
  name: string;
  trackers: EvolutionTracker[];
  typeInfo: Record<string, MatchupSpeciesTypeInfo>;
  priceByBase: Record<string, number>;
  roles: TeamRole[];
  bannedSet: Set<string>;
  onSelect: (species: string) => void;
  selected: string | null;
}

export default function MatchupRosterPanel({
  name,
  trackers,
  typeInfo,
  priceByBase,
  roles,
  bannedSet,
  onSelect,
  selected,
}: MatchupRosterPanelProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const tLegacy = useT(draftLegacyMessages);
  const chipLabels = progressChipLabels(useT(draftSharedMessages));
  const dataLocale = useDataLocale();
  return (
    <div className="rounded-lg border border-poke-border">
      <div className="border-b border-poke-border bg-poke-elevated px-4 py-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <p className="text-xs text-poke-text-secondary">{t('roster.lines', { count: trackers.length })}</p>
      </div>
      <div className="divide-y divide-poke-border/50">
        {trackers.map((tracker) => {
          const tera = getTeraEligibility(tracker.current_stage);
          const isSuspended = tracker.suspended_until_matchday !== null;
          const info = typeInfo[tracker.current_form];
          const price = priceByBase[tracker.base_pokemon];
          const monRoles = roles.filter(
            (r) =>
              r.species_form === tracker.current_form &&
              r.is_active &&
              !bannedSet.has(r.move_name.toLowerCase()),
          );
          const isSelected = selected === tracker.current_form;
          const sources = breakdown(tracker);

          return (
            <button
              key={tracker.id}
              type="button"
              onClick={() => onSelect(tracker.current_form)}
              className={`w-full px-4 py-2 text-left transition-colors hover:bg-poke-elevated/40 ${
                isSuspended ? 'bg-red-900/10' : ''
              } ${isSelected ? 'ring-1 ring-inset ring-cyan-600/50' : ''}`}
            >
              <div className="flex gap-2">
                <PokemonSprite name={tracker.current_form} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{localizeSpecies(tracker.current_form, dataLocale)}</span>
                    {info && (
                      <span className="flex gap-0.5">
                        {info.types.map((t) => (
                          <TypeBadge key={t} type={t} />
                        ))}
                      </span>
                    )}
                    <span className="rounded bg-poke-elevated px-1.5 py-0.5 text-xs text-poke-text-secondary">
                      {tLegacy('stageShort', { n: tracker.current_stage })}
                    </span>
                    {price !== undefined && (
                      <span className="text-xs text-poke-text-muted">{tLegacy('pts', { n: price })}</span>
                    )}
                    {tera !== 'none' && (
                      <span className={`rounded px-1.5 py-0.5 text-xs ${tera === 'any' ? 'bg-green-900/30 text-green-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                        {tLegacy(`tera.${tera}`)}
                      </span>
                    )}
                    {isSuspended && (
                      <span className="rounded bg-red-900/30 px-1.5 py-0.5 text-xs text-red-400">{tLegacy('suspended')}</span>
                    )}
                  </div>
                  {/* Total progress, then the self-earned KOs (`real_kills`) and one chip per other source (§8.3). */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-poke-text-secondary">
                    <span>{t('roster.progressTotal', { n: sources.totalProgress })}</span>
                    <ProgressSourceChips sources={sources} compact labels={chipLabels} />
                  </div>
                  {monRoles.length > 0 && (
                    <p className="mt-1 truncate text-[10px] text-poke-text-muted">
                      {t('roster.roles', {
                        list: monRoles.map((r) => localizeMove(r.move_name, dataLocale)).join(', '),
                      })}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}
        {trackers.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-poke-text-secondary">
            {t('roster.empty')}
          </div>
        )}
      </div>
    </div>
  );
}
