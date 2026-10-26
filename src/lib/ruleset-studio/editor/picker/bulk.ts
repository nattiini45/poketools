/**
 * Bulk actions of the picker: the forme expansion of the ids an action covers, the confirmation threshold and the
 * application to the document through the kit's operations. Pure and client-safe.
 *
 * Forme handling: a species is a family of ids (Rattata, Rattata-Alola; Charizard and its two Mega Evolutions). With
 * "include formes" on (the default) an action on the clicked entry or the selection covers the base species and every
 * forme the index lists, so one click bans the family; with it off the action acts on the clicked ids only ("this
 * forme"). An action on "everything the filters show" never expands: it covers exactly the entries in view.
 */
import {
  allowEntries,
  banEntries,
  resetEntries,
  toggleEntries,
  type OpResult,
} from '@/lib/ruleset-kit/ops';
import type { PresetList } from '@/lib/pkmn/preset-rules';
import type { RulesetCategory, RulesetDocument } from '@/lib/ruleset-kit/types';
import type { HistoryEntry } from './history';
import { wholeSpeciesIds, type EntryIndex } from './entry-index';

export type BulkAction = 'ban' | 'unban' | 'reset' | 'allow' | 'toggle';
/** What a bulk action covers: the clicked entry or the selection (with the family), or exactly the filtered result. */
export type BulkScope = 'selection' | 'filtered';

/** A bulk action that would change more than this many entries asks for a confirmation first. */
export const CONFIRM_ABOVE = 200;

export function needsConfirmation(count: number): boolean {
  return count > CONFIRM_ABOVE;
}

/**
 * The ids an action covers, each once, in a stable order. Species only: for the `selection` scope with `includeFormes`
 * each id brings its whole family (`speciesIndex` is null for the other kinds, which have no formes). The `filtered`
 * scope is exactly the ids given, so "ban all N filtered" never bans an entry the filters excluded.
 */
export function resolveTargets(ids: readonly string[], scope: BulkScope, includeFormes: boolean, speciesIndex: EntryIndex<'species'> | null): string[] {
  const expand = scope === 'selection' && includeFormes && speciesIndex !== null;
  return [...new Set(expand ? wholeSpeciesIds(speciesIndex, ids) : ids)];
}

/** Applies an action to the ids of one category. `base` is the preset's list for the category (null for a blank base). */
export function applyBulk(doc: RulesetDocument, category: RulesetCategory, action: BulkAction, ids: readonly string[], base: PresetList | null): OpResult {
  switch (action) {
    case 'ban': return banEntries(doc, category, ids, base);
    case 'unban':
    case 'allow': return allowEntries(doc, category, ids, base);
    case 'reset': return resetEntries(doc, category, ids, base);
    case 'toggle': return toggleEntries(doc, category, ids, base);
  }
}

/** The history entry's description of an applied result: how many entries and the first one. */
export function describeResult(action: BulkAction, result: OpResult): Pick<HistoryEntry, 'count' | 'firstId' | 'action'> {
  const first = result.changes[0];
  const to = first?.to;
  const kind: HistoryEntry['action'] =
    action === 'reset' ? 'reset' : action === 'toggle' ? (to === 'you_banned' || to === 'preset_banned' || to === 'not_allowed' ? 'ban' : 'unban') : action === 'ban' ? 'ban' : 'unban';
  return { count: result.changes.length, firstId: first?.id ?? null, action: kind };
}
