import { epbPack } from '@/lib/format-pack';
import {
  DEFAULT_BANNED_ITEMS,
  DEFAULT_BANNED_MOVES,
  type FormatRules,
  type FormatRulesFormData,
  type TiebreakerStep,
} from '@/types/format-rules';

/**
 * The format rules editor's form model: what the Rules tab edits of `format_rules`, the same limits
 * the PUT route's `formatRulesSchema` enforces, and the full-object payload the editor sends.
 *
 * Pure and client-safe (no React, no reads). Numbers live in the form as the text typed (empty =
 * unset) and are parsed only to validate, compare and build the payload. The module owns the limits;
 * `format-rules-form.test.ts` pins them against the server schema so they cannot drift.
 */

/** The numeric fields of the form, in display order. */
export const FORMAT_RULES_NUMBER_FIELDS = [
  'draft_budget',
  'draft_picks',
  'draft_token_ratio',
  'draft_token_max',
  'draft_token_max_per_line',
] as const;

export type FormatRulesNumberField = (typeof FORMAT_RULES_NUMBER_FIELDS)[number];

/** Whole-number limits per field (inclusive), as `formatRulesSchema` enforces them. */
export const FORMAT_RULES_LIMITS: Record<FormatRulesNumberField, { min: number; max: number }> = {
  draft_budget: { min: 1, max: 999 },
  draft_picks: { min: 1, max: 20 },
  draft_token_ratio: { min: 1, max: 10 },
  draft_token_max: { min: 0, max: 5 },
  draft_token_max_per_line: { min: 0, max: 3 },
};

/** Longest banned move or item name the schema accepts. */
export const BANNED_NAME_MAX_LENGTH = 100;

/** The tiebreaker steps the schema knows, in the pack's natural order. */
export const TIEBREAKER_STEPS: readonly TiebreakerStep[] = [
  'match_points',
  'evolution_points',
  'kill_difference',
  'head_to_head',
  'decision_match',
];

export interface FormatRulesFormValues {
  draft_budget: string;
  draft_picks: string;
  draft_token_ratio: string;
  draft_token_max: string;
  draft_token_max_per_line: string;
  /** Canonical English names. */
  banned_moves: string[];
  banned_items: string[];
  tiebreaker_order: TiebreakerStep[];
}

export type FormatRulesFieldKey = FormatRulesNumberField | 'banned_moves' | 'banned_items' | 'tiebreaker_order';

export type FormatRulesFieldErrorCode =
  | 'required'
  | 'not_integer'
  | 'too_small'
  | 'too_big'
  | 'empty'
  | 'duplicate'
  | 'too_long'
  | 'decision_last';

export interface FormatRulesFieldError {
  field: FormatRulesFieldKey;
  code: FormatRulesFieldErrorCode;
  /** The bound that was crossed (`too_small`: the minimum, `too_big` and `too_long`: the maximum). */
  limit?: number;
}

const FIELD_ORDER: readonly FormatRulesFieldKey[] = [
  ...FORMAT_RULES_NUMBER_FIELDS,
  'banned_moves',
  'banned_items',
  'tiebreaker_order',
];

function problem(field: FormatRulesFieldKey, code: FormatRulesFieldErrorCode, limit?: number): FormatRulesFieldError {
  return limit === undefined ? { field, code } : { field, code, limit };
}

const WHOLE_NUMBER = /^-?\d+$/;

/** Stored rules → form values. */
export function formatRulesToForm(rules: FormatRules): FormatRulesFormValues {
  return {
    draft_budget: String(rules.draft_budget),
    draft_picks: String(rules.draft_picks),
    draft_token_ratio: String(rules.draft_token_ratio),
    draft_token_max: String(rules.draft_token_max),
    draft_token_max_per_line: String(rules.draft_token_max_per_line),
    banned_moves: [...rules.banned_moves],
    banned_items: [...rules.banned_items],
    tiebreaker_order: [...rules.tiebreaker_order],
  };
}

/** The whole number typed in a field, or null when it is empty or not a whole number. */
function parseWholeNumber(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : null;
}

/** A comparable key: '5' and '05' share one, unparsable input keeps its (trimmed) text. */
function numberKey(text: string): string {
  const parsed = parseWholeNumber(text);
  return parsed === null ? `text:${text.trim()}` : `number:${parsed}`;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((name) => right.has(name));
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The fields whose value differs from the baseline, in form order. */
export function changedFormatRulesFields(
  baseline: FormatRulesFormValues,
  values: FormatRulesFormValues,
): FormatRulesFieldKey[] {
  return FIELD_ORDER.filter((field) => {
    switch (field) {
      case 'banned_moves':
      case 'banned_items':
        return !sameSet(baseline[field], values[field]);
      case 'tiebreaker_order':
        return !sameList(baseline[field], values[field]);
      default:
        return numberKey(baseline[field]) !== numberKey(values[field]);
    }
  });
}

/** Does the form hold input that differs from the baseline? Ban order is ignored, tiebreaker order counts. */
export function formatRulesFormDirty(baseline: FormatRulesFormValues, values: FormatRulesFormValues): boolean {
  return changedFormatRulesFields(baseline, values).length > 0;
}

function validateNumber(field: FormatRulesNumberField, text: string): FormatRulesFieldError | null {
  if (text.trim() === '') return problem(field, 'required');
  const value = parseWholeNumber(text);
  if (value === null) return problem(field, 'not_integer');
  const { min, max } = FORMAT_RULES_LIMITS[field];
  if (value < min) return problem(field, 'too_small', min);
  if (value > max) return problem(field, 'too_big', max);
  return null;
}

function validateBanList(field: 'banned_moves' | 'banned_items', names: readonly string[]): FormatRulesFieldError[] {
  const errors: FormatRulesFieldError[] = [];
  if (names.some((name) => name.trim() === '')) errors.push(problem(field, 'empty'));
  if (names.some((name) => name.length > BANNED_NAME_MAX_LENGTH)) {
    errors.push(problem(field, 'too_long', BANNED_NAME_MAX_LENGTH));
  }
  if (new Set(names).size !== names.length) errors.push(problem(field, 'duplicate'));
  return errors;
}

function validateTiebreaker(order: readonly TiebreakerStep[]): FormatRulesFieldError[] {
  const field = 'tiebreaker_order';
  const errors: FormatRulesFieldError[] = [];
  if (order.length === 0) errors.push(problem(field, 'empty'));
  if (new Set(order).size !== order.length) errors.push(problem(field, 'duplicate'));
  const decision = order.indexOf('decision_match');
  // The pack schema's own invariant: a decision match, when present, is the last step.
  if (decision !== -1 && decision !== order.length - 1) errors.push(problem(field, 'decision_last'));
  return errors;
}

/** Everything wrong with the form, in form order (the same limits the server enforces). Empty when it can be saved. */
export function validateFormatRulesForm(values: FormatRulesFormValues): FormatRulesFieldError[] {
  const errors: FormatRulesFieldError[] = [];
  for (const field of FORMAT_RULES_NUMBER_FIELDS) {
    const error = validateNumber(field, values[field]);
    if (error) errors.push(error);
  }
  errors.push(...validateBanList('banned_moves', values.banned_moves));
  errors.push(...validateBanList('banned_items', values.banned_items));
  errors.push(...validateTiebreaker(values.tiebreaker_order));
  return errors;
}

/**
 * The PUT body for the form: ALWAYS the full object. `upsertFormatRules` writes every column from the
 * input or the pack's fallback, so a partial body would reset the fields it leaves out (the bans
 * included). Never carries `tera_rules` (pinned to the format pack: omitted = the pack's rules) or
 * `redraft_phase_open` (an unsent field is not written; the PUT has no advisory lock, the dedicated
 * redraft toggle does).
 *
 * Call `validateFormatRulesForm` first: an empty or non-numeric field becomes NaN, which the server rejects.
 */
export function buildFormatRulesPayload(values: FormatRulesFormValues): FormatRulesFormData {
  const number = (field: FormatRulesNumberField): number => parseWholeNumber(values[field]) ?? Number.NaN;
  return {
    banned_moves: [...values.banned_moves],
    banned_items: [...values.banned_items],
    tiebreaker_order: [...values.tiebreaker_order],
    draft_budget: number('draft_budget'),
    draft_picks: number('draft_picks'),
    draft_token_ratio: number('draft_token_ratio'),
    draft_token_max: number('draft_token_max'),
    draft_token_max_per_line: number('draft_token_max_per_line'),
  };
}

/** The tiebreaker order with the step at `index` moved one place up (-1) or down (+1); unchanged at the ends. */
export function moveTiebreakerStep(
  order: readonly TiebreakerStep[],
  index: number,
  delta: -1 | 1,
): TiebreakerStep[] {
  const target = index + delta;
  const next = [...order];
  if (index < 0 || index >= order.length || target < 0 || target >= order.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The steps not in the order yet. */
export function unusedTiebreakerSteps(order: readonly TiebreakerStep[]): TiebreakerStep[] {
  return TIEBREAKER_STEPS.filter((step) => !order.includes(step));
}

/** The order with `step` added: a decision match stays last, any other step goes before it. */
export function addTiebreakerStep(order: readonly TiebreakerStep[], step: TiebreakerStep): TiebreakerStep[] {
  if (order.includes(step)) return [...order];
  const decision = order.indexOf('decision_match');
  if (step === 'decision_match' || decision === -1) return [...order, step];
  return [...order.slice(0, decision), step, ...order.slice(decision)];
}

/** The order without the step at `index`. */
export function removeTiebreakerStep(order: readonly TiebreakerStep[], index: number): TiebreakerStep[] {
  return order.filter((_, position) => position !== index);
}

/**
 * The body "Initialize default rules" sends for a league without a format rules row: the format
 * pack's bans and draft numbers. The tiebreaker order and Tera rules are left out, so the server
 * fills them from the pack.
 */
export function defaultFormatRulesPayload(): FormatRulesFormData {
  return {
    banned_moves: [...DEFAULT_BANNED_MOVES],
    banned_items: [...DEFAULT_BANNED_ITEMS],
    draft_budget: epbPack.defaults.draftBudget,
    draft_picks: epbPack.defaults.draftPicks,
    draft_token_ratio: epbPack.defaults.tokenRatio,
    draft_token_max: epbPack.defaults.tokenMax,
    draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
  };
}
