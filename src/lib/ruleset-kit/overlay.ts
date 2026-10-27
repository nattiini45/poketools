/**
 * "Add Smogon tour bans": applying the documented tournament extras of a draft preset to a ruleset document as ordinary,
 * editable entries. Pure and client-safe (types only from the preset shapes); the extras themselves are resolved on the
 * server (`resolveTourOverlay`), because item groups are expanded from the dex.
 *
 * A draft preset is Showdown-faithful (it enforces exactly what the Showdown format defines). The overlay is what the
 * Smogon draft league threads add on top: clauses the tour uses, clauses of the preset it does not use, and moves, items
 * and abilities it bans. Nothing is locked afterwards: every added clause and ban shows in the editor like one the author
 * typed and can be removed one by one. The overlay bans no Pokémon.
 *
 * Entries that change nothing are left out so the compile has no `ban_redundant` warning to show for a fresh document:
 * an id the preset's block list already bans, an id an allowlist-mode preset list does not allow, a clause the preset
 * already has, a removal of a clause it does not have. A category the document switched to an allowlist is skipped
 * (an allowlist and bans are exclusive).
 */
import type { PresetList, PresetRules, TourOverlayRules } from '@/lib/pkmn/preset-rules';
import { sortedUnique } from './effective';
import type { RulesetCategory, RulesetDocument } from './types';

/** The categories the overlay bans entries in. */
const OVERLAY_CATEGORIES = ['moves', 'items', 'abilities'] as const satisfies readonly RulesetCategory[];

/** What an overlay changed, for the confirmation line and the tests. */
export interface AppliedOverlay {
  clausesAdded: string[];
  clausesRemoved: string[];
  banned: Record<(typeof OVERLAY_CATEGORIES)[number], string[]>;
}

/** The ids of `overlayIds` that change the effective rules of a preset list, minus those the document already bans. */
function newBans(overlayIds: readonly string[], base: PresetList, already: readonly string[]): string[] {
  const baseIds = new Set(base.ids);
  const have = new Set(already);
  return sortedUnique(overlayIds).filter((id) => !have.has(id) && (base.mode === 'block' ? !baseIds.has(id) : baseIds.has(id)));
}

/**
 * A copy of `document` with the overlay of `overlay` applied on top of `preset` (the resolved rules of the document's
 * base preset). `applied` lists what was actually added.
 */
export function applyTourOverlay(
  document: RulesetDocument,
  overlay: TourOverlayRules,
  preset: PresetRules,
): { document: RulesetDocument; applied: AppliedOverlay } {
  const next = structuredClone(document);
  const baseClauses = new Set(preset.clauses);

  const clausesAdded = sortedUnique(overlay.clausesAdd).filter((id) => !baseClauses.has(id) && !next.clauses.add.includes(id));
  const clausesRemoved = sortedUnique(overlay.clausesRemove).filter((id) => baseClauses.has(id) && !next.clauses.remove.includes(id));
  next.clauses.add.push(...clausesAdded);
  next.clauses.remove.push(...clausesRemoved);

  const banned: AppliedOverlay['banned'] = { moves: [], items: [], abilities: [] };
  for (const category of OVERLAY_CATEGORIES) {
    const rules = next[category];
    if (rules.allow !== null) continue;
    banned[category] = newBans(overlay[category], preset[category], rules.ban);
    rules.ban.push(...banned[category]);
  }
  return { document: next, applied: { clausesAdded, clausesRemoved, banned } };
}
