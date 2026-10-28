/**
 * The Build bindings (`_ops/g`) against the REAL route modules and the real executor: the plan 4.10 worked example (a league,
 * a roster of twelve, two phases) is staged by the real stager and approved, and every step runs through `invokeRoute` into
 * the route's own handler, validation and audit calls. Only the guards and the data layer are mocked, as the repo's route
 * tests do: the "database" is a small in-memory world the mocked query functions read and write.
 *
 * Also here: the second lock (the executor parses the resolved request with the binding's strict schemas before it sends
 * anything) and the agent metadata on the routes' own audit events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ids = vi.hoisted(() => ({
  league: '00000000-0000-4000-8000-000000007001',
  phaseRegular: '00000000-0000-4000-8000-000000007101',
  phasePlayoffs: '00000000-0000-4000-8000-000000007102',
}));

const db = vi.hoisted(() => ({
  seasons: [] as Array<Record<string, unknown>>,
  roster: [] as string[],
  phases: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
  added: [] as Array<[string, string]>,
  syncs: [] as string[],
}));

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        db.audit.push(row);
        return { error: null };
      },
    }),
  },
}));
vi.mock('@/lib/auth/helpers', () => {
  const live = { playerId: '00000000-0000-4000-8000-000000000001', name: 'Test Admin', isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
  return {
    requireAnyAdmin: vi.fn(async () => live),
    requireResourceAdmin: vi.fn(async () => live),
    AuthError: class AuthError extends Error {
      constructor(
        message: string,
        public statusCode: number,
        public code?: string,
      ) {
        super(message);
      }
    },
  };
});
vi.mock('@/lib/ruleset-studio/pin-change', () => ({ assertRulesetChangeAllowed: vi.fn(), assertRulesetUsableForCreate: vi.fn() }));
vi.mock('@/lib/season/format-rules-defaults', () => ({ initializeEpbFormatRules: vi.fn() }));
vi.mock('@/lib/season/point-buy-battle-ruleset', () => ({ ensurePointBuyBattleRuleset: vi.fn() }));
vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({ getActiveListVersion: vi.fn(), bindSeasonToList: vi.fn() }));
vi.mock('@/lib/season/clone', () => ({ assertCloneAllowed: vi.fn(), copyLeagueStructure: vi.fn(), createCloneTracker: vi.fn(), rollbackClonedLeague: vi.fn() }));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ addResourceAdmin: vi.fn(), isResourceAdminFor: vi.fn(async () => true) }));
vi.mock('@/lib/supabase/queries/season-groups', () => ({ removeLeagueParticipant: vi.fn(), toRosterAddError: (error: unknown) => error }));
vi.mock('@/lib/players/roster-access', () => ({ canViewAdminRoster: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({ getRoundsByTournament: vi.fn(async () => []) }));

vi.mock('@/lib/supabase/queries/seasons', () => {
  const view = (row: Record<string, unknown>) => ({ ...row, participant_count: db.roster.length, tournament_count: db.phases.length });
  return {
    createSeason: vi.fn(async (input: Record<string, unknown>) => {
      const row = {
        id: ids.league,
        name: input.name,
        description: input.description ?? '',
        format_type: input.format_type,
        status: 'upcoming',
        archived: false,
        ruleset_id: input.ruleset_id ?? null,
        language: input.language ?? 'de',
        start_date: input.start_date ?? null,
        end_date: input.end_date ?? null,
        created_at: '2026-10-27T12:00:05.000Z',
        updated_at: '2026-10-27T12:00:05.000Z',
      };
      db.seasons.push(row);
      return row;
    }),
    getSeasonById: vi.fn(async (id: string) => db.seasons.find((row) => row.id === id) ?? null),
    listSeasonsByIds: vi.fn(async (wanted: string[]) => db.seasons.filter((row) => wanted.includes(row.id as string)).map(view)),
    listSeasons: vi.fn(async () => db.seasons.map(view)),
    getSeasonParticipants: vi.fn(async () => db.roster.map((id) => ({ id }))),
    addSeasonParticipant: vi.fn(async (seasonId: string, playerId: string) => {
      db.added.push([seasonId, playerId]);
      db.roster.push(playerId);
    }),
  };
});

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(async (seasonId: string) => db.phases.filter((row) => row.season_id === seasonId).map((row) => ({ ...row }))),
  createTournament: vi.fn(async (input: Record<string, unknown>) => {
    const row = {
      id: input.name === 'Playoffs' ? ids.phasePlayoffs : ids.phaseRegular,
      name: input.name,
      description: input.description ?? '',
      season_id: input.season_id,
      bracket_type: input.bracket_type,
      ruleset_id: input.ruleset_id,
      ruleset_name: 'Gen 9 OU',
      best_of_default: input.best_of_default,
      bo_overrides: {},
      is_doubles: input.is_doubles,
      team_visibility: input.team_visibility,
      status: 'upcoming',
      stage_order: input.stage_order,
      advancement_rule: input.advancement_rule ?? null,
      enrollment_source: null,
      participant_count: 0,
      archived: false,
      created_at: '2026-10-27T12:00:06.000Z',
      updated_at: '2026-10-27T12:00:06.000Z',
    };
    db.phases.push(row);
    return row;
  }),
  shiftStageOrders: vi.fn(),
  getTournamentWithDetails: vi.fn(async (id: string) => db.phases.find((row) => row.id === id) ?? null),
  getTournamentById: vi.fn(async (id: string) => db.phases.find((row) => row.id === id) ?? null),
  listAllTournaments: vi.fn(async () => db.phases),
}));

vi.mock('@/lib/tournament/enrollment-sync', () => ({
  syncStandingsEnrollment: vi.fn(async (_seasonId: string, phaseId: string) => {
    const phase = db.phases.find((row) => row.id === phaseId);
    if (phase === undefined) throw new Error('no such phase');
    db.syncs.push(phaseId);
    phase.participant_count = db.roster.length;
    phase.enrollment_source = { type: phase.stage_order === 1 ? 'roster' : 'standings', source_phase_id: null, synced_at: '2026-10-27T12:00:07.000Z', frozen: false };
    return { enrolled_count: db.roster.length, enrollment_source: phase.enrollment_source, source_phase_name: null };
  }),
}));

import { createSeason, addSeasonParticipant } from '@/lib/supabase/queries/seasons';
import { createTournament } from '@/lib/supabase/queries/tournaments';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { invokeRoute } from '@/lib/ai/admin-agent/dispatch';
import { executeProposal } from '@/lib/ai/admin-agent/proposals/executor';
import { PLAYERS, RULESET_VERSION } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { LEAGUE_ID, PHASE_IDS, makeWorld, reseal, statusesOf, type World } from '@/lib/ai/admin-agent/proposals/__tests__/executor-helpers';
import { getBindingRegistry } from '../_ops/g';
import { tournamentCreate } from '../_ops/g/tournament-create';

let world: World;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(db, { seasons: [], roster: [], phases: [], audit: [], added: [], syncs: [] });
  world = await makeWorld();
});

/** The approve with the REAL bindings (the world's own deps carry fakes). */
async function approveWithRealBindings(overrides?: Parameters<World['input']>[0]) {
  return executeProposal({ ...world.deps, bindings: getBindingRegistry() }, await world.input(overrides));
}

describe('the worked example through the real routes', () => {
  it('has the ids the mocked world hands out', () => {
    expect([ids.league, ids.phaseRegular, ids.phasePlayoffs]).toEqual([LEAGUE_ID, PHASE_IDS.regular_season, PHASE_IDS.playoffs]);
  });

  it('creates the league, adds twelve players and creates two enrolled phases', async () => {
    const result = await approveWithRealBindings();

    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    expect(result.status).toBe('completed');
    expect(vi.mocked(createSeason)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSeason).mock.calls[0][0]).toMatchObject({ name: 'Gen 9 OU League', format_type: 'singles', language: 'de', ruleset_id: RULESET_VERSION });
    expect(vi.mocked(addSeasonParticipant).mock.calls.map(([season, player]) => [season, player])).toEqual(PLAYERS.map((player) => [LEAGUE_ID, player]));
    expect(vi.mocked(createTournament).mock.calls.map(([input]) => [input.name, input.season_id, input.stage_order])).toEqual([
      ['Regular season', LEAGUE_ID, 1],
      ['Playoffs', LEAGUE_ID, 2],
    ]);
    // The route's own sync ran for both phases; the read-back found them enrolled and re-ran nothing.
    expect(db.syncs).toEqual([PHASE_IDS.regular_season, PHASE_IDS.playoffs]);
    expect(world.store.action('phase.regular_season')?.verify).toMatchObject({ status: 'confirmed', id: PHASE_IDS.regular_season, participants: 12, enrollment: 'roster', resynced: false });
    expect(world.store.action('phase.playoffs')?.verify).toMatchObject({ status: 'confirmed', participants: 12, enrollment: 'standings' });
    expect(world.store.action('roster.1')?.verify).toEqual({ status: 'confirmed', present: 12, expected: 12 });
    expect(world.store.action('league')).toMatchObject({ status: 'ok', entity_id: LEAGUE_ID, result: { id: LEAGUE_ID, ruleset_id: RULESET_VERSION }, verify: { status: 'confirmed', id: LEAGUE_ID } });
  });

  it('tags the routes\' own audit events with the agent provenance and the human approver', async () => {
    await approveWithRealBindings();

    const row = (action: string) => db.audit.find((entry) => entry.action === action);
    const create = row('season.create');
    expect(create).toMatchObject({
      actor_id: '00000000-0000-4000-8000-000000000001',
      actor_name: 'Test Admin',
      resource_type: 'season',
      resource_id: LEAGUE_ID,
      metadata: {
        // The route's own facts stay.
        format_type: 'singles',
        // The agent's, merged in by the audit context.
        via: 'agent',
        agent_conversation_id: world.row.conversation_id,
        agent_proposal_id: world.proposalId,
        agent_step: 'league',
        agent_tool: 'league_create',
        approved_by: '00000000-0000-4000-8000-000000000001',
        plan_code: world.row.proposal_hash.slice(0, 8),
        args_hash: world.steps[0].args_hash,
      },
    });
    expect(row('phase.create')).toMatchObject({ resource_id: LEAGUE_ID, metadata: { via: 'agent', agent_step: 'phase.regular_season', agent_tool: 'phase_create' } });
    const phases = db.audit.filter((entry) => entry.action === 'phase.create');
    expect(phases.map((entry) => (entry.metadata as { agent_step: string }).agent_step)).toEqual(['phase.regular_season', 'phase.playoffs']);
  });
});

describe('the second lock: the resolved request must still parse with the binding\'s strict schemas', () => {
  it('sends nothing for a league body that gained a key after staging (the hashes were put back in line)', async () => {
    reseal(world, (steps) => {
      (steps[0].body_template as Record<string, unknown>).is_test_season = true;
    });

    const result = await approveWithRealBindings();

    expect(vi.mocked(createSeason)).not.toHaveBeenCalled();
    expect(statusesOf(result)).toEqual(['league:failed', 'roster.1:skipped', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[0]).toMatchObject({ status: 'failed', code: 'agent_harness_error' });
    expect(world.store.action('league')).toMatchObject({ status: 'failed', error_code: 'agent_harness_error', http_status: null });
    expect(db.seasons).toEqual([]);
  });

  it('logs the issue paths and never the values', async () => {
    reseal(world, (steps) => {
      (steps[0].body_template as Record<string, unknown>).route_theme = 'secret-looking-value';
    });
    await approveWithRealBindings();

    const logged = vi.mocked(console.error).mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toMatch(/league was refused before dispatch \(body: body:unrecognized_keys\)/);
    expect(logged).not.toContain('secret-looking-value');
  });

  it('sends nothing for a path id that is not a uuid, and keeps the steps before it', async () => {
    reseal(world, (steps) => {
      steps[1].path_params = { id: 'not-a-uuid' };
    });

    const result = await approveWithRealBindings();

    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(result.steps[1]).toMatchObject({ code: 'agent_harness_error' });
    expect(vi.mocked(addSeasonParticipant)).not.toHaveBeenCalled();
    expect(result.status).toBe('partial');
  });

  it('refuses a roster body that gained a key, and a phase that tries to choose its own position', async () => {
    reseal(world, (steps) => {
      (steps[1].body_template as Record<string, unknown>).player_id = PLAYERS[0];
      (steps[2].body_template as Record<string, unknown>).insert_at = 1;
    });
    const result = await approveWithRealBindings();
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:failed', 'phase.regular_season:skipped', 'phase.playoffs:skipped']);
    expect(vi.mocked(addSeasonParticipant)).not.toHaveBeenCalled();
    expect(vi.mocked(createTournament)).not.toHaveBeenCalled();
  });

  it('has no binding for the ops of later phases: a stored groups step is stale (unknown op) and nothing runs', async () => {
    reseal(world, (steps) => {
      steps[3].op = 'groups_set';
    });

    await expect(approveWithRealBindings()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'unknown_op:groups_set' });
    expect(world.store.actions).toEqual([]);
    expect(db.seasons).toEqual([]);
  });

  it('keeps a compensating call out of a Build: a step edited to archive the league is stale, not dispatched', async () => {
    reseal(world, (steps) => {
      steps[0].op = 'league_archive';
      steps[0].method = 'PATCH';
      steps[0].route_template = '/api/seasons/[id]';
    });

    await expect(approveWithRealBindings()).rejects.toMatchObject({ code: 'proposal_stale', reason: 'op_not_buildable:league_archive' });
    expect(world.store.actions).toEqual([]);
    expect(db.seasons).toEqual([]);
  });
});

describe('a phase the route did not finish', () => {
  it('re-runs the enrollment sync through the sync-standings route as the same session, never the create, and adopts the phase', async () => {
    // The phase route inserts the tournament, then its enrollment sync fails: a masked 500 with the phase already there.
    vi.mocked(syncStandingsEnrollment).mockRejectedValueOnce(new Error('connection reset (secret detail)'));

    const result = await approveWithRealBindings();

    expect(result.status).toBe('completed');
    expect(statusesOf(result)).toEqual(['league:ok', 'roster.1:ok', 'phase.regular_season:ok', 'phase.playoffs:ok']);
    expect(vi.mocked(createTournament)).toHaveBeenCalledTimes(2);
    expect(world.store.action('phase.regular_season')).toMatchObject({
      status: 'ok',
      outcome_kind: 'masked_server_error',
      entity_id: PHASE_IDS.regular_season,
      verify: { status: 'confirmed', id: PHASE_IDS.regular_season, participants: 12, resynced: true },
    });
    // One failed sync inside the create, one repair through the sync-standings route, one for the playoffs phase.
    expect(vi.mocked(syncStandingsEnrollment).mock.calls.map(([, phaseId]) => phaseId)).toEqual([PHASE_IDS.regular_season, PHASE_IDS.regular_season, PHASE_IDS.playoffs]);
    // The ledger and the log carry the cause by code only.
    expect(JSON.stringify(world.store.actions)).not.toContain('secret detail');
  });

  it('leaves the step unknown when the repair cannot run either', async () => {
    vi.mocked(syncStandingsEnrollment).mockRejectedValueOnce(new Error('first (secret detail)'))
      .mockRejectedValueOnce(new Error('still down (secret detail)'))
      .mockRejectedValueOnce(new Error('and after the settle wait (secret detail)'));

    const result = await approveWithRealBindings();

    expect(result.steps[2]).toMatchObject({ key: 'phase.regular_season', status: 'unknown', code: 'unknown_outcome' });
    expect(result.status).toBe('executing');
    // The read-back waited the settle window and tried once more; the create was never sent twice.
    expect(world.sleeps).toEqual([15_000]);
    expect(vi.mocked(createTournament)).toHaveBeenCalledTimes(1);
  });
});

describe('a standalone tournament', () => {
  it('is created by the route and its tournament.create event carries the agent metadata', async () => {
    const input = await world.input();
    const outcome = await invokeRoute(
      tournamentCreate,
      { body: { name: 'Summer Cup', bracket_type: 'single_elim', ruleset_id: RULESET_VERSION, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' } },
      {
        session: input.session,
        inbound: input.inbound,
        audit: { agent_conversation_id: world.row.conversation_id, agent_proposal_id: world.proposalId, agent_step: 'tournament', approved_by: input.adminId },
      },
    );

    expect(outcome).toMatchObject({ kind: 'ok', httpStatus: 201 });
    expect(db.audit.find((entry) => entry.action === 'tournament.create')).toMatchObject({
      resource_type: 'tournament',
      resource_name: 'Summer Cup',
      metadata: { via: 'agent', agent_step: 'tournament', agent_tool: 'tournament_create', agent_proposal_id: world.proposalId, bracket_type: 'single_elim' },
    });
  });
});
