import { Dex } from '@pkmn/dex';

/**
 * Showdown team preview hides unrevealed sets as "Species-*" (ability/item unknown).
 * @see https://github.com/smogon/pokemon-showdown/blob/master/sim/SIM-PROTOCOL.md
 */
export function stripHiddenPreviewSuffix(species: string): string {
  return species.replace(/-\*$/, '');
}

/** Dex entity key for same-slot forme continuity (e.g. Mimikyu / Mimikyu-Busted). */
export function replaySpeciesEntityKey(species: string): string {
  const stripped = stripHiddenPreviewSuffix(species);
  try {
    const data = Dex.species?.get?.(stripped);
    if (data) {
      return data.baseSpecies ?? data.name;
    }
  } catch {
    // Dex unavailable (e.g. partial mocks in tests)
  }
  if (stripped.endsWith('-Busted')) {
    return stripped.slice(0, -'-Busted'.length);
  }
  return stripped;
}

/**
 * True when two log species strings are the same mon in the same slot
 * (e.g. Mimikyu → Mimikyu-Busted, Greninja-* → Greninja).
 * Does not merge distinct formes that share a dex base (e.g. Rotom-Wash vs Rotom-Heat).
 */
export function isSameReplayPokemonEntity(a: string, b: string): boolean {
  const aStripped = stripHiddenPreviewSuffix(a);
  const bStripped = stripHiddenPreviewSuffix(b);
  if (aStripped === bStripped) return true;

  const aKey = replaySpeciesEntityKey(aStripped);
  const bKey = replaySpeciesEntityKey(bStripped);
  if (aKey !== bKey) return false;

  // Hidden team preview merged with revealed switch-in
  if (a.endsWith('-*') || b.endsWith('-*')) return true;

  // Cosmetic / battle forme on the base species (Mimikyu-Busted, etc.)
  if (aStripped === aKey || bStripped === bKey) return true;

  return false;
}
