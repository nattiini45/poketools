import type { FormatDefaults } from '@/lib/pkmn/format-catalog';
import { isEmptyTeamConstraints, normalizeTeamConstraints } from '@/lib/pkmn/team-constraints';
import type { BaseFormat, RulesetFormData, TeamConstraints } from '@/types/ruleset';

// Pure helpers of the ruleset builder: what a base-format switch would throw
// away, how the defaults are applied, and what the save payload carries.

/** The part of the form a base format's defaults fill in. */
export type RulesetLists = Pick<
  RulesetFormData,
  'is_doubles' | 'clauses' | 'banned_pokemon' | 'banned_moves' | 'banned_items' | 'banned_abilities' | 'added_pokemon'
>;

export const LIST_KEYS = [
  'clauses',
  'banned_pokemon',
  'banned_moves',
  'banned_items',
  'banned_abilities',
  'added_pokemon',
] as const;

export type ListKey = (typeof LIST_KEYS)[number];

/** One list that differs from the current format's defaults. */
export interface ListChange {
  key: ListKey;
  /** Entries in the form that the current format's defaults do not have. */
  added: number;
  /** Entries of the current format's defaults that the form no longer has. */
  removed: number;
  /** Entries in the form's list. */
  total: number;
}

export interface FormatSwitchImpact {
  /** True when replacing the lists with another format's defaults would lose manual work. */
  customised: boolean;
  doublesDiffers: boolean;
  /** False when the current format's defaults could not be loaded. */
  baselineKnown: boolean;
  changes: ListChange[];
}

export function listsOf(form: RulesetFormData): RulesetLists {
  return {
    is_doubles: form.is_doubles,
    clauses: form.clauses,
    banned_pokemon: form.banned_pokemon,
    banned_moves: form.banned_moves,
    banned_items: form.banned_items,
    banned_abilities: form.banned_abilities,
    added_pokemon: form.added_pokemon,
  };
}

/** Format defaults carry no ability bans or additions: those start empty. */
export function defaultsToLists(d: FormatDefaults): RulesetLists {
  return {
    is_doubles: d.is_doubles,
    clauses: d.clauses,
    banned_pokemon: d.banned_pokemon,
    banned_moves: d.banned_moves,
    banned_items: d.banned_items,
    banned_abilities: [],
    added_pokemon: [],
  };
}

function normalizedSet(items: readonly string[]): Set<string> {
  return new Set(items.map((item) => item.trim().toLowerCase()));
}

/**
 * Compares the form's lists with the defaults of the format it currently has
 * (case-insensitive, trimmed, order ignored). A `null` baseline means those
 * defaults are unknown, so every non-empty list counts as customised.
 */
export function formatSwitchImpact(current: RulesetLists, baseline: RulesetLists | null): FormatSwitchImpact {
  const changes: ListChange[] = [];
  for (const key of LIST_KEYS) {
    const list = current[key];
    if (baseline === null) {
      if (list.length > 0) changes.push({ key, added: list.length, removed: 0, total: list.length });
      continue;
    }
    const now = normalizedSet(list);
    const before = normalizedSet(baseline[key]);
    let added = 0;
    let removed = 0;
    for (const item of now) if (!before.has(item)) added += 1;
    for (const item of before) if (!now.has(item)) removed += 1;
    if (added > 0 || removed > 0) changes.push({ key, added, removed, total: list.length });
  }
  const doublesDiffers = baseline !== null && current.is_doubles !== baseline.is_doubles;
  return {
    customised: changes.length > 0 || doublesDiffers,
    doublesDiffers,
    baselineKnown: baseline !== null,
    changes,
  };
}

/** Switches to `format` and fills the lists from its defaults (copies, never the cached arrays). */
export function applyDefaults(form: RulesetFormData, format: BaseFormat, d: FormatDefaults): RulesetFormData {
  return {
    ...form,
    base_format: format,
    is_doubles: d.is_doubles,
    clauses: [...d.clauses],
    banned_pokemon: [...d.banned_pokemon],
    banned_moves: [...d.banned_moves],
    banned_items: [...d.banned_items],
    banned_abilities: [],
    added_pokemon: [],
  };
}

/** Switches the format label only; every list and the doubles flag stay. */
export function keepLists(form: RulesetFormData, format: BaseFormat): RulesetFormData {
  return { ...form, base_format: format };
}

/**
 * True for a form that enforces nothing beyond the generation: a real base
 * format (not 'blank') with no clause, no ban and no addition.
 */
export function isRuleless(form: RulesetFormData): boolean {
  if (form.base_format === 'blank') return false;
  return LIST_KEYS.every((key) => form[key].length === 0);
}

/**
 * The form as sent to the API. Team constraints are normalised (an empty block
 * becomes `null`), except that an untouched stored empty object stays an empty
 * object, so an existing ruleset keeps resolving the way it is stored.
 */
export function toSavePayload(
  form: RulesetFormData,
  storedTeamConstraints?: TeamConstraints | null,
): RulesetFormData {
  const current = form.team_constraints;
  if (current === null || current === undefined) return { ...form, team_constraints: null };
  if (isEmptyTeamConstraints(current) && storedTeamConstraints != null && isEmptyTeamConstraints(storedTeamConstraints)) {
    return { ...form, team_constraints: {} };
  }
  return { ...form, team_constraints: normalizeTeamConstraints(current) };
}
