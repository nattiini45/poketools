'use client';

import SpriteImg from '@/components/shared/SpriteImg';
import type { PokemonSet } from '@/types/team';
import { useDataLocale, useT } from '@/i18n/client';
import { creatorStudioMessages } from '@/i18n/messages/creator/studio';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { localizeItem } from '@/lib/pkmn/i18n/names/items';
import { localizeAbility } from '@/lib/pkmn/i18n/names/abilities';
import { localizeNature } from '@/lib/pkmn/i18n/names/misc';

interface FacingPanelProps {
  pokemon1: PokemonSet | null;
  pokemon2: PokemonSet | null;
}

/** One side of the panel: sprite, name and set details, or a placeholder. */
function FacingPokemon({ pokemon }: { pokemon: PokemonSet | null }) {
  const t = useT(creatorStudioMessages);
  const dataLocale = useDataLocale();

  if (!pokemon?.species) {
    return (
      <div className="w-20 h-20 rounded-poke-md bg-poke-muted flex items-center justify-center text-poke-text-secondary text-sm">
        ---
      </div>
    );
  }

  const species = localizeSpecies(pokemon.species, dataLocale);
  return (
    <>
      <SpriteImg name={pokemon.species} alt={species} className="w-20 h-20" />
      <span className="font-heading font-bold text-poke-text-primary">{species}</span>
      <div className="text-xs text-poke-text-secondary space-y-0.5">
        {pokemon.item && <div>{t('tools.item', { item: localizeItem(pokemon.item, dataLocale) })}</div>}
        {pokemon.ability && <div>{t('tools.ability', { ability: localizeAbility(pokemon.ability, dataLocale) })}</div>}
        {pokemon.nature && <div>{t('tools.nature', { nature: localizeNature(pokemon.nature, dataLocale) })}</div>}
      </div>
    </>
  );
}

/**
 * FacingPanel — shows the two "facing" Pokémon side by side.
 * Used in the second-screen tools view.
 */
export default function FacingPanel({ pokemon1, pokemon2 }: FacingPanelProps) {
  const t = useT(creatorStudioMessages);

  if (!pokemon1 && !pokemon2) {
    return (
      <div className="flex items-center justify-center rounded-poke-lg border border-poke-border bg-poke-surface p-6">
        <p className="text-sm text-poke-text-secondary">
          {t('tools.facingEmpty')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center gap-8 rounded-poke-lg border border-poke-border bg-poke-surface p-4">
      {/* Player 1's Pokémon */}
      <div className="flex flex-col items-center gap-2">
        <FacingPokemon pokemon={pokemon1} />
      </div>

      {/* VS */}
      <span className="font-heading font-bold text-2xl text-poke-text-secondary">VS</span>

      {/* Player 2's Pokémon */}
      <div className="flex flex-col items-center gap-2">
        <FacingPokemon pokemon={pokemon2} />
      </div>
    </div>
  );
}
