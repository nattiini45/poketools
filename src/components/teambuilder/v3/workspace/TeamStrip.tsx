'use client';

import PokemonSprite from '@/components/shared/PokemonSprite';
import { motion } from '@/components/shared/motion';
import ItemIcon from '@/components/ui/ItemIcon';
import { useDataLocale, useT } from '@/i18n/client';
import { teambuilderIntelMessages } from '@/i18n/messages/teambuilder-intel';
import { SPRING } from '@/lib/motion/tokens';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { useEditorContext } from '../editor/EditorContext';

/**
 * TeamStrip — the slot switcher above the set editor, drawn as a character-select row: six skewed plates with the
 * Pokémon's sprite, the active slot on the accent plate (it glides between slots), and an empty slot as a dashed
 * plate with a Poké Ball that invites a pick.
 */
export default function TeamStrip() {
  const { state, dispatch } = useEditorContext();
  const t = useT(teambuilderIntelMessages);
  const dl = useDataLocale();

  return (
    <div className="flex shrink-0 items-stretch gap-2 overflow-x-auto border-b border-hairline bg-surface px-4 py-2.5">
      {state.team.map((set, i) => {
        const active = state.activeSlot === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => {
              // Empty slots stay in the workspace — SpeciesPicker shows
              dispatch({ type: 'SELECT_SLOT', slot: i });
            }}
            aria-label={
              set
                ? t('teamStrip.editSlot', { species: localizeSpecies(set.species, dl), n: i + 1 })
                : t('teamStrip.emptySlot', { n: i + 1 })
            }
            aria-current={active ? 'true' : undefined}
            title={set ? localizeSpecies(set.species, dl) : t('teamStrip.slot', { n: i + 1 })}
            className="group inline-flex min-h-16 min-w-12 max-w-28 flex-1 basis-0"
          >
            <span className="skew-plate h-full w-full content-center gap-0.5 px-1 py-1">
              <span
                aria-hidden="true"
                className={[
                  'skew-plate-bg border transition-colors duration-80 ease-out',
                  set
                    ? 'border-hairline bg-elevated group-hover:border-hairline-strong group-hover:bg-hover'
                    : 'border-dashed border-hairline-strong group-hover:bg-hover',
                ].join(' ')}
              />
              {active && (
                <motion.span
                  layoutId="teambuilder-slot-plate"
                  transition={SPRING.moderate}
                  aria-hidden="true"
                  className="skew-plate-bg bg-accent-fill"
                />
              )}
              {set ? (
                <PokemonSprite name={set.species} size={40} />
              ) : (
                <span className="flex h-10 items-center">
                  <ItemIcon item="poke-ball" />
                </span>
              )}
              <span className={['font-mono text-caption leading-none tabular-nums', active ? 'font-[550] text-tier-ink' : 'text-fg-muted'].join(' ')}>
                {i + 1}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
