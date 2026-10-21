'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';

export default function TeamStrip() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-poke-border bg-poke-surface overflow-x-auto shrink-0">
      {state.team.map((set, i) => (
        <button
          key={i}
          onClick={() => {
            // Empty slots stay in the workspace — SpeciesPicker shows
            dispatch({ type: 'SELECT_SLOT', slot: i });
          }}
          aria-label={
            set
              ? t('teamStrip.editSlot', { species: localizeSpecies(set.species, dl), n: i + 1 })
              : t('teamStrip.emptySlot', { n: i + 1 })
          }
          title={set ? localizeSpecies(set.species, dl) : t('teamStrip.slot', { n: i + 1 })}
          className={[
            'flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-colors min-w-[52px] shrink-0',
            state.activeSlot === i
              ? 'bg-poke-blue/15 border border-poke-blue/40'
              : 'hover:bg-poke-muted border border-transparent',
          ].join(' ')}
        >
          {set ? (
            <PokemonSprite name={set.species} size={36} />
          ) : (
            <div className="w-9 h-9 rounded-full border-2 border-dashed border-poke-border flex items-center justify-center">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="opacity-30"
              >
                <path d="M12 8v8M8 12h8" />
              </svg>
            </div>
          )}
          <span className="text-[9px] text-poke-text-muted leading-none">{i + 1}</span>
        </button>
      ))}
    </div>
  );
}
