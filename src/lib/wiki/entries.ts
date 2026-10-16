import { getMove, getItem, getAbility } from '@/lib/pkmn/dex';
import type { WikiMoveEntry, WikiItemEntry, WikiAbilityEntry } from '@/types/wiki';

type DexMove = ReturnType<typeof getMove>;
type DexItem = ReturnType<typeof getItem>;
type DexAbility = ReturnType<typeof getAbility>;

function moveFlags(move: NonNullable<DexMove>): string[] {
  const moveData = move as unknown as { flags?: Record<string, number> };
  return Object.keys(moveData.flags ?? {});
}

export function buildWikiMoveEntry(
  move: NonNullable<DexMove>,
  gen: number,
): WikiMoveEntry {
  const moveData = move as unknown as {
    desc?: string;
    shortDesc?: string;
    gen?: number;
  };

  return {
    name: move.name,
    type: move.type,
    category: move.category as WikiMoveEntry['category'],
    basePower: move.basePower,
    accuracy: move.accuracy === true ? null : move.accuracy,
    pp: move.pp,
    priority: move.priority,
    description: moveData.desc ?? '',
    shortDesc: moveData.shortDesc ?? '',
    flags: moveFlags(move),
    generation: moveData.gen ?? gen,
  };
}

export function buildWikiItemEntry(
  item: NonNullable<DexItem>,
  gen: number,
): WikiItemEntry {
  const itemData = item as unknown as {
    desc?: string;
    shortDesc?: string;
    gen?: number;
    fpierce?: boolean;
  };
  return {
    name: item.name,
    description: itemData.desc ?? '',
    shortDesc: itemData.shortDesc ?? '',
    generation: itemData.gen ?? gen,
    fpierce: itemData.fpierce,
  };
}

export function buildWikiAbilityEntry(
  ability: NonNullable<DexAbility>,
  gen: number,
): WikiAbilityEntry {
  const abilityData = ability as unknown as {
    desc?: string;
    shortDesc?: string;
    rating?: number;
    gen?: number;
  };
  return {
    name: ability.name,
    description: abilityData.desc ?? '',
    shortDesc: abilityData.shortDesc ?? '',
    rating: abilityData.rating ?? 0,
    generation: abilityData.gen ?? gen,
  };
}
