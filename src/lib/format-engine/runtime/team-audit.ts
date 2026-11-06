/**
 * The post-match audit of the teams a match was played with: what is checked, and the `team_audit` check a side
 * opens. Team constraints of a kit stage are advisory while a team is built and saved (nothing refuses a team); this is
 * where a played team that breaks them reaches an admin. Like the pairing check (`pairing-checks.ts`) it needs no
 * `check.assisted` rule in the format: it belongs to the team constraints themselves.
 *
 * Only the stage's team CONSTRAINTS are audited (not the phase ruleset), on the team the match was played with, and the
 * species the replay shows are cross-checked against the registered team (items, Tera type and moves cannot be observed
 * per Pokémon). The subject holds codes, params, ids and counts, never English prose, and is admin-only data. It is not
 * for every admin: a planned team stays hidden after the match (`team_visibility`: its owner and site admins read it), so
 * `toCheckView` leaves the species params, `off_team` and `team_id` out of a `team_source: 'planned'` subject for any
 * other reader, a league admin included. The stored subject is complete; only the views redact.
 *
 * Key: `team_audit:<match id>:<completion generation>:<player id>`. Pure (no I/O), but NOT client-safe: it imports
 * `@pkmn/dex` for `observedOffTeam`. Client code may only `import type` from here (see `check-subject.ts`, which keeps
 * its own copy of the reason and cause lists); the reads and writes are in `team-audit-server.ts`.
 */
import { Dex } from '@pkmn/dex';
import type { Json } from '@/types/database';
import { toID } from '@/lib/pkmn/i18n/id';
import { replaySpeciesEntityKey, stripHiddenPreviewSuffix } from '@/lib/pkmn/replay-species';
import type { KitPhaseInfo } from './load';
import type { ConstraintIssue, TeamMember } from './team';
import type { KitRuntimeState } from './types';

/** The rule id the check carries: the audit has no rule of its own in the format. */
export const TEAM_AUDIT_RULE_ID = 'team.audit';

export type TeamAuditReason = 'rules' | 'observed_mismatch' | 'no_registered_team' | 'audit_unavailable';
export type TeamAuditCause = 'ruleset_missing' | 'team_rows_duplicate' | 'read_failed';

/** At most this many issues ride in a subject, and each param string is cut to `MAX_PARAM_CHARS`. */
export const MAX_AUDIT_ISSUES = 12;
const MAX_PARAM_CHARS = 80;

export interface TeamAuditCheck {
  source: 'team_audit';
  rule_id: string;
  dedupe_key: string;
  subject: Json;
}

/** What the audit found out about one player of the match. */
export interface TeamAuditSide {
  playerId: string;
  teamId: string | null;
  /** The match-linked row, the player's planned row, or no team at all. */
  teamSource: 'match' | 'planned' | 'none';
  teamUpdatedAt: string | null;
  /** The team row changed after the first replay of the match was submitted. Evidence only, never a trigger. */
  editedAfterPlay: boolean;
  /** Every constraint issue of the registered team (the planner drops `kit_constraint_expr`). */
  violations: readonly ConstraintIssue[];
  /** Species the replay shows that the registered team does not hold. */
  offTeam: readonly string[];
  /** The player brought at least one Pokémon in the match's replays. */
  observedAny: boolean;
  /** A live `deadline_missed` check of the `team` policy exists for the match: that policy owns "no team by the deadline". */
  deadlineCheckOpen: boolean;
  /** Set when the side could not be audited. */
  cause: TeamAuditCause | null;
}

export interface TeamAuditPlanInput {
  stage: string;
  phaseId: string;
  matchId: string;
  generation: number;
  /** `<match id>` for the first completion, `<match id>:<n>` after (the `match_completed` event's id). */
  completionRef: string;
  round: number;
  evaluatedAt: string;
  sides: readonly TeamAuditSide[];
}

/** Whether a phase's matches are audited: its stage has team constraints (a domain or resource alone is no team rule). */
export function auditsTeams(phase: Pick<KitPhaseInfo, 'stage'>): boolean {
  return (phase.stage.constraints?.length ?? 0) > 0;
}

/** The issues that count as a rule break: a league expression that could not be evaluated is the league's problem. */
export function auditViolations(issues: readonly ConstraintIssue[]): ConstraintIssue[] {
  return issues.filter((issue) => issue.code !== 'kit_constraint_expr');
}

/**
 * The state before the completion `completionRef` applied its effects: the items that completion's `match_completed`
 * rules granted (`source_ref` `<rule>:match_completed:<completionRef>`) are dropped, so a heal run, which loads the state
 * after that event fired, agrees with the first run. Flags, attributes and the grants of later events are not rewound.
 */
export function stateBeforeCompletion(state: KitRuntimeState, completionRef: string): KitRuntimeState {
  const suffix = `:match_completed:${completionRef}`;
  const items = state.items.filter((item) => item.source_ref === null || !item.source_ref.endsWith(suffix));
  return items.length === state.items.length ? state : { ...state, items };
}

/** The ids of the species an observed forme turns out of in battle (`battleOnly`, `changesFrom`), up to a few steps. */
function battleOrigins(species: ReturnType<typeof Dex.species.get>): Set<string> {
  const origins = new Set<string>();
  let frontier = [species];
  for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
    const next: (typeof species)[] = [];
    for (const current of frontier) {
      const names = [...(Array.isArray(current.battleOnly) ? current.battleOnly : current.battleOnly ? [current.battleOnly] : []), ...(current.changesFrom ? [current.changesFrom] : [])];
      for (const name of names) {
        const id = toID(name);
        if (origins.has(id)) continue;
        origins.add(id);
        const origin = Dex.species.get(name);
        if (origin.exists) next.push(origin);
      }
    }
    frontier = next;
  }
  return origins;
}

/**
 * The species a replay shows that no registered member covers. The replay name is matched against each member's own
 * species first (Rotom-Heat is NOT covered by a registered Rotom-Frost or Rotom-Wash: they are different Pokémon of one
 * dex base species, and a format's pools may split them). Four things count as covered:
 * - the same species;
 * - a forme that the registered species turns into in battle (`battleOnly` / `changesFrom`: Mimikyu-Busted, Greninja-Ash);
 * - a forme of a registered base-forme Pokémon (Ogerpon-Wellspring, Zacian-Crowned, Arceus-Fire: items pick those formes);
 * - the bare base species name, when a member of that base is registered (a hidden team preview shows "Arceus-*", so the
 *   forme is unknown).
 * A name the dex cannot resolve is skipped, not flagged. Names come back without the hidden-preview suffix, once each.
 */
export function observedOffTeam(observed: readonly string[], members: readonly TeamMember[]): string[] {
  const out: string[] = [];
  for (const raw of observed) {
    const name = stripHiddenPreviewSuffix(raw);
    if (name === '' || out.includes(name)) continue;
    const species = Dex.species.get(name);
    if (!species.exists) continue;
    const id = toID(species.name);
    const baseId = toID(replaySpeciesEntityKey(name));
    const bare = id === baseId;
    const origins = battleOrigins(species);
    const covered = members.some((member) => {
      if (member.species === '') return false;
      if (member.species === id || origins.has(member.species)) return true;
      if (member.baseSpecies !== baseId) return false;
      return bare || member.species === member.baseSpecies;
    });
    if (!covered) out.push(name);
  }
  return out;
}

const cut = (value: string): string => (value.length > MAX_PARAM_CHARS ? value.slice(0, MAX_PARAM_CHARS) : value);

function issueSubject(issue: ConstraintIssue): Json {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(issue.params)) params[key] = typeof value === 'string' ? cut(value) : value;
  return { code: issue.code, params, pokemon_indexes: issue.pokemon_indexes ?? [] };
}

const byConstraint = (a: ConstraintIssue, b: ConstraintIssue): number =>
  a.constraint_index - b.constraint_index || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

function reasonsOf(side: TeamAuditSide, violations: readonly ConstraintIssue[]): TeamAuditReason[] {
  if (side.cause !== null) return ['audit_unavailable'];
  const reasons: TeamAuditReason[] = [];
  if (violations.length > 0) reasons.push('rules');
  if (side.offTeam.length > 0) reasons.push('observed_mismatch');
  if (side.teamSource === 'none' && side.observedAny && !side.deadlineCheckOpen) reasons.push('no_registered_team');
  return reasons;
}

/** The checks the sides of a completed match open: one per side with a reason, none for a clean side. */
export function planTeamAuditChecks(input: TeamAuditPlanInput): TeamAuditCheck[] {
  const checks: TeamAuditCheck[] = [];
  for (const side of input.sides) {
    const violations = side.cause === null ? auditViolations(side.violations).sort(byConstraint).slice(0, MAX_AUDIT_ISSUES) : [];
    const reasons = reasonsOf(side, violations);
    if (reasons.length === 0) continue;
    checks.push({
      source: 'team_audit',
      rule_id: TEAM_AUDIT_RULE_ID,
      dedupe_key: `team_audit:${input.matchId}:${input.generation}:${side.playerId}`,
      subject: {
        stage: input.stage,
        phase_id: input.phaseId,
        match_id: input.matchId,
        round: input.round,
        completion_ref: input.completionRef,
        evaluated_at: input.evaluatedAt,
        player_id: side.playerId,
        team_id: side.teamId,
        team_source: side.teamSource,
        team_updated_at: side.teamUpdatedAt,
        edited_after_play: side.editedAfterPlay,
        reasons,
        issues: violations.map(issueSubject),
        off_team: side.offTeam.map(cut),
        cause: side.cause,
      },
    });
  }
  return checks;
}
