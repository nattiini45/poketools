/**
 * Active filter chips (draft-frontend §4.7 `activeChips`, §5.5 `ActiveFilterChips`). Client-safe, pure.
 *
 * A chip carries ids and canonical English names only (`labelParts`); the component renders the label
 * through the name layer and `draft/finder` messages. Chip ids are stable and parsed back by the reducer's
 * `removeChip`.
 *
 * A utility selection is ONE chip level: the category chip when no member is picked ("any of the category"),
 * otherwise only its member chips. The category is never shown beside its own members, so the row has no
 * redundant handle; removing the last member chip removes the whole category (`reducer.removeChip`).
 */
import type { UtilityKey } from '@/types/draft-queue';
import { UTILITY_CATEGORIES } from '@/lib/draft/utility-categories';
import type { DefenseRelation, FinderFilters, StatKey } from './filter-types';
import { isTypeId, type TypeId } from './index-types';

export type ChipKind = 'type' | 'move' | 'ability' | 'utility' | 'utilityMember' | 'stat' | 'price' | 'defense';

export type ChipLabelParts =
  | { kind: 'type'; type: TypeId }
  /** `name` = canonical English move name (`moveNames`), or the id when the index is not loaded yet. */
  | { kind: 'move'; moveId: string; name: string }
  | { kind: 'ability'; abilityId: string; name: string }
  | { kind: 'utility'; key: UtilityKey }
  | { kind: 'utilityMember'; key: UtilityKey; memberKind: 'move' | 'ability'; memberId: string; name: string }
  | { kind: 'stat'; stat: StatKey | 'bst'; value: number }
  | { kind: 'price'; max: number }
  | { kind: 'defense'; relation: DefenseRelation; type: TypeId };

export interface FilterChip {
  id: string;
  kind: ChipKind;
  labelParts: ChipLabelParts;
}

/** English names for ids, from the search index when it is loaded. */
export interface ChipNameSource {
  moveName(id: string): string | undefined;
  abilityName(id: string): string | undefined;
}

export type ParsedChipId =
  | { kind: 'type'; type: TypeId }
  | { kind: 'move'; id: string }
  | { kind: 'ability'; id: string }
  | { kind: 'utility'; key: UtilityKey }
  | { kind: 'utilityMember'; key: UtilityKey; id: string }
  | { kind: 'stat'; stat: StatKey | 'bst' }
  | { kind: 'price' }
  | { kind: 'defense'; relation: DefenseRelation; type: TypeId };

const UTILITY_KEYS: ReadonlySet<string> = new Set(UTILITY_CATEGORIES.map((c) => c.key));
const STATS: ReadonlySet<string> = new Set(['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst']);
const RELATIONS: ReadonlySet<string> = new Set(['resists', 'immune', 'weak']);

const isUtilityKey = (v: string): v is UtilityKey => UTILITY_KEYS.has(v);
const isStat = (v: string): v is StatKey | 'bst' => STATS.has(v);
const isRelation = (v: string): v is DefenseRelation => RELATIONS.has(v);

export const chipId = {
  type: (t: TypeId) => `type:${t}`,
  move: (id: string) => `move:${id}`,
  ability: (id: string) => `ability:${id}`,
  utility: (key: UtilityKey) => `utility:${key}`,
  utilityMember: (key: UtilityKey, id: string) => `utility:${key}:${id}`,
  stat: (stat: StatKey | 'bst') => `stat:${stat}`,
  price: () => 'price',
  defense: (relation: DefenseRelation, t: TypeId) => `def:${relation}:${t}`,
} as const;

/** Inverse of `chipId`; null for an unknown or malformed id. */
export function parseChipId(id: string): ParsedChipId | null {
  if (id === 'price') return { kind: 'price' };
  const parts = id.split(':');
  const [head, a, b] = parts;
  switch (head) {
    case 'type':
      return parts.length === 2 && isTypeId(a) ? { kind: 'type', type: a } : null;
    case 'move':
      return parts.length === 2 && a ? { kind: 'move', id: a } : null;
    case 'ability':
      return parts.length === 2 && a ? { kind: 'ability', id: a } : null;
    case 'utility':
      if (!isUtilityKey(a)) return null;
      if (parts.length === 2) return { kind: 'utility', key: a };
      return parts.length === 3 && b ? { kind: 'utilityMember', key: a, id: b } : null;
    case 'stat':
      return parts.length === 2 && isStat(a) ? { kind: 'stat', stat: a } : null;
    case 'def':
      return parts.length === 3 && isRelation(a) && isTypeId(b) ? { kind: 'defense', relation: a, type: b } : null;
    default:
      return null;
  }
}

const STAT_ORDER: readonly (StatKey | 'bst')[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'bst'];

/**
 * One chip per active selection, in panel order: types, moves, abilities, utility (the category chip, or one
 * chip per picked member when members are picked), stats, max price, defensive relations. The search text
 * is not a chip.
 */
export function buildChips(f: FinderFilters, names?: ChipNameSource | null): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const t of f.types.ids) {
    chips.push({ id: chipId.type(t), kind: 'type', labelParts: { kind: 'type', type: t } });
  }
  for (const id of f.moves.ids) {
    chips.push({
      id: chipId.move(id),
      kind: 'move',
      labelParts: { kind: 'move', moveId: id, name: names?.moveName(id) ?? id },
    });
  }
  for (const id of f.abilities.ids) {
    chips.push({
      id: chipId.ability(id),
      kind: 'ability',
      labelParts: { kind: 'ability', abilityId: id, name: names?.abilityName(id) ?? id },
    });
  }
  for (const u of f.utility) {
    if (u.members.length === 0) {
      chips.push({ id: chipId.utility(u.key), kind: 'utility', labelParts: { kind: 'utility', key: u.key } });
      continue;
    }
    const def = UTILITY_CATEGORIES.find((c) => c.key === u.key);
    for (const memberId of u.members) {
      const memberKind = def?.members.find((m) => m.id === memberId)?.kind ?? 'move';
      const name =
        (memberKind === 'move' ? names?.moveName(memberId) : names?.abilityName(memberId)) ?? memberId;
      chips.push({
        id: chipId.utilityMember(u.key, memberId),
        kind: 'utilityMember',
        labelParts: { kind: 'utilityMember', key: u.key, memberKind, memberId, name },
      });
    }
  }
  for (const stat of STAT_ORDER) {
    const value = f.stats[stat];
    if (value === undefined) continue;
    chips.push({ id: chipId.stat(stat), kind: 'stat', labelParts: { kind: 'stat', stat, value } });
  }
  if (f.maxPrice !== null) {
    chips.push({ id: chipId.price(), kind: 'price', labelParts: { kind: 'price', max: f.maxPrice } });
  }
  for (const d of f.defense) {
    chips.push({
      id: chipId.defense(d.relation, d.type),
      kind: 'defense',
      labelParts: { kind: 'defense', relation: d.relation, type: d.type },
    });
  }
  return chips;
}
