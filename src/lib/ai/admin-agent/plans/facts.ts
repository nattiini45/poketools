/**
 * The facts `planReadiness` needs from outside the Plan. They are plain data: the caller (the plan tools, the staging
 * code) loads them with the guarded readers and passes them in, so readiness stays pure and testable.
 *
 * Fail closed: a fact the Plan needs but the caller did not supply is the blocker `fact_unavailable`, never a silent
 * pass. `planFactNeeds(plan)` lists exactly what to load for a given Plan.
 */
import type { PlanEngineSupport } from './engine-support';
import {
  RULESET_DELTA_CATEGORIES,
  type PlanDocument,
  type PlanRulesetRef,
  type RulesetDeltaCategory,
} from './schema';

/** What `assertRulesetUsable` answered for a ruleset VERSION id and the live admin. */
export type RulesetVersionFact = 'usable' | 'not_found' | 'forbidden';

/** A ruleset DEFINITION the live admin may read (a draft to publish, or a fork source). */
export interface RulesetDefinitionFact {
  state: 'ok' | 'not_found' | 'forbidden';
  /** Error-severity diagnostics of the draft's current compile (they block publish, 422 `ruleset_document_invalid`). */
  diagnosticsErrors?: number;
}

export interface RulesetPresetFact {
  known: boolean;
  /** The preset has Smogon tour extras, so "add tour bans" is a question for the admin. */
  hasTourOverlay?: boolean;
}

/** What the dex says about one id of a delta. */
export type DexFact = 'ok' | 'unknown' | 'forme_expansion_needed';

export type PlayerFact =
  /** `name` is the stored display name, for card lines only (never an input of a check). */
  | { status: 'ok'; isGuest?: boolean; name?: string }
  | { status: 'not_found' }
  | { status: 'banned' | 'suspended' | 'test' };

export interface FormatFact {
  state: 'ok' | 'not_found' | 'forbidden';
  /** The most round-robin legs any stage of the version asks for (`classic-league` asks for 2). */
  maxRoundRobinLegs?: number;
}

/** Whether a built entity named in `plan.refs` still answers. */
export type RefFact = 'live' | 'gone' | 'in_trash' | 'no_access';

export interface PlanFacts {
  /** Overrides `PLAN_ENGINE_SUPPORT` (for example once a double-round-robin engine PR is scheduled). */
  engine?: Partial<PlanEngineSupport>;
  /** By ruleset version id (lower-case). */
  rulesetVersions?: Record<string, RulesetVersionFact>;
  /** By ruleset definition id (lower-case). */
  rulesetDefinitions?: Record<string, RulesetDefinitionFact>;
  /** By catalog preset id. */
  rulesetPresets?: Record<string, RulesetPresetFact>;
  /** The live admin's owned-ruleset count against the cap; needed whenever the Plan will create a ruleset draft. */
  rulesetQuota?: { owned: number; max: number };
  /** By `"<category>:<id>"` (see `dexFactKey`). */
  dex?: Record<string, DexFact>;
  /** By player id (lower-case). */
  players?: Record<string, PlayerFact>;
  /** Players already on the league's roster (amend plans). */
  enrolledPlayerIds?: readonly string[];
  /** Players already on the roster of a league that this Plan does not build (amend plans, clones). */
  liveRosterCount?: number;
  /** By format definition id (lower-case). */
  formats?: Record<string, FormatFact>;
  /** `bo_overrides` keys that are not real round names, by phase key (or `tournament`). */
  unknownBoOverrideKeys?: Record<string, readonly string[]>;
  /** Another league already has this name (the clash is a warning, never a blocker). */
  leagueNameInUse?: boolean;
  /** An Evolution Point Buy league needs an active point-buy list to bind. */
  epbActiveListAvailable?: boolean;
  /** By `plan.refs` key. */
  refs?: Record<string, RefFact>;
  /** The status of the standalone tournament this Plan built earlier, when its roster is still to be added. */
  tournamentStatus?: string;
}

export const dexFactKey = (category: RulesetDeltaCategory, id: string): string => `${category}:${id}`;

export interface PlanFactNeeds {
  rulesetVersionIds: string[];
  rulesetDefinitionIds: string[];
  presetIds: string[];
  dex: Array<{ category: RulesetDeltaCategory; id: string }>;
  playerIds: string[];
  formatDefinitionIds: string[];
  /** Phases (and the tournament) whose `bo_overrides` need the round-name check. */
  boOverrideChecks: Array<{ key: string; bracketType: string; overrideKeys: string[] }>;
  needsRulesetQuota: boolean;
  needsEpbListFact: boolean;
  refKeys: string[];
}

const lower = (id: string): string => id.toLowerCase();

function addRulesetRef(into: Set<string>, ref: PlanRulesetRef): void {
  if (ref !== 'plan') into.add(lower(ref.id));
}

/** Everything `planReadiness` will look up for this Plan, deduplicated and in a stable order. */
export function planFactNeeds(plan: PlanDocument): PlanFactNeeds {
  const versions = new Set<string>();
  const definitions = new Set<string>();
  const presets = new Set<string>();
  const dex = new Map<string, { category: RulesetDeltaCategory; id: string }>();
  const players = new Set<string>();
  const formats = new Set<string>();
  const boOverrideChecks: PlanFactNeeds['boOverrideChecks'] = [];
  let needsRulesetQuota = false;

  const { ruleset, format, phases, roster, tournament, league, draft } = plan.slots;

  if (ruleset?.mode === 'existing') versions.add(lower(ruleset.version_id));
  if (ruleset?.mode === 'draft') definitions.add(lower(ruleset.definition_id));
  if (ruleset?.mode === 'fork') definitions.add(lower(ruleset.from_definition_id));
  if (ruleset?.mode === 'new' || ruleset?.mode === 'fork') {
    needsRulesetQuota = true;
    if (ruleset.mode === 'new' && ruleset.preset !== undefined) presets.add(ruleset.preset);
    for (const category of RULESET_DELTA_CATEGORIES) {
      const delta = ruleset.delta[category];
      for (const id of [...delta.ban, ...delta.unban, ...(delta.allow ?? [])]) dex.set(dexFactKey(category, id), { category, id });
    }
  }
  if (format && format.mode !== 'none') formats.add(lower(format.definition_id));

  for (const phase of phases ?? []) {
    addRulesetRef(versions, phase.ruleset);
    const overrideKeys = Object.keys(phase.bo_overrides ?? {});
    if (overrideKeys.length > 0) boOverrideChecks.push({ key: phase.key, bracketType: phase.bracket_type, overrideKeys });
  }
  if (tournament) {
    addRulesetRef(versions, tournament.ruleset);
    const overrideKeys = Object.keys(tournament.bo_overrides ?? {});
    if (overrideKeys.length > 0) boOverrideChecks.push({ key: 'tournament', bracketType: tournament.bracket_type, overrideKeys });
  }
  for (const entry of roster?.entries ?? []) if (entry.state === 'resolved') players.add(lower(entry.player_id));

  const needsEpbListFact =
    league?.format_type === 'evolution_point_buy' && (draft ?? []).some((entry) => entry.engine === 'queue');

  return {
    rulesetVersionIds: [...versions].sort(),
    rulesetDefinitionIds: [...definitions].sort(),
    presetIds: [...presets].sort(),
    dex: [...dex.values()].sort((a, b) => dexFactKey(a.category, a.id).localeCompare(dexFactKey(b.category, b.id))),
    playerIds: [...players].sort(),
    formatDefinitionIds: [...formats].sort(),
    boOverrideChecks,
    needsRulesetQuota,
    needsEpbListFact,
    refKeys: Object.keys(plan.refs).sort(),
  };
}
