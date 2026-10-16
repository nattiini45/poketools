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
 * the workspace.
 */
export default function IntelSubjectStrip() {
  const { state, dispatch } = useEditorContext();
  const subject = useIntelSubject();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  const filled = state.team.filter((s) => s !== null && !!s.species);
  if (filled.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-poke-border bg-poke-surface/60 shrink-0 overflow-x-auto">
      {state.team.map((set, i) => {
        if (!set?.species) return null;
        const isSubject = subject.slot === i;
        const speciesName = localizeSpecies(set.species, dl);
        return (
          <button
            key={i}
            onClick={() => dispatch({ type: 'SELECT_SLOT', slot: i })}
            title={speciesName}
            aria-label={t('intel.analyse', { species: speciesName })}
            aria-pressed={isSubject}
            className={[
              'rounded-md p-0.5 transition-colors shrink-0 border',
              isSubject
                ? 'bg-poke-blue/15 border-poke-blue/40'
                : 'border-transparent hover:bg-poke-muted opacity-60 hover:opacity-100',
            ].join(' ')}
          >
            <PokemonSprite name={set.species} size={26} />
          </button>
        );
      })}
    </div>
  );
}
