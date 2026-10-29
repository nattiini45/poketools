/**
 * `deriveSteps(plan)`: the Build saga as data (plan 4.4). The model never writes the step list; this function does,
 * in the order decided by code:
 *
 *   league -> roster -> phases -> groups -> draft setup (-> a standalone tournament -> its roster, one player per step)
 *
 * Roster comes before the phases because the first phase enrolls the roster at creation; groups come after the phases
 * so the split seeds from the first phase; draft pools are created pending, one per group, and never started. Private
 * and harmless steps first, so the worst partial state is an empty league that can be archived. There is no G step in
 * here (publishing a ruleset is its own Go-live card before Build, and `auto_epb` is ensured by the league route
 * itself, so it is an effect of the league step and not a step of its own).
 *
 * Step keys are stable: the same slot always gets the same key (`league`, `roster.1`, `phase.<key>`, `groups`,
 * `draft.<A..Z|all>`, `tournament`), so a revision that adds a phase leaves the other keys alone and the ledger's
 * `(proposal_id, step_key)` uniqueness holds.
 *
 * A slot that already has an entry in `plan.refs` is built: it gets no step, and the live row wins (a drifted or
 * missing one is a readiness blocker, never a re-create). The function is total, but only meaningful for a Plan whose
 * `planReadiness` has no blockers (an unpublished ruleset leaves `ruleset_id` out of the body, for example).
 */
import type { JsonValue } from '@/lib/studio-core/json';
import { PLAN_OP_INFO, BUILD_LIMITS, type PlanEntityType, type PlanOp, type ReversalKind } from './ops';
import {
  ROSTER_CHUNK,
  leagueRulesetId,
  refTo,
  toDraftCreateBody,
  toGroupsBody,
  toLeagueCreateBody,
  toPhaseCreateBody,
  toRosterAddBody,
  toTournamentCreateBody,
  toTournamentParticipantAddBody,
  type PlanRefObject,
} from './route-bodies';
import { draftRefKey, phaseRefKey, type PlanDocument } from './schema';

export type PlanEffect =
  | { kind: 'visible_publicly'; entity: 'league' | 'tournament' | 'draft_pool' }
  | { kind: 'creator_becomes_admin' }
  /** The step pins a ruleset version: `plan` = the Plan's own slot, `explicit` = a version named directly. */
  | { kind: 'pins_ruleset'; source: 'plan' | 'explicit' | 'auto_epb'; versionId?: string }
  /** The league route may publish a new bans-free version of the shared Point Buy Battle ruleset. */
  | { kind: 'ensures_battle_ruleset' }
  | { kind: 'enrolls_roster' }
  /** A later phase is created pre-filled from the previous phase's standings (an all-tied table: an arbitrary top N). */
  | { kind: 'prefilled_from_standings'; previousPhaseKey: string; count?: number; perGroup?: boolean }
  | { kind: 'clones_from'; seasonId: string; copyRoster: boolean };

export interface PlanStepArgs {
  /** Path parameters; values may be `{ "$ref": ... }`. */
  path: Record<string, JsonValue>;
  query: Record<string, JsonValue>;
  /** The request body template, `$ref` placeholders unresolved. */
  body: JsonValue;
}

export interface PlanStep {
  key: string;
  op: PlanOp;
  /** Build steps are all class B (reversible live rows); a G step is never part of Build. */
  class: 'B';
  guard: 'requireAnyAdmin' | 'requireResourceAdmin';
  /** Floor for the live role at staging and again at approve; the resource guard of the route does the rest. */
  minRole: 'any';
  /** Step keys that must be `ok` first. */
  blockedBy: string[];
  entityType: PlanEntityType;
  /** Counts toward the cap on entity-creating steps. */
  creates: boolean;
  /**
   * The `plan.refs` key this step fills when it is `ok`; `null` for a step that fills none. A roster is added in chunks and
   * counts as built only when its LAST chunk is `ok`, so only that one carries `roster`: after a failure in chunk 2 the
   * roster stays unbuilt and a follow-up Build adds it again (players already enrolled are the route's to report).
   */
  refKey: string | null;
  args: PlanStepArgs;
  /** Names of the state reads whose hash guards the step (plan 4.5 "Preconditions"). */
  reads: string[];
  /** The read-back that must pass before the step is `ok`. */
  verify: string;
  reversal: ReversalKind;
  effects: PlanEffect[];
}

type Args = { path?: Record<string, JsonValue>; body: JsonValue };

function makeStep(
  key: string,
  op: PlanOp,
  refKey: string | null,
  args: Args,
  blockedBy: readonly string[],
  effects: PlanEffect[],
): PlanStep {
  const info = PLAN_OP_INFO[op];
  return {
    key,
    op,
    class: 'B',
    guard: info.guard,
    minRole: 'any',
    blockedBy: [...blockedBy],
    entityType: info.entityType,
    creates: info.creates,
    refKey,
    args: { path: args.path ?? {}, query: {}, body: args.body },
    reads: [...info.reads],
    verify: info.verify,
    reversal: info.reversal,
    effects,
  };
}

/** The resolved, de-duplicated player ids of the roster, in entry order. */
export function resolvedRosterIds(plan: PlanDocument): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of plan.slots.roster?.entries ?? []) {
    if (entry.state !== 'resolved') continue;
    const key = entry.player_id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(entry.player_id);
  }
  return ids;
}

export function deriveSteps(plan: PlanDocument): PlanStep[] {
  const { league, roster, phases, groups, draft, tournament, ruleset } = plan.slots;
  const built = (refKey: string): boolean => plan.refs[refKey] !== undefined;
  const steps: PlanStep[] = [];

  // The league id every later step addresses: the live id when built earlier, else a reference to the league step.
  const builtLeague = plan.refs.league;
  const leagueId: string | PlanRefObject = builtLeague ? builtLeague.entity_id : refTo('league.id');
  let leagueKey: string | null = null;
  let lastRosterKey: string | null = null;
  const phaseKeys: string[] = [];
  let groupsKey: string | null = null;

  const after = (...keys: Array<string | null>): string[] => keys.filter((key): key is string => key !== null);

  if (league && !built('league')) {
    const effects: PlanEffect[] = [{ kind: 'visible_publicly', entity: 'league' }, { kind: 'creator_becomes_admin' }];
    const pinned = leagueRulesetId(plan);
    if (pinned !== null) effects.push({ kind: 'pins_ruleset', source: 'plan', versionId: pinned });
    else if (league.format_type === 'evolution_point_buy') {
      // No explicit version: the route ensures the shared battle ruleset (reuse, or a new bans-free version) and pins the head.
      effects.push({ kind: 'pins_ruleset', source: 'auto_epb' }, { kind: 'ensures_battle_ruleset' });
    }
    if (league.clone_from) effects.push({ kind: 'clones_from', seasonId: league.clone_from.season_id, copyRoster: league.clone_from.copy_roster });
    const step = makeStep('league', 'league_create', 'league', { body: toLeagueCreateBody(plan, league) }, [], effects);
    // An EPB league that ensures the battle ruleset is also guarded by the head version it will pin.
    if (effects.some((effect) => effect.kind === 'ensures_battle_ruleset')) step.reads.push('epb_battle_ruleset_head');
    steps.push(step);
    leagueKey = step.key;
  }

  if (league && roster && !built('roster')) {
    const ids = resolvedRosterIds(plan);
    for (let offset = 0, chunk = 1; offset < ids.length; offset += ROSTER_CHUNK, chunk += 1) {
      const key = `roster.${chunk}`;
      const lastChunk = offset + ROSTER_CHUNK >= ids.length;
      steps.push(
        makeStep(
          key,
          'roster_add',
          lastChunk ? 'roster' : null,
          { path: { id: leagueId }, body: toRosterAddBody(ids.slice(offset, offset + ROSTER_CHUNK)) },
          after(leagueKey, lastRosterKey),
          [],
        ),
      );
      lastRosterKey = key;
    }
  }

  if (league && phases) {
    phases.forEach((phase, index) => {
      const refKey = phaseRefKey(phase.key);
      if (built(refKey)) return;
      const previous = phases[index - 1];
      const effects: PlanEffect[] = [{ kind: 'visible_publicly', entity: 'tournament' }, { kind: 'creator_becomes_admin' }];
      effects.push({ kind: 'pins_ruleset', source: phase.ruleset === 'plan' ? (ruleset?.mode === 'auto_epb' ? 'auto_epb' : 'plan') : 'explicit' });
      if (previous === undefined) effects.push({ kind: 'enrolls_roster' });
      else {
        effects.push({
          kind: 'prefilled_from_standings',
          previousPhaseKey: previous.key,
          ...(phase.advancement_rule ? { count: phase.advancement_rule.count, perGroup: phase.advancement_rule.per_group } : {}),
        });
      }
      const step = makeStep(
        `phase.${phase.key}`,
        'phase_create',
        refKey,
        { path: { id: leagueId }, body: toPhaseCreateBody(plan, phase) },
        after(leagueKey, lastRosterKey, phaseKeys[phaseKeys.length - 1] ?? null),
        effects,
      );
      steps.push(step);
      phaseKeys.push(step.key);
    });
  }

  if (league && groups?.mode === 'serpentine' && groups.count !== undefined && !built('groups')) {
    const step = makeStep(
      'groups',
      'groups_set',
      'groups',
      { path: { id: leagueId }, body: toGroupsBody(groups.count) },
      after(leagueKey, lastRosterKey, phaseKeys[phaseKeys.length - 1] ?? null),
      [],
    );
    steps.push(step);
    groupsKey = step.key;
  }

  if (league) {
    let previousDraftKey: string | null = null;
    for (const entry of draft ?? []) {
      const refKey = draftRefKey(entry.group_key);
      if (built(refKey)) continue;
      const step = makeStep(
        `draft.${entry.group_key ?? 'all'}`,
        'draft_pool_create',
        refKey,
        { body: toDraftCreateBody(leagueId, entry) },
        after(leagueKey, lastRosterKey, groupsKey, previousDraftKey),
        [{ kind: 'visible_publicly', entity: 'draft_pool' }],
      );
      steps.push(step);
      previousDraftKey = step.key;
    }
  }

  let tournamentKey: string | null = null;
  if (tournament && !built('tournament')) {
    const step = makeStep(
      'tournament',
      'tournament_create',
      'tournament',
      { body: toTournamentCreateBody(plan, tournament) },
      [],
      [
        { kind: 'visible_publicly', entity: 'tournament' },
        { kind: 'creator_becomes_admin' },
        { kind: 'pins_ruleset', source: tournament.ruleset === 'plan' ? 'plan' : 'explicit' },
      ],
    );
    steps.push(step);
    tournamentKey = step.key;
  }

  // The roster of a standalone tournament (a Plan without a league): one step per player, because the route takes one. The
  // last one carries the `roster` ref, so a roster that stopped half way stays unbuilt and a follow-up Build adds the rest.
  if (tournament && !league && roster && !built('roster')) {
    const tournamentId: string | PlanRefObject = plan.refs.tournament ? plan.refs.tournament.entity_id : refTo('tournament.id');
    const ids = resolvedRosterIds(plan);
    let previousKey: string | null = null;
    ids.forEach((playerId, index) => {
      const key = `roster.${index + 1}`;
      steps.push(
        makeStep(key, 'tournament_participant_add', index === ids.length - 1 ? 'roster' : null, { path: { id: tournamentId }, body: toTournamentParticipantAddBody(playerId) }, after(tournamentKey, previousKey), []),
      );
      previousKey = key;
    });
  }

  return steps;
}

/** Acknowledgements the approve request must carry for a Build of these steps (plan 4.5, G acks are per effect group). */
export const BUILD_ACK_IDS = ['visible_publicly'] as const;
export type BuildAckId = (typeof BUILD_ACK_IDS)[number];

export interface BuildSummary {
  steps: number;
  creating: number;
  /** Acknowledgement ids a Build card needs, sorted. */
  acks: BuildAckId[];
  /** Which of the Build caps the steps break, if any. */
  overLimit: Array<'steps' | 'creating'>;
}

export function summarizeBuild(steps: readonly PlanStep[]): BuildSummary {
  const creating = steps.filter((step) => step.creates).length;
  const publicEntity = steps.some((step) => step.effects.some((effect) => effect.kind === 'visible_publicly'));
  const overLimit: BuildSummary['overLimit'] = [];
  if (steps.length > BUILD_LIMITS.steps) overLimit.push('steps');
  if (creating > BUILD_LIMITS.creating) overLimit.push('creating');
  return { steps: steps.length, creating, acks: publicEntity ? ['visible_publicly'] : [], overLimit };
}
