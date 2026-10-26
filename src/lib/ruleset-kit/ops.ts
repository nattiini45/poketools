/**
 * The edits of a ruleset document, as pure functions: ban, unban, reset, switch a category between a block list and an
 * allowlist, add or remove a clause, and re-express a document against another base. Pure and client-safe.
 *
 * Contract of every operation (the tests fuzz it): it never throws, never mutates its input, never creates a duplicate
 * entry, stops at the list limits (`capped`), and returns the SAME document object when nothing changed so a reducer can
 * skip the render. The answer is the canonical minimal document: asking for a state the preset already gives removes the
 * redundant `ban` or `unban` instead of adding a contradicting one, so `ban` and `unban` stay disjoint and never repeat
 * what the base says.
 *
 * `changes` lists what each entry went from and to, for the undo history and the live announcement ("Garchomp banned").
 */
import { blankFormatKey, computeEffective, sortedUnique } from './effective';
import { entryState, presetRulesOut, type EntryState } from './entry-state';
import { MAX_CLAUSE_IDS, MAX_ID_LENGTH, MAX_IDS_PER_LIST } from './limits';
import { RULESET_CATEGORIES, type CategoryRules, type RulesetBase, type RulesetCategory, type RulesetDocument } from './types';
import type { PresetList, PresetRules } from '@/lib/pkmn/preset-rules';

export interface EntryChange {
  category: RulesetCategory;
  id: string;
  from: EntryState;
  to: EntryState;
}

export interface OpResult {
  doc: RulesetDocument;
  changes: EntryChange[];
  /** Some entries were not applied because a list reached its limit. */
  capped: boolean;
}

const ID_PATTERN = /^[a-z0-9]+$/;

function validId(id: string): boolean {
  return id.length > 0 && id.length <= MAX_ID_LENGTH && ID_PATTERN.test(id);
}

/** The ids that can be stored, once each, in the order given. */
function cleanIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (validId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameCategory(a: CategoryRules, b: CategoryRules): boolean {
  if (!sameList(a.ban, b.ban) || !sameList(a.unban, b.unban)) return false;
  if (a.allow === null || b.allow === null) return a.allow === b.allow;
  return sameList(a.allow, b.allow);
}

function withCategory(doc: RulesetDocument, category: RulesetCategory, next: CategoryRules): RulesetDocument {
  return sameCategory(doc[category], next) ? doc : { ...doc, [category]: next };
}

const noChange = (doc: RulesetDocument): OpResult => ({ doc, changes: [], capped: false });

/**
 * Makes every id legal (`legal: true`) or illegal. In block mode that edits `ban` and `unban` relative to the preset
 * (`base`, null for a blank base); in allow mode it adds the id to or removes it from the allowlist.
 */
export function setLegal(
  doc: RulesetDocument,
  category: RulesetCategory,
  ids: readonly string[],
  legal: boolean,
  base: PresetList | null,
): OpResult {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return noChange(doc);
  const before = doc[category];
  const changes: EntryChange[] = [];
  let capped = false;

  if (before.allow !== null) {
    const allow = new Set(before.allow);
    for (const id of wanted) {
      if (legal === allow.has(id)) continue;
      if (legal) {
        if (allow.size >= MAX_IDS_PER_LIST) {
          capped = true;
          continue;
        }
        allow.add(id);
      } else {
        allow.delete(id);
      }
      changes.push({ category, id, from: legal ? 'not_allowed' : 'allowed', to: legal ? 'allowed' : 'not_allowed' });
    }
    if (changes.length === 0) return { doc, changes, capped };
    return { doc: withCategory(doc, category, { ban: [], unban: [], allow: sortedUnique(allow) }), changes, capped };
  }

  const ban = new Set(before.ban);
  const unban = new Set(before.unban);
  for (const id of wanted) {
    const from = entryState(before, base, id);
    const ruledOut = presetRulesOut(base, id);
    if (legal) {
      ban.delete(id);
      if (ruledOut) {
        if (!unban.has(id) && unban.size >= MAX_IDS_PER_LIST) {
          capped = true;
          continue;
        }
        unban.add(id);
      } else if (base !== null || category !== 'pokemon') {
        unban.delete(id);
      }
    } else {
      unban.delete(id);
      if (ruledOut) {
        ban.delete(id);
      } else {
        if (!ban.has(id) && ban.size >= MAX_IDS_PER_LIST) {
          capped = true;
          continue;
        }
        ban.add(id);
      }
    }
    const to = entryState({ ban: sortedUnique(ban), unban: sortedUnique(unban), allow: null }, base, id);
    if (to !== from) changes.push({ category, id, from, to });
  }
  if (changes.length === 0) return { doc, changes, capped };
  return { doc: withCategory(doc, category, { ban: sortedUnique(ban), unban: sortedUnique(unban), allow: null }), changes, capped };
}

/** Bans the ids (allowlist mode: removes them from the allowlist). */
export const banEntries = (doc: RulesetDocument, category: RulesetCategory, ids: readonly string[], base: PresetList | null): OpResult =>
  setLegal(doc, category, ids, false, base);

/** Makes the ids legal (allowlist mode: adds them to the allowlist). */
export const allowEntries = (doc: RulesetDocument, category: RulesetCategory, ids: readonly string[], base: PresetList | null): OpResult =>
  setLegal(doc, category, ids, true, base);

/**
 * Flips each id: a legal one becomes banned, an illegal one legal. A mixed selection is decided by its first id, so one
 * click never leaves half of a selection in each state.
 */
export function toggleEntries(doc: RulesetDocument, category: RulesetCategory, ids: readonly string[], base: PresetList | null): OpResult {
  const wanted = cleanIds(ids);
  if (wanted.length === 0) return noChange(doc);
  const firstLegal = isLegalIn(doc, category, wanted[0], base);
  return setLegal(doc, category, wanted, !firstLegal, base);
}

function isLegalIn(doc: RulesetDocument, category: RulesetCategory, id: string, base: PresetList | null): boolean {
  const state = entryState(doc[category], base, id);
  return state === 'legal' || state === 'you_unbanned' || state === 'allowed';
}

/** Drops the document's own changes for the ids: back to what the preset says. In allowlist mode there is nothing to reset. */
export function resetEntries(doc: RulesetDocument, category: RulesetCategory, ids: readonly string[], base: PresetList | null): OpResult {
  const before = doc[category];
  if (before.allow !== null) return noChange(doc);
  const drop = new Set(cleanIds(ids));
  const changes: EntryChange[] = [];
  const ban = before.ban.filter((id) => !drop.has(id));
  const unban = before.unban.filter((id) => !drop.has(id));
  for (const id of drop) {
    if (!before.ban.includes(id) && !before.unban.includes(id)) continue;
    changes.push({ category, id, from: entryState(before, base, id), to: entryState({ ban, unban, allow: null }, base, id) });
  }
  if (changes.length === 0) return noChange(doc);
  return { doc: withCategory(doc, category, { ban, unban, allow: null }), changes, capped: false };
}

/** Drops every change of the category: back to the preset (block mode), or an empty allowlist stays as it is. */
export function resetCategory(doc: RulesetDocument, category: RulesetCategory, base: PresetList | null): OpResult {
  const before = doc[category];
  if (before.allow !== null) return noChange(doc);
  return resetEntries(doc, category, [...before.ban, ...before.unban], base);
}

/**
 * Switches a category between a block list and an allowlist. To `allow`, `seed` is the first allowlist (the ids that are
 * legal now, when the author asks for that; otherwise empty, which the compile reports as `allowlist_empty` until
 * something is allowed). To `block` the allowlist is dropped and the category is back to the preset.
 */
export function setMode(doc: RulesetDocument, category: RulesetCategory, mode: 'block' | 'allow', seed: readonly string[] = []): RulesetDocument {
  const before = doc[category];
  if (mode === 'allow') {
    if (before.allow !== null) return doc;
    return withCategory(doc, category, { ban: [], unban: [], allow: sortedUnique(cleanIds(seed).slice(0, MAX_IDS_PER_LIST)) });
  }
  if (before.allow === null) return doc;
  return withCategory(doc, category, { ban: [], unban: [], allow: null });
}

/**
 * Switches one clause on or off for the document, relative to the preset's clauses (`presetClauses`): a clause the
 * preset has is switched off by listing it in `remove`, one it lacks is switched on by listing it in `add`; the opposite
 * switch just drops the list entry.
 */
export function setClause(doc: RulesetDocument, id: string, on: boolean, presetClauses: readonly string[]): RulesetDocument {
  if (!validId(id)) return doc;
  const inPreset = presetClauses.includes(id);
  const add = new Set(doc.clauses.add);
  const remove = new Set(doc.clauses.remove);
  if (on) {
    remove.delete(id);
    if (!inPreset) {
      if (!add.has(id) && add.size >= MAX_CLAUSE_IDS) return doc;
      add.add(id);
    }
  } else {
    add.delete(id);
    if (inPreset) {
      if (!remove.has(id) && remove.size >= MAX_CLAUSE_IDS) return doc;
      remove.add(id);
    }
  }
  const next = { add: sortedUnique(add), remove: sortedUnique(remove) };
  if (sameList(next.add, doc.clauses.add) && sameList(next.remove, doc.clauses.remove)) return doc;
  return { ...doc, clauses: next };
}

// ── Rebase ───────────────────────────────────────────────────────────────────────

export interface RebaseResult {
  doc: RulesetDocument;
  /** Categories whose block list could not be written against the new base (a roster preset) and was dropped. */
  lossy: RulesetCategory[];
}

/** The blank base that has the generation, game type and universe of a preset. */
export function blankBaseOf(preset: PresetRules): RulesetBase {
  return { kind: 'blank', gen: preset.gen, doubles: preset.doubles, universe: preset.universe };
}

function rebaseCategory(
  effective: { mode: 'block' | 'allow'; ids: string[] },
  base: PresetList | null,
  keepUnban: readonly string[],
): { rules: CategoryRules; lossy: boolean } {
  if (effective.mode === 'allow') return { rules: { ban: [], unban: [], allow: [...effective.ids] }, lossy: false };
  if (base === null) return { rules: { ban: [...effective.ids], unban: [...keepUnban], allow: null }, lossy: false };
  if (base.mode === 'allow') {
    return { rules: { ban: [], unban: [], allow: null }, lossy: effective.ids.length > 0 };
  }
  const baseIds = new Set(base.ids);
  const effectiveIds = new Set(effective.ids);
  return {
    rules: {
      ban: effective.ids.filter((id) => !baseIds.has(id)),
      unban: base.ids.filter((id) => !effectiveIds.has(id)),
      allow: null,
    },
    lossy: false,
  };
}

/**
 * Re-expresses the document's EFFECTIVE rules against another base, so switching the base (a stored ruleset upgrades to
 * a catalog preset, a preset becomes blank, Gen 9 OU becomes Gen 9 UU) keeps what the ruleset enforces today and only
 * changes what it is written relative to. `from` is the resolved preset of the current base (null for a blank one);
 * `to` is the new base and its resolved preset (null for a blank one).
 *
 * Lists are re-written as `ban` and `unban` against the new preset; an allowlist stays an allowlist. A block list cannot
 * be written against a preset that is itself an allowlist (a roster), so that category falls back to the preset's
 * own rule and is reported in `lossy`. Clauses are re-expressed the same way.
 */
export function rebase(doc: RulesetDocument, from: PresetRules | null, to: { base: RulesetBase; preset: PresetRules | null }): RebaseResult {
  if (doc.base.kind === 'preset' && from === null) return { doc, lossy: [] };
  const effective = computeEffective(doc, doc.base.kind === 'preset' ? from : null);
  const newClauses = to.base.kind === 'preset' ? (to.preset?.clauses ?? []) : [];
  const now = new Set(effective.clauses);
  const kept = new Set(newClauses);
  const basedOn =
    to.base.kind === 'preset' ? to.base.preset : (doc.identity.based_on ?? (doc.base.kind === 'preset' ? doc.base.preset : undefined));
  const identity = { ...doc.identity };
  if (basedOn === undefined) delete identity.based_on;
  else identity.based_on = basedOn;

  const next: RulesetDocument = {
    ...doc,
    identity,
    base: to.base,
    clauses: { add: sortedUnique(effective.clauses.filter((id) => !kept.has(id))), remove: sortedUnique(newClauses.filter((id) => !now.has(id))) },
  };
  const lossy: RulesetCategory[] = [];
  for (const category of RULESET_CATEGORIES) {
    const keepUnban = doc.base.kind === 'blank' && to.base.kind === 'blank' && category === 'pokemon' ? doc.pokemon.unban : [];
    const result = rebaseCategory(effective[category], to.base.kind === 'preset' ? (to.preset?.[category] ?? null) : null, keepUnban);
    next[category] = {
      ban: sortedUnique(result.rules.ban),
      unban: sortedUnique(result.rules.unban),
      allow: result.rules.allow === null ? null : sortedUnique(result.rules.allow),
    };
    if (result.lossy) lossy.push(category);
  }
  return { doc: next, lossy };
}

/** The format key a document will have, for the summary line (`blankFormatKey` for a blank base, the preset id otherwise). */
export function formatKeyOf(doc: RulesetDocument): string {
  return doc.base.kind === 'preset' ? doc.base.preset : blankFormatKey(doc.identity.based_on, doc.base.gen, doc.base.doubles);
}
