/**
 * The format definition document, as hand-written zod-free types. These are the single source of
 * truth for TypeScript: `schema/index.ts` proves the zod schema's output equals them (a compile-time
 * assertion), so drift fails `tsc`.
 *
 * Defaults: a field documented "default X" may be omitted in the INPUT; the validated value always
 * has it. Collections are arrays with key fields, never records, so a user-chosen key such as
 * `constructor` is ordinary data (lookups go through `Map`, see `keys.ts`).
 */
import type { Locale } from '@/i18n/config';
import type { Expr } from './expr/ast';
import type { Key, Slug } from './keys';

export type { Locale };

export type LTextStatus = 'human' | 'machine' | 'reviewed';

/** One language of a text: 1..4000 chars, no NUL. */
export interface LTextValue {
  v: string;
  s: LTextStatus;
}

/** A bilingual text. `text[base]` must exist; `base` is the language the author wrote in. */
export interface LText {
  en?: LTextValue;
  de?: LTextValue;
  base: Locale;
}

export interface FormatDefinition {
  schema_version: 1;
  identity: { name: LText; summary?: LText; based_on?: Slug };
  /** 1..50 */
  stages: Stage[];
  /** 0..100, default [] */
  edges: Edge[];
  /** 0..8, default [] */
  views: CrossStageView[];
  /** 0..200, default [] */
  rules: RuleCard[];
  /** default { sections: [] } */
  text: { sections: TextSection[] };
  /** default { world: 'auto' } */
  theme: { world: 'auto' | Key };
  /** 0..3, default [] */
  modules: LegacyModule[];
}

export interface Stage {
  key: Key;
  name: LText;
  participants: ParticipantsSelector;
  groups?: GroupsSpec;
  pairing: Pairing;
  series: Series;
  /** default { kind: 'season_default' } */
  ruleset: RulesetRef;
  /** default false */
  doubles: boolean;
  /** int 2..8, default 2 */
  players_per_match: number;
  scoring: Scoring;
  /** 0..12, default [] */
  rank: RankStep[];
  /** 0..12 builtin metric keys, default [] */
  columns: Key[];
}

export type ParticipantsSelector =
  | { from: 'roster'; seeding: 'rating' | 'random' | 'manual' | 'signup'; expected_count?: number }
  | { from: 'edges'; seeding: 'edge_order' | 'rating' | 'random' | 'manual' };

export interface GroupsSpec {
  /** int 2..26 */
  count: number;
  /** default 'serpentine' */
  method: 'serpentine' | 'straight' | 'random_seeded' | 'manual';
}

export type Pairing =
  | { kind: 'round_robin'; legs: number; mirror_legs: boolean }
  | { kind: 'swiss'; rounds: number | 'auto'; avoid_repeats: boolean }
  | { kind: 'single_elim'; third_place: boolean }
  | { kind: 'double_elim'; bracket_reset: boolean }
  | { kind: 'manual' };

export interface Series {
  /** int 1..15. An even number is representable; the compiler rejects it. */
  best_of: number;
  /** default false */
  allow_draw: boolean;
  /** 0..32, default [] */
  overrides: SeriesOverride[];
}

export interface SeriesOverride {
  /** int 1..64 */
  round: number;
  /** default 'start' */
  from: 'start' | 'end';
  /** int 1..15 */
  best_of: number;
}

/**
 * Which ruleset a stage's teams follow: the league's, a stored ruleset by id, or a Showdown format of the catalog
 * (`format` is its id such as `gen9ou`). A Showdown format only pre-picks settings; attaching the format to a
 * league turns it into a normal, editable ruleset row. An id the catalog does not know is a compile error, not a
 * schema error, so a stored document stays loadable.
 */
export type RulesetRef = { kind: 'season_default' } | { kind: 'ruleset'; id: string } | { kind: 'showdown'; format: Key };

export interface Scoring {
  win: number;
  /** default 0 */
  loss: number;
  /** default 0 */
  bye: number;
  /** representable, gated by the compiler */
  draw?: number;
  /** representable, gated by the compiler */
  forfeit?: number;
}

export type BuiltinMetric =
  | 'points'
  | 'wins'
  | 'losses'
  | 'games_played'
  | 'kill_differential'
  | 'buchholz'
  | 'seed'
  | 'rating';

export type RankStep =
  | { kind: 'metric'; metric: Key; direction: 'desc' | 'asc' }
  | { kind: 'head_to_head'; scope: 'pairwise' | 'mini_table' }
  | { kind: 'coin_flip' }
  | { kind: 'decision_match' }
  | { kind: 'manual' };

export interface Edge {
  key: Key;
  from: Key;
  to: Key;
  /** 1..4 */
  select: AdvanceSelect[];
  /** default 'rank' */
  seeding: 'rank' | 'cross_group' | 'random' | 'manual';
  /** default 'admin_confirm' */
  gate: 'admin_confirm' | 'auto';
}

export type AdvanceSelect =
  | { kind: 'top_n'; n: number }
  | { kind: 'per_group'; n: number }
  | { kind: 'wildcard'; n: number }
  | { kind: 'threshold'; when: Expr }
  | { kind: 'bottom_n'; n: number }
  | { kind: 'manual_list'; count?: number };

export interface CrossStageView {
  key: Key;
  label: LText;
  /** 2..50 */
  stages: Key[];
  metric: Key;
  combine: 'sum';
}

export interface RuleCard {
  kind: 'rule.custom';
  id: Key;
  text: LText;
  /** default { kind: 'season' } */
  scope: { kind: 'season' } | { kind: 'stage'; stage: Key };
  /** default 'admin_checklist' */
  verify: 'admin_checklist' | 'player_attest' | 'none';
  /** default 'once' */
  when: 'once' | 'per_match' | 'per_matchday';
  /** default true */
  visible_to_players: boolean;
  /** Set when the card was an unknown rule kind kept as a manual rule. */
  degraded_from?: string;
}

export interface TextSection {
  id: Key;
  title: LText;
  body: LText;
  stage?: Key;
}

export interface LegacyModule {
  kind: 'module.legacy';
  adapter: 'epb' | 'legacy_draft' | 'core_liga';
  /** 0..64, default [] */
  facts: LegacyFact[];
}

export interface LegacyFact {
  key: Key;
  label: LText;
  value: string | number | boolean;
}
