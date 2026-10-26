/**
 * What a single entry (a Pokémon, move, item or ability id) is under a document: the state the picker shows as a chip and
 * the operations start from. Pure and client-safe.
 *
 * A category is in one of two modes. In BLOCK mode (the document has no allowlist) the preset decides what is banned
 * and the document adds `ban` and `unban`:
 *
 *   preset_banned  the preset rules it out and the document leaves that alone
 *   you_banned     the document bans it (the preset does not)
 *   you_unbanned   the document makes it legal although the preset rules it out
 *   legal          nothing rules it out
 *
 * A preset whose own list is an allowlist (a Champions roster, Little Cup) "rules out" every id NOT on its list; the
 * same four states apply. In ALLOW mode (the document's `allow` is non-null) only the listed ids are legal:
 *
 *   allowed        on the allowlist
 *   not_allowed    not on it
 */
import type { PresetList } from '@/lib/pkmn/preset-rules';
import type { CategoryRules } from './types';

export const ENTRY_STATES = ['preset_banned', 'you_banned', 'you_unbanned', 'legal', 'allowed', 'not_allowed'] as const;
export type EntryState = (typeof ENTRY_STATES)[number];

/** Whether the preset itself rules `id` out (before the document's changes). */
export function presetRulesOut(base: PresetList | null, id: string): boolean {
  if (base === null) return false;
  const listed = base.ids.includes(id);
  return base.mode === 'block' ? listed : !listed;
}

/** A lookup that does not scan the list for every entry: the picker asks for thousands of ids. */
export interface StateLookup {
  stateOf: (id: string) => EntryState;
}

/** Builds `stateOf` for one category with set lookups. */
export function stateLookup(rules: CategoryRules, base: PresetList | null): StateLookup {
  const baseIds = base === null ? null : new Set(base.ids);
  const ban = new Set(rules.ban);
  const unban = new Set(rules.unban);
  const allow = rules.allow === null ? null : new Set(rules.allow);
  return {
    stateOf(id) {
      if (allow !== null) return allow.has(id) ? 'allowed' : 'not_allowed';
      const ruledOut = baseIds === null || base === null ? false : base.mode === 'block' ? baseIds.has(id) : !baseIds.has(id);
      if (unban.has(id)) return 'you_unbanned';
      if (ban.has(id)) return ruledOut ? 'preset_banned' : 'you_banned';
      return ruledOut ? 'preset_banned' : 'legal';
    },
  };
}

/** The state of one entry. */
export function entryState(rules: CategoryRules, base: PresetList | null, id: string): EntryState {
  return stateLookup(rules, base).stateOf(id);
}

/** Whether a team may bring an entry in this state. */
export function isLegalState(state: EntryState): boolean {
  return state === 'legal' || state === 'you_unbanned' || state === 'allowed';
}

/** Whether the document itself changed the entry from the preset's answer (a chip the author can undo with Reset). */
export function isAuthorState(state: EntryState): boolean {
  return state === 'you_banned' || state === 'you_unbanned';
}
