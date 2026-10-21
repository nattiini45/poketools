'use client';

import { useEditorContext } from '../editor/EditorContext';
import type { PokemonSet } from '@/types/team';

export interface IntelSubject {
  slot: number | null;
  set: PokemonSet | null;
}

/**
 * The Pokémon the per-mon Intel tabs (Sets/Calc/Speed) operate on.
 *
 * Pure derivation (no state, no effects): the active slot when it holds a
 * Pokémon, otherwise the first filled slot, otherwise null. This keeps the
 * Intel panel useful in grid view where activeSlot is often null.
 */
export function useIntelSubject(): IntelSubject {
  const { state } = useEditorContext();

  if (state.activeSlot !== null && state.team[state.activeSlot]?.species) {
    return { slot: state.activeSlot, set: state.team[state.activeSlot] };
  }

  const firstFilled = state.team.findIndex((s) => s !== null && !!s.species);
  if (firstFilled !== -1) {
    return { slot: firstFilled, set: state.team[firstFilled] };
  }

  return { slot: null, set: null };
}
