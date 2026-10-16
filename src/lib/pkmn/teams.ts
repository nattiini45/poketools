import { Teams, Sets } from '@pkmn/sets';
import type { PokemonSet, StatSpread } from '@/types/team';

const DEFAULT_IVS: StatSpread = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const DEFAULT_EVS: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

/**
 * Normalise a raw set object from @pkmn/sets into our PokemonSet shape.
 * Fills in missing defaults so downstream code never sees undefined fields.
 */
function normaliseSet(raw: Record<string, unknown>): PokemonSet {
  const evs = (raw.evs ?? DEFAULT_EVS) as StatSpread;
  const ivs = (raw.ivs ?? DEFAULT_IVS) as StatSpread;

  return {
    name: (raw.name as string) ?? '',
    species: (raw.species as string) ?? '',
    gender: (raw.gender as string) ?? '',
    item: (raw.item as string) ?? '',
    ability: (raw.ability as string) ?? '',
    evs: { ...DEFAULT_EVS, ...evs },
    ivs: { ...DEFAULT_IVS, ...ivs },
    nature: (raw.nature as string) ?? '',
    level: (raw.level as number) ?? 100,
    moves: (raw.moves as string[]) ?? [],
    shiny: (raw.shiny as boolean) ?? false,
    happiness: (raw.happiness as number) ?? undefined,
    tera_type: (raw.teraType as string) ?? undefined,
  };
}

/**
 * Parse raw Pokémon Showdown text into typed PokemonSet[].
 * Accepts full team pastes (multiple sets separated by blank lines).
 */
export function parseTeamText(text: string): PokemonSet[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const result = Teams.importTeam(trimmed);
  if (!result || !result.team || result.team.length === 0) return [];

  return (result.team as Record<string, unknown>[]).map((raw: Record<string, unknown>) =>
    normaliseSet(raw)
  );
}

/**
 * Export a single PokemonSet back to PS text format.
 */
export function exportSetText(set: PokemonSet): string {
  return Sets.exportSet({
    name: set.name,
    species: set.species,
    gender: set.gender,
    item: set.item,
    ability: set.ability,
    evs: set.evs,
    ivs: set.ivs,
    nature: set.nature,
    level: set.level === 100 ? undefined : set.level,
    moves: set.moves,
    shiny: set.shiny,
    happiness: set.happiness,
    teraType: set.tera_type,
  });
}

/**
 * Export a full team (array of PokemonSet) to PS text format.
 */
export function exportTeamText(sets: PokemonSet[]): string {
  return sets.map(exportSetText).join('\n');
}
