/**
 * Bulk actions of the picker: which ids an action covers (the clicked entry, the selection, or the whole filtered
 * result), the forme expansion for species, the confirmation threshold and the application to the document through the
 * kit's operations. Pure and client-safe.
 *
 * Forme handling: a species is a family of ids (Rattata, Rattata-Alola; Charizard and its two Mega Evolutions). With
 * "include formes" on (the default) an action on a species covers its base species and every forme the index lists, so
 * one click bans the family; with it off the action acts on the clicked ids only ("this forme").
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
export type BulkScope = 'entry' | 'selection' | 'filtered';

/** A bulk action that would change more than this many entries asks for a confirmation first. */
export const CONFIRM_ABOVE = 200;

export function needsConfirmation(count: number): boolean {
  return count > CONFIRM_ABOVE;
}

export interface TargetInput {
  scope: BulkScope;
  /** The clicked or active entry (scope `entry`). */
  entryId: string | null;
  selectedIds: readonly string[];
  filteredIds: readonly string[];
  /** Species only: cover the whole family of each id. */
  includeFormes: boolean;
  /** The species index, for the forme expansion. */
  speciesIndex: EntryIndex<'species'> | null;
}

/** The ids an action covers, each once, in a stable order. */
export function resolveTargets(input: TargetInput): string[] {
  const base =
    input.scope === 'entry' ? (input.entryId === null ? [] : [input.entryId]) : input.scope === 'selection' ? input.selectedIds : input.filteredIds;
  const ids = input.includeFormes && input.speciesIndex !== null ? wholeSpeciesIds(input.speciesIndex, base) : [...base];
  return [...new Set(ids)];
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
