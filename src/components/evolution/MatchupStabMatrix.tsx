'use client';

import { useDataLocale, useT } from '@/i18n/client';
import { draftLegacyEvolutionMessages } from '@/i18n/messages/draft/legacy/evolution';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeType } from '@/lib/pkmn/i18n/names/misc';
import { STAB_CELL_STYLES, multiplierLabel } from '@/lib/evolution/stab-matrix';
import type { StabMultiplierLabel } from '@/lib/evolution/stab-matrix';
import { stabPairKey } from '@/lib/evolution/matchup-types';
import type { MatchupSpeciesTypeInfo } from '@/lib/evolution/matchup-types';
import type { EvolutionTracker } from '@/types/evolution';

interface MatchupStabMatrixProps {
  attackers: EvolutionTracker[];
  defenders: EvolutionTracker[];
  stabMultipliers: Record<string, number>;
  typeInfo: Record<string, MatchupSpeciesTypeInfo>;
}

export default function MatchupStabMatrix({
  attackers,
  defenders,
  stabMultipliers,
  typeInfo,
}: MatchupStabMatrixProps) {
  const t = useT(draftLegacyEvolutionMessages);
  const dataLocale = useDataLocale();
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const types = (list: string[]) => list.map((type) => localizeType(type, dataLocale)).join('/');
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="p-1.5 text-left text-poke-text-secondary">{t('stab.corner')}</th>
            {defenders.map((def) => (
              <th key={def.id} className="max-w-20 truncate p-1.5 text-poke-text-secondary" title={species(def.current_form)}>
                {species(def.current_form)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {attackers.map((atk) => (
            <tr key={atk.id}>
              <td className="max-w-28 truncate p-1.5 font-medium" title={species(atk.current_form)}>
                {species(atk.current_form)}
              </td>
              {defenders.map((def) => {
                const mult = stabMultipliers[stabPairKey(atk.current_form, def.current_form)];
                const atkInfo = typeInfo[atk.current_form];
                const defInfo = typeInfo[def.current_form];
                if (mult === undefined || !atkInfo || !defInfo) {
                  return <td key={def.id} className="p-1.5 text-center text-poke-text-secondary">—</td>;
                }
                const label = multiplierLabel(mult) as StabMultiplierLabel;
                return (
                  <td key={def.id} className="p-1">
                    <span
                      className={`block rounded px-1.5 py-0.5 text-center font-medium ${STAB_CELL_STYLES[label]}`}
                      title={t('stab.cellTitle', {
                        attacker: species(atk.current_form),
                        attackerTypes: types(atkInfo.types),
                        defender: species(def.current_form),
                        defenderTypes: types(defInfo.types),
                      })}
                    >
                      {label}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
