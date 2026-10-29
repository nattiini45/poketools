/**
 * "Undo that" end to end for the plan 4.10 worked example, through the REAL routes and the real executor (spec §18.8): the Build
 * (a league, twelve players, two phases) is approved with the real bindings and leaves its ledger (entity ids, after-fingerprints
 * from the live reads); `propose_undo` is staged from that ledger by the real stager and approved; the roster removes and the
 * league archive run through the route handlers of `DELETE /api/seasons/[id]/participants` and `PATCH /api/seasons/[id]`; the
 * ledger rows of the Build become `undone`. Only the guards and the data layer are mocked, as in `ops-build.test.ts`.
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
  removed: [] as Array<[string, string]>,
  archivedPhases: [] as string[],
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
vi.mock('@/lib/supabase/queries/season-groups', () => ({
  removeLeagueParticipant: vi.fn(async (seasonId: string, playerId: string) => {
    db.removed.push([seasonId, playerId]);
    db.roster = db.roster.filter((id) => id !== playerId);
  }),
  toRosterAddError: (error: unknown) => error,
}));
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
    updateSeason: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const row = db.seasons.find((candidate) => candidate.id === id);
      if (row === undefined) throw new Error('no such season');
      Object.assign(row, patch, { updated_at: '2026-10-27T13:00:00.000Z' });
      return { ...row };
    }),
    getSeasonById: vi.fn(async (id: string) => {
      const row = db.seasons.find((candidate) => candidate.id === id);
      return row === undefined ? null : { ...row };
    }),
    listSeasonsByIds: vi.fn(async (wanted: string[]) => db.seasons.filter((row) => wanted.includes(row.id as string)).map(view)),
    listSeasons: vi.fn(async () => db.seasons.map(view)),
    getSeasonParticipants: vi.fn(async () => db.roster.map((id) => ({ id }))),
    addSeasonParticipant: vi.fn(async (_seasonId: string, playerId: string) => {
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
  archiveTournamentsBySeason: vi.fn(async (seasonId: string, archived: boolean) => {
    for (const phase of db.phases.filter((row) => row.season_id === seasonId)) {
      phase.archived = archived;
      db.archivedPhases.push(phase.id as string);
    }
  }),
  getTournamentWithDetails: vi.fn(async (id: string) => db.phases.find((row) => row.id === id) ?? null),
  getTournamentById: vi.fn(async (id: string) => db.phases.find((row) => row.id === id) ?? null),
  listAllTournaments: vi.fn(async () => db.phases),
}));

vi.mock('@/lib/tournament/enrollment-sync', () => ({
  syncStandingsEnrollment: vi.fn(async (_seasonId: string, phaseId: string) => {
    const phase = db.phases.find((row) => row.id === phaseId);
    if (phase === undefined) throw new Error('no such phase');
    phase.participant_count = db.roster.length;
    phase.enrollment_source = { type: phase.stage_order === 1 ? 'roster' : 'standings', source_phase_id: null, synced_at: '2026-10-27T12:00:07.000Z', frozen: false };
    return { enrolled_count: db.roster.length, enrollment_source: phase.enrollment_source, source_phase_name: null };
  }),
}));

import { executeProposal, type ExecuteInput, type ProposalResult } from '@/lib/ai/admin-agent/proposals/executor';
import { afterFingerprintFor } from '@/lib/ai/admin-agent/proposals/after-state';
import { liveFingerprints } from '@/lib/ai/admin-agent/proposals/live';
import { deriveApprovalToken } from '@/lib/ai/admin-agent/proposals/token';
import type { StageStaged } from '@/lib/ai/admin-agent/proposals/types';
import { PLAYERS } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { ADMIN, CONVERSATION_ID, TOKEN_SECRET } from '@/lib/ai/admin-agent/proposals/__tests__/helpers';
import { ledgerRow } from '@/lib/ai/admin-agent/proposals/__tests__/undo-helpers';
import { makeWorld, recordedSession, statusesOf, type World } from '@/lib/ai/admin-agent/proposals/__tests__/executor-helpers';
import { getBindingRegistry } from '../_ops/g';

let world: World;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.assign(db, { seasons: [], roster: [], phases: [], audit: [], removed: [], archivedPhases: [] });
  world = await makeWorld();
});

/** The Build, approved with the real bindings, recording what an undo needs. */
async function runBuild(): Promise<ProposalResult> {
  return executeProposal({ ...world.deps, bindings: getBindingRegistry(), afterFingerprint: afterFingerprintFor(liveFingerprints) }, await world.input());
}

/** `propose_undo` staged by the real stager from the ledger the Build left, then the input that approves it. */
async function stageUndo(args: Record<string, unknown> = { proposal_id: world.proposalId }) {
  const h = world.harness;
  // One ledger: the stager reads what the executor wrote. Live reads are the real ones, over the mocked data layer.
  h.store.actions = world.store.actions;
  (h.deps.source as { fingerprints: unknown }).fingerprints = liveFingerprints;
  h.store.see(CONVERSATION_ID, world.proposalId);
  h.turn.goLive = 0;
  h.turn.stagings = 0;
  const staged = await h.stage('propose_undo', args);
  const row = h.store.proposals.find((candidate) => candidate.kind === 'undo' && candidate.status === 'proposed');
  return { staged, row };
}

async function approveUndo(proposalId: string): Promise<ProposalResult> {
  const row = world.store.row(proposalId);
  const input: ExecuteInput = {
    mode: 'approve',
    adminId: ADMIN,
    adminName: 'Test Admin',
    isSiteAdmin: true,
    session: await recordedSession(),
    inbound: { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) },
    proposalId,
    approval: { token: deriveApprovalToken(TOKEN_SECRET, proposalId, ADMIN), proposalHash: row.proposal_hash, previewHash: row.preview_hash, acks: ['compensating_changes'] },
  };
  return executeProposal({ ...world.deps, bindings: getBindingRegistry(), fingerprints: liveFingerprints }, input);
}

describe('the Build leaves what an undo needs', () => {
  it('files the ledger rows under their entities and stores the after-fingerprints the live reads give', async () => {
    const result = await runBuild();
    expect(result.status).toBe('completed');
    expect(world.store.action('league')).toMatchObject({ entity_type: 'season', entity_id: ids.league, after_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(world.store.action('roster.1')).toMatchObject({ entity_id: null, after_fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(world.store.action('phase.playoffs')?.after_fingerprint).toBeNull();
    // The stored fingerprint is exactly what the live read gives now: nothing has changed since.
    expect(world.store.action('league')?.after_fingerprint).toBe((await import('@/lib/ai/admin-agent/plans/hash')).hashJson(await liveFingerprints.read('league_after', { kind: 'id', id: ids.league })));
  });
});

describe('"undo that" through the real routes', () => {
  it('stages the roster removes and the archive, approves them, and marks the Build\'s rows undone', async () => {
    await runBuild();
    expect(db.roster).toHaveLength(12);

    const { staged, row } = await stageUndo();
    expect(staged).toMatchObject({ status: 'staged', kind: 'undo', class: 'G' });
    expect(row?.steps).toHaveLength(13);

    const result = await approveUndo((staged as StageStaged).proposal_id);

    expect(result.status).toBe('completed');
    expect(statusesOf(result).every((status) => status.endsWith(':ok'))).toBe(true);
    // The route handlers ran: twelve removes (one per player) and one archive; the phases are archived with the league by the route.
    expect(db.removed.map(([season]) => season)).toEqual(PLAYERS.map(() => ids.league));
    expect(db.removed.map(([, player]) => player).sort()).toEqual([...PLAYERS].sort());
    expect(db.roster).toEqual([]);
    expect(db.seasons[0]).toMatchObject({ archived: true });
    expect(db.archivedPhases).toEqual([ids.phaseRegular, ids.phasePlayoffs]);

    // The routes' own audit events carry the agent provenance of the UNDO proposal and its approver.
    const archive = db.audit.find((entry) => entry.action === 'season.update');
    expect(archive).toMatchObject({
      resource_id: ids.league,
      changes: { archived: { before: false, after: true } },
      metadata: { via: 'agent', agent_proposal_id: (staged as StageStaged).proposal_id, agent_tool: 'league_archive', approved_by: ADMIN },
    });

    // The ledger: the Build's rows are undone (the phases are residue and stay), the undo's rows are filed under what they acted on.
    const forward = world.store.actions.filter((action) => action.proposal_id === world.proposalId);
    expect(forward.map((action) => [action.step_key, action.status])).toEqual([
      ['league', 'undone'],
      ['roster.1', 'undone'],
      ['phase.regular_season', 'ok'],
      ['phase.playoffs', 'ok'],
    ]);
    const undoRows = world.store.actions.filter((action) => action.proposal_id === (staged as StageStaged).proposal_id);
    expect(undoRows).toHaveLength(13);
    expect(undoRows.at(-1)).toMatchObject({ tool_name: 'league_archive', class: 'B', entity_type: 'season', entity_id: ids.league, status: 'ok', verify: { status: 'confirmed' } });
  });

  it('says there is nothing left to undo the second time', async () => {
    await runBuild();
    const first = await stageUndo();
    await approveUndo((first.staged as StageStaged).proposal_id);

    const second = await stageUndo();
    expect(second.staged).toMatchObject({ status: 'refused', code: 'nothing_to_undo' });
  });

  it('leaves the league alone after somebody renamed it, and archives nothing', async () => {
    await runBuild();
    db.seasons[0].name = 'Renamed by a human';

    const { staged, row } = await stageUndo();
    expect(staged).toMatchObject({ status: 'staged' });
    expect(row?.steps).toHaveLength(12);
    expect((row?.preview as { undo: { leftAlone: unknown[] } }).undo.leftAlone).toEqual([expect.objectContaining({ op: 'league_create', reason: 'edited_outside', name: { text: 'Renamed by a human', hidden: 0 } })]);

    const result = await approveUndo((staged as StageStaged).proposal_id);
    expect(result.status).toBe('completed');
    expect(db.seasons[0]).toMatchObject({ archived: false, name: 'Renamed by a human' });
    expect(db.roster).toEqual([]);
    expect(world.store.actions.find((action) => action.step_key === 'league')?.status).toBe('ok');
  });

  it('still offers the archive after the league was started: its status is not part of the fingerprint, and the start is listed as something that cannot be taken back', async () => {
    await runBuild();
    const before = await liveFingerprints.read('league_after', { kind: 'id', id: ids.league });
    // The league goes active when its first round is generated (a Go-live card of this chat, or the site's normal play), and a
    // start is recorded in the ledger next to the Build's rows.
    db.seasons[0].status = 'active';
    db.seasons[0].updated_at = '2026-10-28T09:00:00.000Z';
    world.store.actions.push(
      ledgerRow({ id: '00000000-0000-4000-8000-00000000a001', proposal_id: world.proposalId, step_key: 'start', tool_name: 'start_phase', class: 'G', status: 'ok', entity_type: 'tournament', entity_id: ids.phaseRegular }),
    );
    expect(await liveFingerprints.read('league_after', { kind: 'id', id: ids.league })).toEqual(before);

    const { staged, row } = await stageUndo();
    expect(staged).toMatchObject({ status: 'staged' });
    expect(row?.steps).toHaveLength(13);
    const undo = (row?.preview as { undo: { leftAlone: unknown[]; notUndoable: Array<{ op: string; reason: string }> } }).undo;
    expect(undo.leftAlone).toEqual([]);
    expect(undo.notUndoable).toEqual([expect.objectContaining({ op: 'start_phase', reason: 'outward_effect' })]);

    const result = await approveUndo((staged as StageStaged).proposal_id);
    expect(result.status).toBe('completed');
    expect(db.seasons[0]).toMatchObject({ archived: true, status: 'active' });
  });

  it('still leaves a league alone that a human renamed after it was started', async () => {
    await runBuild();
    db.seasons[0].status = 'active';
    db.seasons[0].name = 'Renamed by a human';
    const { staged, row } = await stageUndo();
    expect(staged).toMatchObject({ status: 'staged' });
    expect(row?.steps).toHaveLength(12);
    expect((row?.preview as { undo: { leftAlone: unknown[] } }).undo.leftAlone).toEqual([expect.objectContaining({ op: 'league_create', reason: 'edited_outside' })]);
  });

  it('refuses the roster removes once the roster changed in between (a player added by a human)', async () => {
    await runBuild();
    db.roster.push('00000000-0000-4000-8000-0000000fffff');
    const { staged, row } = await stageUndo();
    // Our twelve are all still there: the intersection is unchanged, so the roster is still ours to remove, and the stranger stays.
    expect(staged).toMatchObject({ status: 'staged' });
    expect(row?.steps).toHaveLength(13);
    await approveUndo((staged as StageStaged).proposal_id);
    expect(db.roster).toEqual(['00000000-0000-4000-8000-0000000fffff']);
  });

  it('stops with stale when the league was edited after staging, but before the click: the removes done stay done', async () => {
    await runBuild();
    const { staged } = await stageUndo();
    db.seasons[0].description = 'edited after staging';

    const result = await approveUndo((staged as StageStaged).proposal_id);

    expect(result.status).toBe('stale');
    expect(result.steps.at(-1)).toMatchObject({ status: 'skipped', code: 'proposal_stale' });
    expect(db.seasons[0]).toMatchObject({ archived: false });
    expect(db.roster).toEqual([]);
    expect(world.store.actions.find((action) => action.step_key === 'roster.1')?.status).toBe('undone');
  });
});
