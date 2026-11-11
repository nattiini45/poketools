'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';
import { useIntelSubject } from '../hooks/useIntelSubject';

/**
 * IntelSubjectStrip — picks which team member the per-mon Intel tabs
 * (Sets/Calc/Speed) analyse. Clicking selects the slot without opening
 * the workspace. The same skewed slot plates as the workspace's team strip, one size down.
 */
export default function IntelSubjectStrip() {
  const { state, dispatch } = useEditorContext();
  const subject = useIntelSubject();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  const filled = state.team.filter((s) => s !== null && !!s.species);
  if (filled.length === 0) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-hairline px-3 py-1.5">
      {state.team.map((set, i) => {
        if (!set?.species) return null;
        const isSubject = subject.slot === i;
        const speciesName = localizeSpecies(set.species, dl);
        return (
          <button
            key={i}
            type="button"
            onClick={() => dispatch({ type: 'SELECT_SLOT', slot: i })}
            title={speciesName}
            aria-label={t('intel.analyse', { species: speciesName })}
            aria-pressed={isSubject}
            className="group inline-flex shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
          >
            <span className="skew-plate h-full w-full px-2 py-0.5">
              <span
                aria-hidden="true"
                className={[
                  'skew-plate-bg border transition-colors duration-80 ease-out',
                  isSubject ? 'border-accent-ink bg-accent-subtle' : 'border-transparent group-hover:bg-hover',
                ].join(' ')}
              />
              <PokemonSprite name={set.species} size={28} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
