import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSeasonById: vi.fn(),
  deleteSeason: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  createTournament: vi.fn(),
  deleteTournament: vi.fn(),
  isResourceAdminFor: vi.fn(),
  getResourceAdmins: vi.fn(),
  addResourceAdmin: vi.fn(),
  removeResourceAdmin: vi.fn(),
  addSeasonParticipants: vi.fn(),
  listSeasonParticipantIds: vi.fn(),
  syncStandingsEnrollment: vi.fn(),
  expireSeasonReads: vi.fn(),
  logAuditEvent: vi.fn(),
  /** Every property read on a guarded module: a point-buy league's own data must stay unread. */
  touched: [] as string[],
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: mocks.getSeasonById,
  deleteSeason: mocks.deleteSeason,
}));
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: mocks.getStagesBySeasonId,
  createTournament: mocks.createTournament,
  deleteTournament: mocks.deleteTournament,
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: mocks.isResourceAdminFor,
  getResourceAdmins: mocks.getResourceAdmins,
  addResourceAdmin: mocks.addResourceAdmin,
  removeResourceAdmin: mocks.removeResourceAdmin,
}));
vi.mock('@/lib/supabase/queries/season-clone', () => ({
  addSeasonParticipants: mocks.addSeasonParticipants,
  listSeasonParticipantIds: mocks.listSeasonParticipantIds,
}));
vi.mock('@/lib/tournament/enrollment-sync', () => ({ syncStandingsEnrollment: mocks.syncStandingsEnrollment }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: mocks.expireSeasonReads }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: mocks.logAuditEvent }));

// Point-buy, draft, token, redraft, evolution and format-rules modules: any read is recorded.
function guarded(id: string) {
  return () =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === 'string' && prop !== 'then' && prop !== '__esModule') mocks.touched.push(`${id}.${prop}`);
          return vi.fn();
        },
      },
    );
}
vi.mock('@/lib/supabase/queries/point-buy-lists', guarded('point-buy-lists'));
vi.mock('@/lib/supabase/queries/format-rules', guarded('format-rules'));
vi.mock('@/lib/season/format-rules-defaults', guarded('format-rules-defaults'));
vi.mock('@/lib/supabase/queries/drafts', guarded('drafts'));
vi.mock('@/lib/supabase/queries/redraft', guarded('redraft'));
vi.mock('@/lib/supabase/queries/epb-kill-tokens', guarded('epb-kill-tokens'));
vi.mock('@/lib/supabase/queries/epb-token-grants', guarded('epb-token-grants'));
vi.mock('@/lib/supabase/queries/evolutions', guarded('evolutions'));

import {
  assertCloneAllowed,
  copyLeagueStructure,
  createCloneTracker,
  planPhaseCopies,
  rollbackClonedLeague,
  type CloneActor,
  type CloneTracker,
} from '../clone';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Season } from '@/types/season';
import type { Tournament } from '@/types/tournament';

const siteAdmin: CloneActor = { playerId: 'admin-1', name: 'Admin', isAdmin: true };
const resourceAdmin: CloneActor = { playerId: 'radmin-1', name: 'Resource Admin', isAdmin: false };

const source = { id: 'src-1', name: 'Autumn League', format_type: 'singles' } as unknown as Season;
const created = { id: 'new-1', name: 'Spring League', format_type: 'singles' } as unknown as Season;

function phase(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 'ph-1',
    name: 'Groups',
    description: 'Round robin',
    season_id: 'src-1',
    bracket_type: 'round_robin',
    ruleset_id: 'rs-1',
    best_of_default: 3,
    bo_overrides: { Finals: 5 },
    is_doubles: false,
    team_visibility: 'private',
    status: 'completed',
    current_round: 4,
    stage_order: 1,
    advancement_rule: { type: 'top_n', count: 4, per_group: true },
    enrollment_source: { type: 'roster', source_phase_id: null, synced_at: '2026-01-01', frozen: true },
    archived: true,
    legacy: true,
    bracket_reset_enabled: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-02',
    ...overrides,
  } as Tournament;
}

const PLAN_KEYS = [
  'advancement_rule',
  'best_of_default',
  'bo_overrides',
  'bracket_reset_enabled',
  'bracket_type',
  'description',
  'is_doubles',
  'name',
  'ruleset_id',
  'season_id',
  'stage_order',
  'team_visibility',
];

function tracker(actor: CloneActor = resourceAdmin): CloneTracker {
  return createCloneTracker({ seasonId: created.id, seasonName: created.name, sourceId: source.id, actor });
}

const caught = async (promise: Promise<unknown>): Promise<UserFacingError> => {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(UserFacingError);
    return err as UserFacingError;
  }
  throw new Error('expected a rejection');
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.touched.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('assertCloneAllowed', () => {
  it('404 SEASON_NOT_FOUND for an unknown source', async () => {
    mocks.getSeasonById.mockResolvedValue(null);

    const err = await caught(assertCloneAllowed(siteAdmin, { sourceId: 'nope', copyAdmins: false }));

    expect(err.code).toBe('SEASON_NOT_FOUND');
    expect(err.statusCode).toBe(404);
  });

  it('403 SEASON_CLONE_FORBIDDEN for a resource admin of another league', async () => {
    mocks.getSeasonById.mockResolvedValue(source);
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const err = await caught(assertCloneAllowed(resourceAdmin, { sourceId: source.id, copyAdmins: false }));

    expect(err.code).toBe('SEASON_CLONE_FORBIDDEN');
    expect(err.statusCode).toBe(403);
    expect(mocks.isResourceAdminFor).toHaveBeenCalledWith('radmin-1', 'season', 'src-1');
  });

  it('409 SEASON_CLONE_CUSTOM_FORMAT for a custom-format source, for a site admin and a league admin alike', async () => {
    const custom = { ...source, format_type: 'custom' } as unknown as Season;
    mocks.getSeasonById.mockResolvedValue(custom);
    mocks.isResourceAdminFor.mockResolvedValue(true);

    for (const actor of [siteAdmin, resourceAdmin]) {
      const err = await caught(assertCloneAllowed(actor, { sourceId: custom.id, copyAdmins: false }));

      expect(err.code).toBe('SEASON_CLONE_CUSTOM_FORMAT');
      expect(err.statusCode).toBe(409);
    }
  });

  it('403 comes first: a caller who may not copy a custom league learns nothing about its type', async () => {
    mocks.getSeasonById.mockResolvedValue({ ...source, format_type: 'custom' } as unknown as Season);
    mocks.isResourceAdminFor.mockResolvedValue(false);

    const err = await caught(assertCloneAllowed(resourceAdmin, { sourceId: source.id, copyAdmins: false }));

    expect(err.code).toBe('SEASON_CLONE_FORBIDDEN');
  });

  it('lets a resource admin of the source through', async () => {
    mocks.getSeasonById.mockResolvedValue(source);
    mocks.isResourceAdminFor.mockResolvedValue(true);

    await expect(assertCloneAllowed(resourceAdmin, { sourceId: source.id, copyAdmins: false })).resolves.toEqual({
      source,
    });
  });

  it('lets a site admin through without a league-admin lookup, archived or test source included', async () => {
    const archivedTest = { ...source, archived: true, is_test_season: true } as Season;
    mocks.getSeasonById.mockResolvedValue(archivedTest);

    await expect(assertCloneAllowed(siteAdmin, { sourceId: source.id, copyAdmins: true })).resolves.toEqual({
      source: archivedTest,
    });
    expect(mocks.isResourceAdminFor).not.toHaveBeenCalled();
  });

  it('403 SEASON_CLONE_ADMINS_FORBIDDEN when a resource admin copies the admins, even of their own league', async () => {
    mocks.getSeasonById.mockResolvedValue(source);
    mocks.isResourceAdminFor.mockResolvedValue(true);

    const err = await caught(assertCloneAllowed(resourceAdmin, { sourceId: source.id, copyAdmins: true }));

    expect(err.code).toBe('SEASON_CLONE_ADMINS_FORBIDDEN');
    expect(err.statusCode).toBe(403);
  });
});

describe('planPhaseCopies', () => {
  it('closes gaps in the stage order and keeps the order', () => {
    const plan = planPhaseCopies(
      [
        phase({ id: 'c', name: 'Finals', stage_order: 4 }),
        phase({ id: 'a', name: 'Groups', stage_order: 1 }),
        phase({ id: 'b', name: 'Playoffs', stage_order: 3 }),
      ],
      'new-1',
    );

    expect(plan.map((p) => [p.name, p.stage_order])).toEqual([
      ['Groups', 1],
      ['Playoffs', 2],
      ['Finals', 3],
    ]);
  });

  it('builds exactly the allowed fields for the new league', () => {
    const [input] = planPhaseCopies([phase()], 'new-1');

    expect(Object.keys(input).sort()).toEqual(PLAN_KEYS);
    expect(input).toEqual({
      name: 'Groups',
      description: 'Round robin',
      bracket_type: 'round_robin',
      ruleset_id: 'rs-1',
      best_of_default: 3,
      bo_overrides: { Finals: 5 },
      is_doubles: false,
      team_visibility: 'private',
      bracket_reset_enabled: false,
      advancement_rule: { type: 'top_n', count: 4, per_group: true },
      season_id: 'new-1',
      stage_order: 1,
    });
    for (const key of ['id', 'status', 'current_round', 'enrollment_source', 'archived', 'legacy']) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it('copies the advancement rule and best-of overrides verbatim, as stored on the same phase', () => {
    const plan = planPhaseCopies(
      [
        phase({ id: 'a', stage_order: 1, advancement_rule: { type: 'top_n', count: 8, per_group: false } }),
        phase({ id: 'b', stage_order: 2, advancement_rule: null, bo_overrides: {} }),
      ],
      'new-1',
    );

    expect(plan[0].advancement_rule).toEqual({ type: 'top_n', count: 8, per_group: false });
    expect(plan[1].advancement_rule).toBeNull();
    expect(plan[1].bo_overrides).toEqual({});
  });

  it('does not alias the source phase objects', () => {
    const original = phase();
    const [input] = planPhaseCopies([original], 'new-1');

    expect(input.bo_overrides).not.toBe(original.bo_overrides);
    expect(input.advancement_rule).not.toBe(original.advancement_rule);
  });

  it('a phase with rounds, matches and participants yields the same input as an empty one', () => {
    const empty = phase({ id: 'x' });
    const played = {
      ...empty,
      rounds: [{ id: 'r1' }],
      matches: [{ id: 'm1' }],
      games: [{ id: 'g1' }],
      participants: [{ id: 'p1' }],
      participant_count: 12,
      status: 'active',
      current_round: 9,
    } as unknown as Tournament;

    expect(planPhaseCopies([played], 'new-1')).toEqual(planPhaseCopies([empty], 'new-1'));
  });
});

describe('copyLeagueStructure', () => {
  function seed(
    phases: Tournament[] = [phase({ id: 'a', stage_order: 1 }), phase({ id: 'b', name: 'Playoffs', stage_order: 3 })],
  ) {
    mocks.getStagesBySeasonId.mockResolvedValue(phases);
    let n = 0;
    mocks.createTournament.mockImplementation(async () => ({ id: `new-ph-${++n}` }));
    mocks.syncStandingsEnrollment.mockResolvedValue(undefined);
    mocks.listSeasonParticipantIds.mockResolvedValue(['p1', 'p2', 'p3']);
    mocks.addSeasonParticipants.mockResolvedValue(undefined);
    mocks.getResourceAdmins.mockResolvedValue([]);
  }

  it('reads the source phases once and creates them in order on the new league', async () => {
    seed();
    const t = tracker();

    const report = await copyLeagueStructure(created, source, resourceAdmin, { copyRoster: false, copyAdmins: false }, t);

    expect(mocks.getStagesBySeasonId).toHaveBeenCalledTimes(1);
    expect(mocks.getStagesBySeasonId).toHaveBeenCalledWith('src-1');
    expect(mocks.createTournament.mock.calls.map(([input]) => [input.name, input.season_id, input.stage_order])).toEqual([
      ['Groups', 'new-1', 1],
      ['Playoffs', 'new-1', 2],
    ]);
    expect(mocks.syncStandingsEnrollment.mock.calls).toEqual([
      ['new-1', 'new-ph-1'],
      ['new-1', 'new-ph-2'],
    ]);
    expect(report).toEqual({ source_id: 'src-1', phases: 2, participants: 0, admins: 0 });
    expect(t.phaseIds).toEqual(['new-ph-1', 'new-ph-2']);
  });

  it('does not copy the roster unless asked', async () => {
    seed();

    await copyLeagueStructure(created, source, resourceAdmin, { copyRoster: false, copyAdmins: false }, tracker());

    expect(mocks.listSeasonParticipantIds).not.toHaveBeenCalled();
    expect(mocks.addSeasonParticipants).not.toHaveBeenCalled();
  });

  it('copies the roster as player ids only, before the phases enrol', async () => {
    seed();
    const order: string[] = [];
    mocks.addSeasonParticipants.mockImplementation(async () => void order.push('roster'));
    mocks.syncStandingsEnrollment.mockImplementation(async () => void order.push('sync'));

    const report = await copyLeagueStructure(created, source, resourceAdmin, { copyRoster: true, copyAdmins: false }, tracker());

    expect(mocks.listSeasonParticipantIds).toHaveBeenCalledWith('src-1');
    expect(mocks.addSeasonParticipants).toHaveBeenCalledWith('new-1', ['p1', 'p2', 'p3']);
    expect(order).toEqual(['roster', 'sync', 'sync']);
    expect(report.participants).toBe(3);
  });

  it('skips the creator and duplicates when copying the league admins', async () => {
    seed();
    mocks.getResourceAdmins.mockResolvedValue([
      { player_id: 'admin-1' },
      { player_id: 'a2' },
      { player_id: 'a2' },
      { player_id: 'a3' },
    ]);
    const t = tracker(siteAdmin);

    const report = await copyLeagueStructure(created, source, siteAdmin, { copyRoster: false, copyAdmins: true }, t);

    expect(mocks.getResourceAdmins).toHaveBeenCalledWith('season', 'src-1');
    expect(mocks.addResourceAdmin.mock.calls).toEqual([
      ['a2', 'season', 'new-1'],
      ['a3', 'season', 'new-1'],
    ]);
    expect(t.adminGrants).toEqual(['a2', 'a3']);
    expect(report.admins).toBe(2);
  });

  it('does not read the league admins unless asked', async () => {
    seed();

    await copyLeagueStructure(created, source, siteAdmin, { copyRoster: false, copyAdmins: false }, tracker(siteAdmin));

    expect(mocks.getResourceAdmins).not.toHaveBeenCalled();
    expect(mocks.addResourceAdmin).not.toHaveBeenCalled();
  });

  it('expires the new league reads with the new phase ids and audits once', async () => {
    seed();

    await copyLeagueStructure(created, source, resourceAdmin, { copyRoster: true, copyAdmins: false }, tracker());

    expect(mocks.expireSeasonReads).toHaveBeenCalledWith('new-1', ['new-ph-1', 'new-ph-2']);
    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith({
      action: 'season.clone',
      actor_id: 'radmin-1',
      actor_name: 'Resource Admin',
      resource_type: 'season',
      resource_id: 'new-1',
      resource_name: 'Spring League',
      metadata: {
        source_id: 'src-1',
        source_name: 'Autumn League',
        phases: 2,
        participants: 3,
        admins: 0,
        copy_roster: true,
        copy_admins: false,
      },
    });
  });

  it('a point-buy source reads and copies none of its own data', async () => {
    seed();
    const pointBuySource = { ...source, format_type: 'evolution_point_buy', point_buy_list_id: 'list-1' } as Season;

    await copyLeagueStructure(created, pointBuySource, resourceAdmin, { copyRoster: true, copyAdmins: false }, tracker());

    expect(mocks.touched).toEqual([]);
    // Only the structure was written.
    expect(mocks.createTournament).toHaveBeenCalledTimes(2);
  });

  it('imports no point-buy list, draft, token, redraft, evolution or format-rules module', () => {
    const file = fs.readFileSync(path.resolve(__dirname, '../clone.ts'), 'utf8');
    const specifiers = [...file.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

    expect(specifiers.length).toBeGreaterThan(5);
    expect(specifiers.filter((s) => /draft|point-buy|token|redraft|evolution|format-rules/i.test(s))).toEqual([]);
  });
});

describe('rollbackClonedLeague', () => {
  it('a failure on the 2nd phase removes the 1st and the league, league last, and audits it', async () => {
    mocks.getStagesBySeasonId.mockResolvedValue([
      phase({ id: 'a', stage_order: 1 }),
      phase({ id: 'b', name: 'Playoffs', stage_order: 2 }),
    ]);
    mocks.listSeasonParticipantIds.mockResolvedValue(['p1', 'p2']);
    mocks.addSeasonParticipants.mockResolvedValue(undefined);
    mocks.createTournament.mockResolvedValueOnce({ id: 'new-ph-1' }).mockRejectedValueOnce(new Error('insert failed'));
    const calls: string[] = [];
    mocks.deleteTournament.mockImplementation(async (id: string) => void calls.push(`phase:${id}`));
    mocks.removeResourceAdmin.mockImplementation(async (id: string) => void calls.push(`admin:${id}`));
    mocks.deleteSeason.mockImplementation(async (id: string) => void calls.push(`season:${id}`));
    const t = tracker(resourceAdmin);
    t.creatorGrant = true;

    const err = await caught(
      copyLeagueStructure(created, source, resourceAdmin, { copyRoster: true, copyAdmins: false }, t).catch((cause) =>
        rollbackClonedLeague(t, cause),
      ),
    );

    expect(err.code).toBe('SEASON_CLONE_FAILED');
    expect(err.statusCode).toBe(500);
    expect(calls).toEqual(['phase:new-ph-1', 'admin:radmin-1', 'season:new-1']);
    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.clone_failed',
        resource_id: 'new-1',
        metadata: {
          source_id: 'src-1',
          step: 'phases',
          created: { phases: 1, participants: 2, admins: 0 },
          cleanup: 'complete',
        },
      }),
    );
    expect(console.error).toHaveBeenCalled();
  });

  it('removes the copied admin grants and the creator grant before deleting the league', async () => {
    const t = tracker(resourceAdmin);
    t.creatorGrant = true;
    t.adminGrants.push('a2', 'a3');
    t.phaseIds.push('ph-1', 'ph-2');
    const calls: string[] = [];
    mocks.deleteTournament.mockImplementation(async (id: string) => void calls.push(`phase:${id}`));
    mocks.removeResourceAdmin.mockImplementation(
      async (id: string, type: string, seasonId: string) => void calls.push(`admin:${id}:${type}:${seasonId}`),
    );
    mocks.deleteSeason.mockImplementation(async (id: string) => void calls.push(`season:${id}`));

    const err = await caught(rollbackClonedLeague(t, new Error('boom')));

    expect(err.code).toBe('SEASON_CLONE_FAILED');
    expect(calls).toEqual([
      'phase:ph-2',
      'phase:ph-1',
      'admin:a2:season:new-1',
      'admin:a3:season:new-1',
      'admin:radmin-1:season:new-1',
      'season:new-1',
    ]);
  });

  it('a site admin creator has no grant to remove', async () => {
    const t = tracker(siteAdmin);

    await caught(rollbackClonedLeague(t, new Error('boom')));

    expect(mocks.removeResourceAdmin).not.toHaveBeenCalled();
    expect(mocks.deleteSeason).toHaveBeenCalledWith('new-1');
  });

  it('a cleanup failure answers SEASON_CLONE_CLEANUP_FAILED with what remains, and logs both errors', async () => {
    const original = new Error('sync failed');
    const cleanup = new Error('delete failed');
    const t = tracker(resourceAdmin);
    t.step = 'enrollment';
    t.phaseIds.push('ph-1', 'ph-2');
    t.participants = 7;
    // The newest phase goes first: it is removed, the older one is not.
    mocks.deleteTournament.mockResolvedValueOnce(undefined).mockRejectedValueOnce(cleanup);

    const err = await caught(rollbackClonedLeague(t, original));

    expect(err.code).toBe('SEASON_CLONE_CLEANUP_FAILED');
    expect(err.statusCode).toBe(500);
    expect(err.params).toEqual({ league_id: 'new-1', phases: 1, participants: 7 });
    expect(mocks.deleteSeason).not.toHaveBeenCalled();
    const logged = vi.mocked(console.error).mock.calls.flat();
    expect(logged).toContain(original);
    expect(logged).toContain(cleanup);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.clone_failed',
        metadata: expect.objectContaining({ step: 'enrollment', cleanup: 'failed' }),
      }),
    );
  });

  it('a league that cannot be deleted is reported with its remaining roster', async () => {
    const t = tracker(siteAdmin);
    t.participants = 3;
    mocks.deleteSeason.mockRejectedValue(new Error('has dependents'));

    const err = await caught(rollbackClonedLeague(t, new Error('boom')));

    expect(err.code).toBe('SEASON_CLONE_CLEANUP_FAILED');
    expect(err.params).toEqual({ league_id: 'new-1', phases: 0, participants: 3 });
  });
});
