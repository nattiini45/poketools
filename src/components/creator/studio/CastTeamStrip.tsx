'use client';

import SpriteImg from '@/components/shared/SpriteImg';
import type { PokemonSet } from '@/types/team';
import { useDataLocale } from '@/i18n/client';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';

interface CastTeamStripProps {
  team: PokemonSet[];
  activeSlot: number | null;
  facingSlot: number | null;
  onSlotClick: (index: number) => void;
  label: string;
}

const EMPTY_SET: PokemonSet = {
  name: '', species: '', gender: '', item: '', ability: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: 'Hardy', level: 100, moves: [],
};

export default function CastTeamStrip({ team, activeSlot, facingSlot, onSlotClick, label }: CastTeamStripProps) {
  const dataLocale = useDataLocale();
  // Pad to 6 slots
  const slots = Array.from({ length: 6 }, (_, i) => team[i] ?? null);

  return (
    <div>
      <h4 className="text-xs font-heading font-bold text-fg-muted uppercase tracking-wide mb-1.5">
        {label}
      </h4>
      <div className="flex gap-1.5">
        {slots.map((set, i) => {
          const isActive = activeSlot === i;
          const isFacing = facingSlot === i;

          return (
            <button
              key={i}
              onClick={() => onSlotClick(i)}
              className={`
                relative flex flex-col items-center justify-center
                w-16 h-16 rounded-poke-md border transition-all
                ${isActive
                  ? 'border-accent-ink shadow-poke-sm'
                  : 'border-hairline bg-surface'
                }
                ${isFacing ? 'ring-2 ring-yellow-400/60' : ''}
              `}
            >
              {set?.species ? (
                <>
                  <SpriteImg
                    name={set.species}
                    alt={localizeSpecies(set.species, dataLocale)}
                    className="w-10 h-10"
                  />
                  <span className="text-[9px] text-fg-muted truncate w-full text-center px-0.5">
                    {localizeSpecies(set.species, dataLocale)}
                  </span>
                </>
              ) : (
                <span className="text-xs text-fg-muted">+</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { EMPTY_SET };
