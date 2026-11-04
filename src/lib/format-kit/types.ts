/**
 * The format definition document, as hand-written zod-free types. These are the single source of
 * truth for TypeScript: `schema/index.ts` proves the zod schema's output equals them (a compile-time
 * assertion), so drift fails `tsc`.
 *
 * Defaults: a field documented "default X" may be omitted in the INPUT; the validated value always
 * has it. Collections are arrays with key fields, never records, so a user-chosen key such as
 * `constructor` is ordinary data (lookups go through `Map`, see `keys.ts`).
 */
import type { Expr } from './expr/ast';
import type { Key, Slug } from '@/lib/studio-core/keys';
import type { LText, LTextStatus, LTextValue } from '@/lib/studio-core/ltext';

// The bilingual text types live with the text helpers in the shared studio core (`@/lib/studio-core/ltext`, the one import
// path for them and for the helpers). `LText` is part of the format document schema (every name, summary, label and
// text section below is one), so the kit's public types surface keeps the type-only re-export; the values are not re-exported.
export type { LText, LTextStatus, LTextValue };

export interface FormatDefinition {
  schema_version: 1;
  identity: { name: LText; summary?: LText; based_on?: Slug };
  /** 1..50 */
  stages: Stage[];
  /** 0..100, default [] */
  edges: Edge[];
  /** 0..8, default [] */
  views: CrossStageView[];
  /** 0..200, default []. Rule ids are unique across all rule kinds. */
  rules: RuleEntry[];
  /** default { sections: [] } */
  text: { sections: TextSection[] };
  /** default { world: 'auto' } */
  theme: { world: 'auto' | Key };
  /** 0..3, default [] */
  modules: LegacyModule[];
  /**
   * Phase 3 sections, all optional with no default so a document without them keeps its content hash.
   * 0..32 (attr.define; attr.assign is the `assign` of a player attribute)
   */
  attributes?: AttributeDef[];
  /** 0..16 (domain.define) */
  domains?: DomainDef[];
  /** 0..8 (relation.define) */
  relations?: RelationDef[];
  /** 0..16 (resource.define) */
  resources?: ResourceDef[];
  /** 0..32 (metric.define | track.progression | score.placement) */
  metrics?: MetricEntry[];
  /** 0..32 */
  tunables?: TunableDef[];
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
 * Which ruleset a stage's teams follow: the league's, a stored ruleset by id, or a rule preset of the catalog
 * (`preset` is its id such as `gen9ou` or `gen9natdexdraft`: a Showdown ladder format or a Smogon draft format).
 * A preset only pre-picks settings; attaching the format to a league turns it into a normal, editable ruleset owned
 * by the league. An id the catalog does not know is a compile error, not a schema error, so a stored document stays
 * loadable.
 */
export type RulesetRef = { kind: 'season_default' } | { kind: 'ruleset'; id: string } | { kind: 'preset'; preset: Key };

export interface Scoring {
  win: number;
  /** default 0 */
  loss: number;
  /** default 0 */
  bye: number;
  /** representable, gated by the compiler */
  draw?: number;
  /**
   * Gated by the compiler (`env.matchModel.forfeits`). A number is the older shorthand: the winner of a forfeit or
   * no-show gets it and the loser the stage's `loss`, with no faint bonus.
   */
  forfeit?: number | ForfeitScoring;
  /**
   * Points per fainted Pokémon of the opponent in a played match (`match_outcomes` faint tally). Absent means 0; the
   * field is optional rather than defaulted so documents stored before it keep their hash.
   */
  per_opponent_faint?: number;
}

/** Points of a match settled by forfeit or no-show. */
export interface ForfeitScoring {
  win: number;
  /** default 0 */
  loss: number;
  /** default false. Whether the faint bonus applies on top; a forfeit has no faint tally, so it adds nothing yet. */
  faint_bonus: boolean;
}

export type BuiltinMetric =
  | 'points'
  | 'wins'
  | 'losses'
  | 'games_played'
  | 'kill_differential'
  | 'buchholz'
  | 'seed'
  | 'rating'
  | 'faints_dealt'
  | 'faints_taken';

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

// --- Phase 3: attributes, domains, relations, resources, metrics, tunables ------------------------

export interface AttributeDef {
  key: Key;
  label: LText;
  on: 'player' | 'entry';
  type: 'enum' | 'number' | 'text' | 'bool';
  /** 1..32 keys; enum only (the compiler requires it exactly for enums). */
  values?: Key[];
  /** Entry enum only: the value is a list (e.g. secondary roles). Not usable in expressions. */
  multi?: boolean;
  /** Player attributes only (the compiler rejects it on an entry attribute). */
  assign?: AttrAssign;
}

export type AttrAssign = { kind: 'manual' } | { kind: 'random_seeded' } | { kind: 'expr'; expr: Expr };

export interface DomainDef {
  key: Key;
  label: LText;
  /** 1..512 */
  entries: DomainEntry[];
  /** default 'unlocked' */
  initially: 'locked' | 'unlocked';
  /** default 'public' */
  visibility: 'public' | 'when_unlocked' | 'admins';
}

export interface DomainEntry {
  /** A @pkmn species id such as vivillonicysnow. */
  id: Key;
  /** 0..16, default [] */
  attrs: EntryAttr[];
}

export interface EntryAttr {
  key: Key;
  /** A list (1..8 keys) only for a multi attribute. */
  value: string | number | boolean | string[];
}

/**
 * A link runs from -> to (santa: giver -> recipient). `to` says who sees the TARGET of a link (own: the from player
 * sees whom they give to); `from` says who sees the SOURCE (hidden: only admins; own: the to player sees their
 * giver; all: everyone). Once `reveal_on` fired both sides are 'all'. A hidden side is never serialised to others.
 */
export interface RelationDef {
  key: Key;
  label: LText;
  shape: 'derangement' | 'pairs' | 'manual';
  /** default { from: 'hidden', to: 'own' } */
  visibility: { from: RelationVisibility; to: RelationVisibility };
  reveal_on?: EventSpec;
}

export type RelationVisibility = 'hidden' | 'own' | 'all';

export interface ResourceDef {
  key: Key;
  label: LText;
  holds: { kind: 'domain'; domain: Key } | { kind: 'counter' };
  /** int 1..64 */
  capacity?: number;
  /** default 'own' */
  visibility: 'own' | 'all';
  /** default 'none'; 'global' needs a domain-holding resource (compile) */
  exclusive: 'none' | 'global';
}

export type MetricEntry =
  | { kind: 'metric.define'; key: Key; label: LText; of: 'player' | 'match'; expr: Expr }
  | {
      kind: 'track.progression';
      key: Key;
      label: LText;
      stage?: Key;
      /** 1..16 */
      steps: { label: LText; when: Expr }[];
    }
  | {
      kind: 'score.placement';
      key: Key;
      label: LText;
      stage: Key;
      /** 1..64 points by final place, each |x| <= SCORE_ABS_MAX */
      points: number[];
    };

export interface TunableDef {
  key: Key;
  label: LText;
  type: 'number' | 'bool' | 'enum' | 'table';
  /** A number[] (1..64) only for a table; a Key for an enum. */
  default: number | boolean | string | number[];
  /** number only */
  min?: number;
  max?: number;
  /** enum only, 1..32 */
  values?: Key[];
  /** default 'start' */
  editable_until: 'start' | 'lock' | 'always';
  /** default 'experimental' */
  status: 'experimental' | 'approved';
}

// --- Phase 3: events, effects, actions, checks, adjustments (the open `rules` list) --------------

export type EventSpec =
  | { event: 'stage_start'; stage?: Key }
  | { event: 'round_start'; stage?: Key; /** int 1..64 */ round?: number }
  | { event: 'round_end'; stage?: Key; round?: number }
  | { event: 'match_completed'; stage?: Key }
  | { event: 'action_locked'; action: Key }
  | { event: 'stage_end'; stage?: Key }
  /** Marks come from the calendar in Phase 4; until then admins fire them. */
  | { event: 'time'; mark: Key };

export interface EffectTarget {
  who: 'all' | 'event_players';
  /** boolean, player env */
  where?: Expr;
}

export type Effect =
  | { effect: 'unlock_domain'; domain: Key }
  | { effect: 'lock_domain'; domain: Key }
  | { effect: 'reveal_relation'; relation: Key }
  | { effect: 'generate_relation'; relation: Key }
  | { effect: 'grant_resource'; resource: Key; to: EffectTarget; /** int 1..64, default 1 */ amount: number; item?: Key }
  | { effect: 'revoke_resource'; resource: Key; to: EffectTarget; amount: number; item?: Key }
  | { effect: 'adjust_points'; stage: Key; to: EffectTarget; /** |x| <= SCORE_ABS_MAX */ points: number }
  | { effect: 'set_attr'; attr: Key; to: EffectTarget; value: string | number | boolean }
  | { effect: 'open_action'; action: Key }
  | { effect: 'lock_action'; action: Key }
  | { effect: 'notify'; message: LText; to: EffectTarget };

export interface OnEventRule {
  kind: 'rule.on_event';
  id: Key;
  on: EventSpec;
  /** boolean, event env */
  when?: Expr;
  /** 1..16 */
  effects: Effect[];
}

export interface PlayerActionRule {
  kind: 'player.action';
  id: Key;
  label: LText;
  /** A relation: the actor is its from side, the target its to side. Absent: a player acts for themself. */
  via?: Key;
  /** default {}; an admin can always open or lock by hand */
  window: { opens_on?: EventSpec; closes_on?: EventSpec };
  /** 1..8, picked in order */
  steps: ActionStep[];
  /** default true */
  review: boolean;
  /** default 'on_submit' */
  lock: 'on_submit' | 'on_close';
}

export interface ActionStep {
  resource: Key;
  domain: Key;
  /** int 1..16 */
  count: number;
  /** boolean, entry env */
  where?: Expr;
  /** A non-multi entry attribute: the picks of this step must differ in it. */
  distinct_attr?: Key;
}

export interface CheckRule {
  kind: 'check.assisted';
  id: Key;
  label?: LText;
  source:
    | { kind: 'unresolved_outcome' }
    | { kind: 'standings_tie'; stage?: Key }
    | { kind: 'pairing_rematch'; stage?: Key }
    | { kind: 'expr'; of: 'player' | 'match'; when: Expr };
}

export type AdjustKind = 'points' | 'resource' | 'relation' | 'outcome' | 'action' | 'domain' | 'rank';

export interface AdjustRule {
  kind: 'adjust.manual';
  id: Key;
  /** 1..7, unique */
  allow: AdjustKind[];
}

/** An entry of the open `rules` list. */
export type RuleEntry = RuleCard | OnEventRule | PlayerActionRule | CheckRule | AdjustRule;
