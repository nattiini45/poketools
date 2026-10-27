import { describe, expect, it } from 'vitest';
import { PLAN_OP_INFO, PLAN_OPS, BUILD_LIMITS } from '../ops';
import { REF_PATH_PATTERN, isRefObject, refTo } from '../route-bodies';
import { validateStepBodies } from '../route-check';
import { setPlanRef } from '../edit';
import { deriveSteps, resolvedRosterIds, summarizeBuild, type PlanStep } from '../steps';
import type { PlanDocument } from '../schema';
import { PLAYERS, RULESET_VERSION, SEASON_ID, parseOrThrow, resolvedRoster, uid, workedExample } from './fixtures';

const edit = (plan: PlanDocument, slots: Record<string, unknown>): PlanDocument => parseOrThrow({ ...plan, slots: { ...plan.slots, ...slots } });
const keys = (steps: readonly PlanStep[]): string[] => steps.map((step) => step.key);
const withRef = (plan: PlanDocument, refKey: string, entityId = SEASON_ID): PlanDocument => {
  const result = setPlanRef(plan, refKey, { entity_type: 'season', entity_id: entityId });
  if (!result.ok) throw new Error('ref');
  return result.plan;
};

describe('deriveSteps: the worked example', () => {
  const steps = deriveSteps(workedExample());

  it('orders league, roster, phases with stable keys', () => {
    expect(keys(steps)).toEqual(['league', 'roster.1', 'phase.regular_season', 'phase.playoffs']);
    expect(steps.every((step) => step.class === 'B' && step.minRole === 'any')).toBe(true);
  });

  it('chains each step behind what it needs: the first phase enrolls the roster at creation', () => {
    expect(steps.map((step) => step.blockedBy)).toEqual([[], ['league'], ['league', 'roster.1'], ['league', 'roster.1', 'phase.regular_season']]);
  });

  it('sends the league the route body: VERSION id, no route_theme, no admins copied', () => {
    expect(steps[0].args).toEqual({
      path: {},
      query: {},
      body: { name: 'Gen 9 OU League', format_type: 'singles', language: 'de', start_date: '2026-11-02', ruleset_id: RULESET_VERSION },
    });
    expect(steps[0].effects).toEqual([
      { kind: 'visible_publicly', entity: 'league' },
      { kind: 'creator_becomes_admin' },
      { kind: 'pins_ruleset', source: 'plan', versionId: RULESET_VERSION },
    ]);
  });

  it('addresses later steps by reference to the league step, and names the route fields', () => {
    expect(steps[1].args.path).toEqual({ id: { $ref: 'league.id' } });
    expect(steps[1].args.body).toEqual({ player_ids: PLAYERS });
    expect(steps[3].args.body).toEqual({
      name: 'Playoffs',
      bracket_type: 'single_elim',
      ruleset_id: RULESET_VERSION,
      best_of_default: 3,
      is_doubles: false,
      team_visibility: 'hidden_until_match',
      advancement_rule: { type: 'top_n', count: 4, per_group: false },
    });
  });

  it('says what a phase does to enrollment: the first enrolls the roster, a later one is pre-filled from standings', () => {
    expect(steps[2].effects).toContainEqual({ kind: 'enrolls_roster' });
    expect(steps[3].effects).toContainEqual({ kind: 'prefilled_from_standings', previousPhaseKey: 'regular_season', count: 4, perGroup: false });
  });

  it('declares guard, reads, read-back and reversal from the op table', () => {
    expect(steps[0]).toMatchObject({ op: 'league_create', guard: 'requireAnyAdmin', verify: 'season_exists', reversal: 'archive_league', creates: true });
    expect(steps[1]).toMatchObject({ op: 'roster_add', guard: 'requireResourceAdmin', reads: ['roster_hash'], reversal: 'remove_roster', creates: false });
    expect(steps[2]).toMatchObject({ op: 'phase_create', verify: 'phase_enrolled', reversal: 'none', entityType: 'tournament' });
  });

  it('has no step that is not B, and no op outside the table', () => {
    for (const step of steps) expect(PLAN_OPS).toContain(step.op);
    expect(Object.keys(PLAN_OP_INFO).sort()).toEqual([...PLAN_OPS].sort());
  });

  it('is deterministic and does not touch the plan', () => {
    const plan = workedExample();
    expect(deriveSteps(plan)).toEqual(deriveSteps(plan));
    expect(JSON.stringify(plan)).toBe(JSON.stringify(workedExample()));
  });

  it('passes the real route schemas, with every ref resolved to a placeholder', () => {
    expect(validateStepBodies(steps)).toEqual([]);
  });
});

describe('deriveSteps: stability and built slots', () => {
  it('keeps the other keys when a phase is added', () => {
    const plan = workedExample();
    const more = edit(plan, {
      phases: [...plan.slots.phases!, { key: 'finals', name: 'Finals', bracket_type: 'single_elim', best_of: 5, is_doubles: false, ruleset: 'plan' }],
    });
    expect(keys(deriveSteps(more))).toEqual([...keys(deriveSteps(plan)), 'phase.finals']);
  });

  it('gives a built slot no step and addresses the live league by its id', () => {
    let plan = withRef(workedExample(), 'league');
    plan = withRef(plan, 'roster');
    plan = withRef(plan, 'phase.regular_season', uid(61));
    const steps = deriveSteps(plan);
    expect(keys(steps)).toEqual(['phase.playoffs']);
    expect(steps[0].args.path).toEqual({ id: SEASON_ID });
    // Nothing left to wait for: the earlier steps are not part of this Build.
    expect(steps[0].blockedBy).toEqual([]);
  });

  it('rebuilds only what is missing after a partial Build', () => {
    const plan = withRef(workedExample(), 'league');
    expect(keys(deriveSteps(plan))).toEqual(['roster.1', 'phase.regular_season', 'phase.playoffs']);
  });
});

describe('deriveSteps: roster', () => {
  it('splits the resolved players into chunks of 50, in order, chained', () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({ input: `P${i}`, state: 'resolved' as const, player_id: uid(1000 + i) }));
    const plan = edit(workedExample(), { roster: { entries } });
    const roster = deriveSteps(plan).filter((step) => step.op === 'roster_add');
    expect(keys(roster)).toEqual(['roster.1', 'roster.2', 'roster.3']);
    expect(roster.map((step) => (step.args.body as { player_ids: string[] }).player_ids.length)).toEqual([50, 50, 20]);
    expect(roster[2].blockedBy).toEqual(['league', 'roster.2']);
    expect(validateStepBodies(roster)).toEqual([]);
  });

  it('marks the roster built only by its last chunk, so a failed middle chunk leaves it unbuilt', () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({ input: `P${i}`, state: 'resolved' as const, player_id: uid(1000 + i) }));
    const roster = deriveSteps(edit(workedExample(), { roster: { entries } })).filter((step) => step.op === 'roster_add');
    expect(roster.map((step) => step.refKey)).toEqual([null, null, 'roster']);
    // One chunk is its own last chunk.
    expect(deriveSteps(workedExample()).filter((step) => step.op === 'roster_add').map((step) => step.refKey)).toEqual(['roster']);
  });

  it('adds each player once and skips the open entries', () => {
    const plan = edit(workedExample(), {
      roster: {
        entries: [
          ...resolvedRoster(2).entries,
          { input: 'again', state: 'resolved', player_id: PLAYERS[0].toUpperCase() },
          { input: 'x', state: 'unresolved' },
          { input: 'y', state: 'skipped' },
          { input: 'z', state: 'candidates', player_ids: [PLAYERS[5], PLAYERS[6]] },
        ],
      },
    });
    expect(resolvedRosterIds(plan)).toEqual([PLAYERS[0], PLAYERS[1]]);
  });

  it('makes no roster step for an empty roster', () => {
    expect(keys(deriveSteps(edit(workedExample(), { roster: { entries: [] } })))).toEqual(['league', 'phase.regular_season', 'phase.playoffs']);
  });
});

describe('deriveSteps: Evolution Point Buy, groups and draft', () => {
  const epb = (draft: unknown[], groups?: unknown) =>
    edit(workedExample(), {
      ruleset: { mode: 'auto_epb' },
      league: { name: 'EvoLiga', format_type: 'evolution_point_buy', language: 'de' },
      draft,
      ...(groups ? { groups } : {}),
    });

  it('lets the league route ensure the battle ruleset and has phases read the version it pinned', () => {
    const steps = deriveSteps(epb([]));
    expect(steps[0].effects).toEqual(
      expect.arrayContaining([{ kind: 'pins_ruleset', source: 'auto_epb' }, { kind: 'ensures_battle_ruleset' }]),
    );
    expect(steps[0].reads).toEqual(['league_name_recent', 'epb_battle_ruleset_head']);
    expect((steps[0].args.body as Record<string, unknown>).ruleset_id).toBeUndefined();
    const phase = steps.find((step) => step.key === 'phase.playoffs')!;
    expect((phase.args.body as Record<string, unknown>).ruleset_id).toEqual(refTo('league.ruleset_id'));
    expect(validateStepBodies(steps)).toEqual([]);
  });

  it('does not ensure the battle ruleset when an explicit version is pinned', () => {
    const plan = edit(workedExample(), { league: { name: 'EvoLiga', format_type: 'evolution_point_buy', language: 'de' } });
    expect(deriveSteps(plan)[0].effects.map((e) => e.kind)).not.toContain('ensures_battle_ruleset');
  });

  it('creates the groups after the phases and one queue pool per group after the groups', () => {
    const steps = deriveSteps(
      epb([{ engine: 'queue', group_key: 'A', budget: 100 }, { engine: 'queue', group_key: 'B', participant_order: [PLAYERS[0], PLAYERS[1]] }], { mode: 'serpentine', count: 2 }),
    );
    expect(keys(steps)).toEqual(['league', 'roster.1', 'phase.regular_season', 'phase.playoffs', 'groups', 'draft.A', 'draft.B']);
    const groups = steps.find((s) => s.key === 'groups')!;
    expect(groups.blockedBy).toEqual(['league', 'roster.1', 'phase.playoffs']);
    expect(groups.args.body).toEqual({ mode: 'serpentine', group_count: 2 });
    const [a, b] = steps.filter((s) => s.op === 'draft_pool_create');
    expect(a.args.body).toEqual({ season_id: { $ref: 'league.id' }, kind: 'initial', config: { budget: 100 }, season_group_id: { $ref: 'groups.A.id' } });
    expect(b.args.body).toMatchObject({ config: { participant_order: [PLAYERS[0], PLAYERS[1]] }, season_group_id: { $ref: 'groups.B.id' } });
    expect(a.blockedBy).toEqual(['league', 'roster.1', 'groups']);
    expect(b.blockedBy).toEqual(['league', 'roster.1', 'groups', 'draft.A']);
    expect(a.effects).toEqual([{ kind: 'visible_publicly', entity: 'draft_pool' }]);
    expect(validateStepBodies(steps)).toEqual([]);
  });

  it('sends the legacy shape for a legacy pool: pricing, turn order and budget, nothing the route ignores', () => {
    const plan = edit(workedExample(), {
      league: { name: 'L', format_type: 'draft', language: 'de' },
      draft: [{ engine: 'legacy', draft_type: 'budget', pick_order: 'snake', budget: 110 }],
    });
    const pool = deriveSteps(plan).find((s) => s.op === 'draft_pool_create')!;
    expect(pool.key).toBe('draft.all');
    expect(pool.args.body).toEqual({ season_id: { $ref: 'league.id' }, draft_type: 'budget', pick_order: 'snake', budget: 110 });
    expect(validateStepBodies([pool])).toEqual([]);
    const snake = edit(plan, { draft: [{ engine: 'legacy' }] });
    expect(deriveSteps(snake).find((s) => s.op === 'draft_pool_create')!.args.body).toEqual({ season_id: { $ref: 'league.id' }, draft_type: 'snake' });
  });

  it('skips a built pool and a built groups step', () => {
    const plan = withRef(
      withRef(epb([{ engine: 'queue', group_key: 'A' }, { engine: 'queue', group_key: 'B' }], { mode: 'serpentine', count: 2 }), 'groups'),
      'draft.A',
    );
    expect(keys(deriveSteps(plan))).toEqual(['league', 'roster.1', 'phase.regular_season', 'phase.playoffs', 'draft.B']);
  });
});

describe('deriveSteps: clone and tournament', () => {
  it('sends the clone block with copy_admins always false', () => {
    const plan = edit(workedExample(), {
      phases: [],
      roster: undefined,
      league: { name: 'Copy', format_type: 'singles', language: 'de', clone_from: { season_id: SEASON_ID, copy_roster: true, copy_admins: true } },
    });
    const [league] = deriveSteps(plan);
    expect((league.args.body as Record<string, unknown>).clone_from).toEqual({ season_id: SEASON_ID, copy_roster: true, copy_admins: false });
    expect(league.effects).toContainEqual({ kind: 'clones_from', seasonId: SEASON_ID, copyRoster: true });
    expect(validateStepBodies([league])).toEqual([]);
  });

  it('creates a standalone tournament on its own, with the route field names', () => {
    const plan = parseOrThrow({
      v: 1, title: 'Cup', intent: 'tournament', contentLocale: 'en', assumptions: [], refs: {},
      slots: {
        ruleset: { mode: 'existing', version_id: RULESET_VERSION },
        tournament: { name: 'Friday Cup', bracket_type: 'double_elim', best_of: 3, bo_overrides: { Finals: 5 }, is_doubles: true, bracket_reset_enabled: false, team_visibility: 'always_public', ruleset: 'plan' },
      },
    });
    const steps = deriveSteps(plan);
    expect(keys(steps)).toEqual(['tournament']);
    expect(steps[0]).toMatchObject({ op: 'tournament_create', guard: 'requireAnyAdmin', verify: 'tournament_administrable', reversal: 'archive_tournament', blockedBy: [] });
    expect(steps[0].args.body).toEqual({
      name: 'Friday Cup', bracket_type: 'double_elim', ruleset_id: RULESET_VERSION, best_of_default: 3,
      bo_overrides: { Finals: 5 }, is_doubles: true, team_visibility: 'always_public', bracket_reset_enabled: false,
    });
    expect(validateStepBodies(steps)).toEqual([]);
  });

  it('runs a tournament after a league in a mixed plan, with a version named directly', () => {
    const other = uid(9100);
    const plan = edit(workedExample(), {
      tournament: { name: 'Cup', bracket_type: 'single_elim', best_of: 1, is_doubles: false, team_visibility: 'hidden_until_match', ruleset: { id: other } },
    });
    const steps = deriveSteps(plan);
    expect(keys(steps).at(-1)).toBe('tournament');
    expect(steps.at(-1)!.effects).toContainEqual({ kind: 'pins_ruleset', source: 'explicit' });
    expect((steps.at(-1)!.args.body as Record<string, unknown>).ruleset_id).toBe(other);
  });
});

describe('deriveSteps: unpublished ruleset', () => {
  it('leaves ruleset_id out instead of inventing one (the route schema then refuses it, as readiness does)', () => {
    const plan = edit(workedExample(), { ruleset: { mode: 'new', name: 'N', base_locale: 'en' } });
    const steps = deriveSteps(plan);
    expect((steps[0].args.body as Record<string, unknown>).ruleset_id).toBeUndefined();
    const issues = validateStepBodies(steps.filter((s) => s.op === 'phase_create'));
    expect(issues.map((i) => [i.stepKey, i.path])).toEqual([['phase.regular_season', '/ruleset_id'], ['phase.playoffs', '/ruleset_id']]);
  });
});

describe('summarizeBuild', () => {
  it('counts steps, creating steps and the public acknowledgement', () => {
    expect(summarizeBuild(deriveSteps(workedExample()))).toEqual({ steps: 4, creating: 3, acks: ['visible_publicly'], overLimit: [] });
  });

  it('flags the 40-step and 10-creating caps', () => {
    const phases = Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, name: `Phase ${i}`, bracket_type: 'swiss', best_of: 1, is_doubles: false, ruleset: 'plan' }));
    const summary = summarizeBuild(deriveSteps(edit(workedExample(), { phases })));
    expect(summary).toMatchObject({ steps: 12, creating: 11, overLimit: ['creating'] });
    const huge = Array.from({ length: 1 + BUILD_LIMITS.steps }, () => deriveSteps(workedExample())[1]);
    expect(summarizeBuild(huge).overLimit).toEqual(['steps']);
  });

  it('needs no public acknowledgement for a roster-only build', () => {
    const plan = withRef(edit(workedExample(), { phases: [] }), 'league');
    expect(summarizeBuild(deriveSteps(plan))).toMatchObject({ steps: 1, acks: [] });
  });
});

describe('references', () => {
  it('only emits whitelisted $ref paths', () => {
    const plan = edit(workedExample(), {
      ruleset: { mode: 'auto_epb' },
      league: { name: 'E', format_type: 'evolution_point_buy', language: 'de' },
      groups: { mode: 'serpentine', count: 2 },
      draft: [{ engine: 'queue', group_key: 'A' }],
    });
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (isRefObject(value)) found.add(value.$ref);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
    };
    deriveSteps(plan).forEach((step) => walk(step.args));
    expect([...found].sort()).toEqual(['groups.A.id', 'league.id', 'league.ruleset_id']);
    for (const path of found) expect(REF_PATH_PATTERN.test(path)).toBe(true);
    expect(REF_PATH_PATTERN.test('league.name')).toBe(false);
    expect(REF_PATH_PATTERN.test('groups.a.id')).toBe(false);
  });

  it('reports a ref path the executor would not resolve and a key the route would strip', () => {
    const [league] = deriveSteps(workedExample());
    const badRef: PlanStep = { ...league, args: { ...league.args, body: { ...(league.args.body as object), clone_from: { season_id: refTo('league.name') } } } as PlanStep['args'] };
    expect(validateStepBodies([badRef]).map((i) => i.reason)).toContain('ref_path_not_allowed');
    const stripped: PlanStep = { ...league, args: { ...league.args, body: { ...(league.args.body as object), legs: 2 } } as PlanStep['args'] };
    expect(validateStepBodies([stripped])).toContainEqual({ stepKey: 'league', path: '/legs', reason: 'key_stripped' });
  });
});
