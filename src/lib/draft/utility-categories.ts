/**
 * Draft utility categories (draft-backend §2.6, critique S9). Client-safe, ids only.
 *
 * League configuration, not Pokémon data: each category is a whitelist of `@pkmn` move/ability
 * ids from the active format pack (`epb.utility`, `@/lib/format-pack`), usually derived from the
 * league's utility sheet (`epb.workbook.utilitySheet`). This module derives the finder views.
 * Which line actually has a member, and from which stage, always comes from the Gen 9 (Paldea)
 * learnsets and abilities, never from the sheet's species column (`utility-matches.server.ts` on
 * the server, the finder index on the client). `src/lib/format-pack/__tests__/pack-pkmn.server.test.ts`
 * checks every id against `@pkmn/dex`.
 *
 * Labels: `utilityLabel(key, locale)` from `@/lib/format-pack`; never a draft namespace key.
 */

import { epbPack } from '@/lib/format-pack';
import { toID } from '@/lib/pkmn/i18n/id';

/**
 * The single declaration of UtilityKey; `src/types/draft-queue.ts` re-exports it (critique S8).
 * A key of the active pack's `epb.utility.order`.
 */
export type UtilityKey = string;

/** The pack's utility keys in display order. */
export const UTILITY_ORDER: readonly UtilityKey[] = epbPack.utility.order;

export interface UtilityMember {
  kind: 'move' | 'ability';
  /** `@pkmn` id. */
  id: string;
  /** Whether selecting the whole category matches this member. */
  inParentMatch: boolean;
  /** `sheet` = from the league's utility sheet; `authored` = added by league ruling. */
  source: 'sheet' | 'authored';
  /** Why this member is special, for the reconciliation report and the finder note. */
  flag?: string;
}

export interface UtilityCategoryDef {
  key: UtilityKey;
  members: readonly UtilityMember[];
  /** Move ids of `members` (finder view). */
  moves: readonly string[];
  /** Ability ids of `members` (finder view). */
  abilities: readonly string[];
  /** Member ids that only match when selected on their own. */
  excludeFromParent: readonly string[];
}

function define(key: UtilityKey, members: readonly UtilityMember[]): UtilityCategoryDef {
  return {
    key,
    members,
    moves: members.filter((m) => m.kind === 'move').map((m) => m.id),
    abilities: members.filter((m) => m.kind === 'ability').map((m) => m.id),
    excludeFromParent: members.filter((m) => !m.inParentMatch).map((m) => m.id),
  };
}

export const UTILITY_CATEGORIES: readonly UtilityCategoryDef[] = epbPack.utility.categories.map((c) =>
  define(c.key, c.members),
);

/** Sheet moves deliberately left out of every category (e.g. banned), for the reconciliation report. */
export const DROPPED_UTILITY_MOVES: readonly { id: string; reason: string }[] = epbPack.utility.dropped;

export function utilityCategory(key: UtilityKey): UtilityCategoryDef {
  const def = UTILITY_CATEGORIES.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown utility category: ${key}`);
  return def;
}

/** A season ban list (English move names, e.g. `format_rules.banned_moves`) as a set of move ids. */
export function bannedMoveIdSet(names: Iterable<string>): Set<string> {
  const ids = new Set<string>();
  for (const name of names) ids.add(toID(name));
  return ids;
}

/**
 * Members that match the whole category: `inParentMatch` and not banned
 * (`banned` = the season's banned move ids).
 */
export function parentMatchIds(
  def: UtilityCategoryDef,
  banned: ReadonlySet<string>,
): { moves: string[]; abilities: string[] } {
  const moves: string[] = [];
  const abilities: string[] = [];
  for (const m of def.members) {
    if (!m.inParentMatch) continue;
    if (m.kind === 'move') {
      if (!banned.has(m.id)) moves.push(m.id);
    } else {
      abilities.push(m.id);
    }
  }
  return { moves, abilities };
}
