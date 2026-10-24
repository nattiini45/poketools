/**
 * Diagnostic vocabulary of the format-kit compiler.
 *
 * A diagnostic is a code, a severity, a JSON pointer into the definition and a flat params record. It never holds
 * localized text: the cache boundary stays clean, and `render.ts` turns code + params into a sentence after the read.
 * Stage-ish params (`stage`, `from_stage`, `to_stage`, `edge`, `rule`) always carry KEYS; names are resolved when
 * rendering.
 */
import { escapePointerSegment, type PatchOp } from '../patch';

export const DIAGNOSTIC_CODES = [
  // Schema (validator issues, one code per issue code)
  'schema_required',
  'schema_type',
  'schema_enum',
  'schema_range',
  'schema_length',
  'schema_pattern',
  'schema_unknown_key',
  'schema_limit',
  'schema_refine',
  'schema_not_available_yet',
  // Schema note
  'rule_unknown_primitive',
  // Structure and graph
  'key_duplicate',
  'ref_unknown_stage',
  'stage_cycle',
  'stage_unreachable',
  'stage_roster_with_incoming',
  // Participant flow
  'stage_too_few_participants',
  'participant_count_unknown',
  'groups_too_many',
  'groups_uneven',
  // Edges
  'advance_exceeds_source',
  'advance_per_group_without_groups',
  'advance_bracket_byes',
  'advance_overlap',
  // Series
  'swiss_rounds_too_many',
  'series_even_best_of',
  'series_override_duplicate',
  'series_override_unreachable',
  // Match model gate
  'draws_unsupported',
  'forfeits_unsupported',
  'players_per_match_unsupported',
  // Scoring and ranking
  'scoring_win_not_better',
  'rank_chain_empty',
  'rank_ignored_for_bracket',
  'metric_unproduced',
  'rank_decision_match_position',
  'rank_open_ended',
  'rank_step_unreachable',
  'rank_duplicate_step',
  // References and text
  'ruleset_not_found',
  'module_duplicate',
  'ltext_untranslated',
  // Expressions
  'expr_shape',
  'expr_depth',
  'expr_nodes',
  'expr_steps',
  'expr_type_mismatch',
  'expr_unknown_ref',
  'expr_ref_type',
  'expr_unknown_relation',
  'expr_unknown_collection',
  'expr_unknown_field',
  'expr_arity',
  'expr_number_range',
  'expr_string_length',
  'expr_result_type',
  'expr_item_scope',
  'expr_nested_aggregate',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export type Severity = 'error' | 'warning' | 'info';

/** Flat, JSON-safe params. Stage-ish params are keys. */
export type DiagParams = Readonly<Record<string, string | number | boolean>>;

export const FIX_IDS = [
  'use_lower_odd',
  'use_higher_odd',
  'remove_draw',
  'remove_forfeit',
  'set_two_players',
  'remove_rank_step',
  'add_coin_flip',
  'add_wildcard',
  'remove_override',
  'move_decision_match_last',
  'add_points_step',
  'clear_rank',
  'reduce_groups',
  'set_swiss_rounds_auto',
  'use_season_ruleset',
  'use_edges_source',
] as const;

export type FixId = (typeof FIX_IDS)[number];

/** A suggested edit: an id (the label comes from the catalog), label params and the JSON patch that applies it. */
export interface Fix {
  readonly id: FixId;
  readonly params: DiagParams;
  readonly patch: readonly PatchOp[];
}

export interface Diagnostic {
  readonly severity: Severity;
  readonly code: DiagnosticCode;
  readonly params: DiagParams;
  readonly json_pointer: string;
  readonly fixes: readonly Fix[];
}

const ERROR_CODES: readonly DiagnosticCode[] = [
  'schema_required',
  'schema_type',
  'schema_enum',
  'schema_range',
  'schema_length',
  'schema_pattern',
  'schema_unknown_key',
  'schema_limit',
  'schema_refine',
  'schema_not_available_yet',
  'key_duplicate',
  'ref_unknown_stage',
  'stage_cycle',
  'stage_unreachable',
  'stage_too_few_participants',
  'groups_too_many',
  'advance_exceeds_source',
  'advance_per_group_without_groups',
  'series_even_best_of',
  'series_override_duplicate',
  'draws_unsupported',
  'forfeits_unsupported',
  'players_per_match_unsupported',
  'rank_chain_empty',
  'metric_unproduced',
  'rank_decision_match_position',
  'ruleset_not_found',
  'module_duplicate',
  'expr_shape',
  'expr_depth',
  'expr_nodes',
  'expr_steps',
  'expr_type_mismatch',
  'expr_unknown_ref',
  'expr_ref_type',
  'expr_unknown_relation',
  'expr_unknown_collection',
  'expr_unknown_field',
  'expr_arity',
  'expr_number_range',
  'expr_string_length',
  'expr_result_type',
  'expr_item_scope',
  'expr_nested_aggregate',
];

const INFO_CODES: readonly DiagnosticCode[] = [
  'participant_count_unknown',
  'groups_uneven',
  'rank_ignored_for_bracket',
  'ltext_untranslated',
];

function severityTable(): ReadonlyMap<DiagnosticCode, Severity> {
  const errors = new Set<DiagnosticCode>(ERROR_CODES);
  const infos = new Set<DiagnosticCode>(INFO_CODES);
  const table = new Map<DiagnosticCode, Severity>();
  for (const code of DIAGNOSTIC_CODES) {
    table.set(code, errors.has(code) ? 'error' : infos.has(code) ? 'info' : 'warning');
  }
  return table;
}

/** Default severity per code. Every other code is a warning. */
export const DIAGNOSTIC_SEVERITY: ReadonlyMap<DiagnosticCode, Severity> = severityTable();

const DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_CODES);

export function isDiagnosticCode(value: string): value is DiagnosticCode {
  return DIAGNOSTIC_CODE_SET.has(value);
}

export function diag(
  code: DiagnosticCode,
  pointer: string,
  params: DiagParams = {},
  fixes: readonly Fix[] = [],
): Diagnostic {
  return { severity: DIAGNOSTIC_SEVERITY.get(code) ?? 'warning', code, params, json_pointer: pointer, fixes };
}

/** Builds an RFC 6901 pointer from raw segments (escaped here, never by the caller). */
export function ptr(...segments: readonly (string | number)[]): string {
  let out = '';
  for (const segment of segments) out += `/${escapePointerSegment(String(segment))}`;
  return out;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Severity (error, warning, info), then pointer, then code: a total, locale-free order. */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    compareStrings(a.json_pointer, b.json_pointer) ||
    compareStrings(a.code, b.code)
  );
}

export function sortDiagnostics(list: readonly Diagnostic[]): Diagnostic[] {
  return [...list].sort(compareDiagnostics);
}
