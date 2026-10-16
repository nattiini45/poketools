import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(),
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  handOverGroupRow: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getTournamentPairings: vi.fn(),
}));

vi.mock('@/lib/audit/queries', () => ({
  listAuditLogEntries: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '../route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import {
  getGroupsByTournament,
  handOverGroupRow,
} from '@/lib/supabase/queries/tournament-groups';
import { getTournamentPairings } from '@/lib/supabase/queries/matches';
import { listAuditLogEntries, type AuditLogRecord } from '@/lib/audit/queries';
import { logAuditEvent } from '@/lib/audit/log';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import { revalidateTag } from 'next/cache';
import type { TournamentGroupWithMembers } from '@/types/season';

const SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const OTHER_SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const PHASE_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a21';
const GROUP_A = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31';
const GROUP_B = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32';
/** Departed before the group handover; still holds the group A row. */
const DEPARTED_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
/** Their substitute: enrolled, no group row. */
const SUB_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const X_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const Z_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
/** A second departed player (group B row) and their substitute. */
const DEPARTED_2_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
const SUB_2_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';

/** The fixture's plan as the admin reviewed it: the apply body names it. */
const REVIEWED = [{ group_id: GROUP_A, from_player_id: DEPARTED_ID, to_player_id: SUB_ID }];
const APPLY = { dry_run: false, moves: REVIEWED };

function groupRow(id: string, groupNumber: number, members: [string, string][]): TournamentGroupWithMembers {
  return {
    id,
    tournament_id: PHASE_ID,
    name: `Group ${groupNumber === 1 ? 'A' : 'B'}`,
    group_number: groupNumber,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    members: members.map(([playerId, name], index) => ({
      player_id: playerId,
      player_name: name,
      seed: index + 1,
      gym_type: null,
    })),
  };
}

function substituteEntry(id: string, out: string, into: string, createdAt: string): AuditLogRecord {
  return {
    id,
    actor_id: 'admin-1',
    actor_name: 'Admin',
    action: 'season.participant.substitute',
    resource_type: 'season',
    resource_id: SEASON_ID,
    resource_name: null,
    changes: { out_player_id: { before: out, after: into } },
    metadata: { scope: 'league', phases_updated: 1, matches_repaired: 2 },
    ip_address: null,
    created_at: createdAt,
  };
}

function post(body: Record<string, unknown>, phaseId = PHASE_ID) {
  return POST(makeRequest(body), { params: makeParams({ id: SEASON_ID, phaseId }) });
}

describe('POST /api/seasons/[id]/phases/[phaseId]/groups/repair', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE_ID, season_id: SEASON_ID } as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      groupRow(GROUP_A, 1, [[DEPARTED_ID, 'Departed'], [X_ID, 'Xena']]),
      groupRow(GROUP_B, 2, [[Z_ID, 'Zed']]),
    ]);
    // Full player rows, as `getParticipants` returns them: the response must
    // carry ids and names only.
    vi.mocked(getParticipants).mockResolvedValue([
      { ...fullPlayerRow({ id: SUB_ID, name: 'Sub' }), seed: 1, starting_bracket: 'winners' },
      { ...fullPlayerRow({ id: X_ID, name: 'Xena' }), seed: 2, starting_bracket: 'winners' },
      { ...fullPlayerRow({ id: Z_ID, name: 'Zed' }), seed: 3, starting_bracket: 'winners' },
    ]);
    vi.mocked(listAuditLogEntries).mockResolvedValue({
      entries: [substituteEntry('audit-1', DEPARTED_ID, SUB_ID, '2026-09-01T10:00:00.000000+00:00')],
      total: 1,
      limit: 100,
      offset: 0,
    });
    vi.mocked(getTournamentPairings).mockResolvedValue({ pairings: [], truncated: false });
    // Each move lands as planned: the target ends with the one planned row.
    vi.mocked(handOverGroupRow).mockImplementation(async (_phaseId, groupId) => ({
      written: true,
      held_group_ids: [groupId],
    }));
    // safeErrorResponse logs server-side.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('requires a season admin and reads nothing without one', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const res = await post({ dry_run: true });

    expect(res.status).toBe(403);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
    expect(getTournamentById).not.toHaveBeenCalled();
    expect(getGroupsByTournament).not.toHaveBeenCalled();
  });

  it.each([
    ['no dry_run', {}],
    ['a non-boolean dry_run', { dry_run: 'false' }],
    ['an apply that names no reviewed moves', { dry_run: false }],
    [
      'a reviewed move with a malformed id',
      { dry_run: false, moves: [{ ...REVIEWED[0], to_player_id: 'not-a-uuid' }] },
    ],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post(body);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('validation_failed');
    expect(getGroupsByTournament).not.toHaveBeenCalled();
    expect(handOverGroupRow).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const request = makeRequest({});
    vi.mocked(request.json).mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));

    const res = await POST(request, { params: makeParams({ id: SEASON_ID, phaseId: PHASE_ID }) });

    expect(res.status).toBe(400);
    expect(handOverGroupRow).not.toHaveBeenCalled();
  });

  it.each([
    ['does not exist', null],
    ['belongs to another league', { id: PHASE_ID, season_id: OTHER_SEASON_ID }],
  ])('returns 404 when the phase %s', async (_label, phase) => {
    vi.mocked(getTournamentById).mockResolvedValue(phase as never);

    const res = await post(APPLY);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.code).toBe('PHASE_NOT_FOUND');
    expect(getGroupsByTournament).not.toHaveBeenCalled();
    expect(handOverGroupRow).not.toHaveBeenCalled();
  });

  it('returns the plan of a dry run and writes nothing', async () => {
    const res = await post({ dry_run: true });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      grouped: true,
      moves: [
        {
          group_id: GROUP_A,
          group_name: 'Group A',
          from_player_id: DEPARTED_ID,
          from_player_name: 'Departed',
          to_player_id: SUB_ID,
          to_player_name: 'Sub',
          basis: 'audit',
        },
      ],
      unresolved: { orphaned_rows: [], ungrouped_players: [] },
      applied: false,
      history: { substitutions: 1, unreadable: 0, truncated: false },
      fixtures: { matches: 0, truncated: false },
    });
    expectNoPrivatePlayerData(json);
    expect(handOverGroupRow).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("reads the season's substitution records only", async () => {
    await post({ dry_run: true });

    expect(listAuditLogEntries).toHaveBeenCalledWith({
      action: 'season.participant.substitute',
      resource_type: 'season',
      resource_id: SEASON_ID,
      limit: 100,
      offset: 0,
    });
    expect(getParticipants).toHaveBeenCalledWith(PHASE_ID);
    expect(getTournamentPairings).toHaveBeenCalledWith(PHASE_ID);
  });

  it('pages through the substitution records until the total, skipping repeats and unreadable entries', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      substituteEntry(`audit-new-${index}`, `gone-${index}`, `in-${index}`, '2026-09-20T10:00:00Z'),
    );
    vi.mocked(listAuditLogEntries)
      .mockResolvedValueOnce({ entries: firstPage, total: 102, limit: 100, offset: 0 })
      .mockResolvedValueOnce({
        entries: [
          // Recorded while paging: the pages shifted, so this one repeats.
          firstPage[99],
          substituteEntry('audit-1', DEPARTED_ID, SUB_ID, '2026-09-01T10:00:00Z'),
          { ...substituteEntry('audit-0', DEPARTED_ID, SUB_ID, '2026-08-01T10:00:00Z'), metadata: null },
        ],
        total: 103,
        limit: 100,
        offset: 100,
      });

    const res = await post({ dry_run: true });
    const json = await res.json();

    expect(listAuditLogEntries).toHaveBeenCalledTimes(2);
    expect(listAuditLogEntries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, offset: 100 }));
    expect(json.data.history).toEqual({ substitutions: 101, unreadable: 1, truncated: false });
    expect(json.data.moves).toEqual([expect.objectContaining({ from_player_id: DEPARTED_ID, to_player_id: SUB_ID })]);
  });

  it('stops paging at its bound and says the history is truncated', async () => {
    vi.mocked(listAuditLogEntries).mockImplementation(async ({ offset }) => ({
      entries: Array.from({ length: 100 }, (_, index) =>
        substituteEntry(`audit-${offset + index}`, `gone-${offset + index}`, `in-${offset + index}`, '2026-09-20T10:00:00Z'),
      ),
      total: 5000,
      limit: 100,
      offset,
    }));

    const res = await post({ dry_run: true });
    const json = await res.json();

    expect(listAuditLogEntries).toHaveBeenCalledTimes(20);
    expect(json.data.history).toEqual({ substitutions: 2000, unreadable: 0, truncated: true });
  });

  it('applies each move with one group-row handover, expires the reads and records the repair', async () => {
    const res = await post(APPLY);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.applied).toBe(true);
    expect(handOverGroupRow).toHaveBeenCalledTimes(1);
    expect(handOverGroupRow).toHaveBeenCalledWith(PHASE_ID, GROUP_A, DEPARTED_ID, SUB_ID);
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE_ID}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON_ID}`, { expire: 0 });
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.phase.groups.repair',
      resource_type: 'season',
      resource_id: SEASON_ID,
      metadata: {
        phase_id: PHASE_ID,
        moves: [{ group_id: GROUP_A, from_player_id: DEPARTED_ID, to_player_id: SUB_ID, basis: 'audit' }],
      },
    });
    expectNoPrivatePlayerData(json);
  });

  it('applies moves paired from the fixtures when the audit record is missing', async () => {
    vi.mocked(listAuditLogEntries).mockResolvedValue({ entries: [], total: 0, limit: 100, offset: 0 });
    vi.mocked(getTournamentPairings).mockResolvedValue({
      pairings: [{ player_1_id: SUB_ID, player_2_id: X_ID }],
      truncated: false,
    });

    const res = await post(APPLY);
    const json = await res.json();

    expect(json.data.moves).toEqual([expect.objectContaining({ basis: 'fixtures', to_player_id: SUB_ID })]);
    expect(json.data.fixtures).toEqual({ matches: 1, truncated: false });
    expect(handOverGroupRow).toHaveBeenCalledWith(PHASE_ID, GROUP_A, DEPARTED_ID, SUB_ID);
  });

  it('applies the reviewed moves in any order', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      groupRow(GROUP_A, 1, [[DEPARTED_ID, 'Departed'], [X_ID, 'Xena']]),
      groupRow(GROUP_B, 2, [[DEPARTED_2_ID, 'Departed Two'], [Z_ID, 'Zed']]),
    ]);
    vi.mocked(getParticipants).mockResolvedValue([
      { ...fullPlayerRow({ id: SUB_ID, name: 'Sub' }), seed: 1, starting_bracket: 'winners' },
      { ...fullPlayerRow({ id: SUB_2_ID, name: 'Sub Two' }), seed: 2, starting_bracket: 'winners' },
      { ...fullPlayerRow({ id: X_ID, name: 'Xena' }), seed: 3, starting_bracket: 'winners' },
      { ...fullPlayerRow({ id: Z_ID, name: 'Zed' }), seed: 4, starting_bracket: 'winners' },
    ]);
    vi.mocked(listAuditLogEntries).mockResolvedValue({
      entries: [
        substituteEntry('audit-2', DEPARTED_2_ID, SUB_2_ID, '2026-09-02T10:00:00Z'),
        substituteEntry('audit-1', DEPARTED_ID, SUB_ID, '2026-09-01T10:00:00Z'),
      ],
      total: 2,
      limit: 100,
      offset: 0,
    });
    const res = await post({
      dry_run: false,
      moves: [{ group_id: GROUP_B, from_player_id: DEPARTED_2_ID, to_player_id: SUB_2_ID }, ...REVIEWED],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.applied).toBe(true);
    expect(handOverGroupRow).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'names another target than the fresh plan',
      [{ ...REVIEWED[0], to_player_id: X_ID }],
    ],
    ['misses a move the fresh plan makes', []],
    [
      'names a move the fresh plan no longer makes',
      [...REVIEWED, { group_id: GROUP_B, from_player_id: Z_ID, to_player_id: SUB_2_ID }],
    ],
  ])('writes nothing and returns 409 PLAN_CHANGED when the reviewed plan %s', async (_label, moves) => {
    const res = await post({ dry_run: false, moves });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PLAN_CHANGED');
    expect(handOverGroupRow).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('writes, expires and records nothing when there is nothing to move', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      groupRow(GROUP_A, 1, [[SUB_ID, 'Sub'], [X_ID, 'Xena']]),
      groupRow(GROUP_B, 2, [[Z_ID, 'Zed']]),
    ]);

    const res = await post({ dry_run: false, moves: [] });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.applied).toBe(false);
    expect(json.data.moves).toEqual([]);
    expect(handOverGroupRow).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('reads nothing past the groups in a phase without groups', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);

    const res = await post({ dry_run: false, moves: [] });
    const json = await res.json();

    expect(json.data).toEqual(expect.objectContaining({ grouped: false, moves: [], applied: false }));
    expect(getParticipants).not.toHaveBeenCalled();
    expect(listAuditLogEntries).not.toHaveBeenCalled();
    expect(getTournamentPairings).not.toHaveBeenCalled();
    expect(handOverGroupRow).not.toHaveBeenCalled();
  });

  it('returns 409 PLAN_CHANGED when the groups were cleared since the check', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);

    const res = await post(APPLY);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('PLAN_CHANGED');
    expect(handOverGroupRow).not.toHaveBeenCalled();
  });

  describe('a failed apply', () => {
    /** Two planned moves: group A's row to Sub, then group B's to Sub Two. */
    const TWO_MOVES = [
      ...REVIEWED,
      { group_id: GROUP_B, from_player_id: DEPARTED_2_ID, to_player_id: SUB_2_ID },
    ];

    function twoMovePhase() {
      vi.mocked(getGroupsByTournament).mockResolvedValue([
        groupRow(GROUP_A, 1, [[DEPARTED_ID, 'Departed'], [X_ID, 'Xena']]),
        groupRow(GROUP_B, 2, [[DEPARTED_2_ID, 'Departed Two'], [Z_ID, 'Zed']]),
      ]);
      vi.mocked(getParticipants).mockResolvedValue([
        { ...fullPlayerRow({ id: SUB_ID, name: 'Sub' }), seed: 1, starting_bracket: 'winners' },
        { ...fullPlayerRow({ id: SUB_2_ID, name: 'Sub Two' }), seed: 2, starting_bracket: 'winners' },
        { ...fullPlayerRow({ id: X_ID, name: 'Xena' }), seed: 3, starting_bracket: 'winners' },
        { ...fullPlayerRow({ id: Z_ID, name: 'Zed' }), seed: 4, starting_bracket: 'winners' },
      ]);
      vi.mocked(listAuditLogEntries).mockResolvedValue({
        entries: [
          substituteEntry('audit-2', DEPARTED_2_ID, SUB_2_ID, '2026-09-02T10:00:00Z'),
          substituteEntry('audit-1', DEPARTED_ID, SUB_ID, '2026-09-01T10:00:00Z'),
        ],
        total: 2,
        limit: 100,
        offset: 0,
      });
    }

    /** The landed first move, as the audit records it. */
    const FIRST_MOVE_AUDIT = { group_id: GROUP_A, from_player_id: DEPARTED_ID, to_player_id: SUB_ID, basis: 'audit' };
    const SECOND_MOVE_AUDIT = { group_id: GROUP_B, from_player_id: DEPARTED_2_ID, to_player_id: SUB_2_ID, basis: 'audit' };

    it('records the moves that landed before an unexpected error, as a partial repair', async () => {
      twoMovePhase();
      vi.mocked(handOverGroupRow)
        .mockResolvedValueOnce({ written: true, held_group_ids: [GROUP_A] })
        .mockRejectedValueOnce(new Error('connection reset'));

      const res = await post({ dry_run: false, moves: TWO_MOVES });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: 'Failed to repair phase groups' });
      expect(handOverGroupRow).toHaveBeenCalledTimes(2);
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE_ID}`, { expire: 0 });
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'season.phase.groups.repair',
        resource_type: 'season',
        resource_id: SEASON_ID,
        metadata: {
          phase_id: PHASE_ID,
          moves: [FIRST_MOVE_AUDIT],
          partial: true,
          failure_code: null,
          stopped_at: { ...SECOND_MOVE_AUDIT, written: false, held_group_ids: [] },
        },
      });
    });

    it('stops with 409 PLAN_CHANGED when a later move finds its row gone, and records only the landed moves', async () => {
      twoMovePhase();
      vi.mocked(handOverGroupRow)
        .mockResolvedValueOnce({ written: true, held_group_ids: [GROUP_A] })
        .mockResolvedValueOnce({ written: false, reason: 'row_gone' });

      const res = await post({ dry_run: false, moves: TWO_MOVES });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('PLAN_CHANGED');
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.phase.groups.repair',
          metadata: {
            phase_id: PHASE_ID,
            moves: [FIRST_MOVE_AUDIT],
            partial: true,
            failure_code: 'PLAN_CHANGED',
            stopped_at: { ...SECOND_MOVE_AUDIT, written: false, held_group_ids: [] },
          },
        }),
      );
    });

    it('a second apply of the same plan that lost the race writes nothing and records nothing', async () => {
      // The first apply handed the row over between this one's plan and its write.
      vi.mocked(handOverGroupRow).mockResolvedValue({ written: false, reason: 'row_gone' });

      const res = await post(APPLY);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('PLAN_CHANGED');
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE_ID}`, { expire: 0 });
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('writes nothing for a target placed in a group meanwhile (no row is deleted)', async () => {
      vi.mocked(handOverGroupRow).mockResolvedValue({
        written: false,
        reason: 'target_grouped',
        held_group_ids: [GROUP_B],
      });

      const res = await post(APPLY);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('PLAN_CHANGED');
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('records a move that landed while the target was placed in another group meanwhile (two rows)', async () => {
      vi.mocked(handOverGroupRow).mockResolvedValue({ written: true, held_group_ids: [GROUP_A, GROUP_B] });

      const res = await post(APPLY);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('GROUP_SLOT_CHANGED');
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            moves: [],
            partial: true,
            failure_code: 'GROUP_SLOT_CHANGED',
            stopped_at: { ...FIRST_MOVE_AUDIT, written: true, held_group_ids: [GROUP_A, GROUP_B] },
          }),
        }),
      );
    });

    it('returns the fallback for an unexpected error and still expires the reads', async () => {
      vi.mocked(handOverGroupRow).mockRejectedValue(new Error('connection reset'));

      const res = await post(APPLY);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: 'Failed to repair phase groups' });
      expect(consoleError).toHaveBeenCalled();
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${PHASE_ID}`, { expire: 0 });
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('keeps the original error and still records the partial repair when the read-cache expiry throws', async () => {
      twoMovePhase();
      vi.mocked(handOverGroupRow)
        .mockResolvedValueOnce({ written: true, held_group_ids: [GROUP_A] })
        .mockResolvedValueOnce({ written: false, reason: 'row_gone' });
      const expireError = new Error('revalidateTag failed');
      vi.mocked(revalidateTag).mockImplementationOnce(() => {
        throw expireError;
      });

      const res = await post({ dry_run: false, moves: TWO_MOVES });
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('PLAN_CHANGED');
      expect(consoleError).toHaveBeenCalledWith(
        '[groups/repair] read-cache expiry after a failed apply failed:',
        expireError,
      );
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ partial: true, moves: [FIRST_MOVE_AUDIT] }) }),
      );
    });

    it('discloses a fixture read that stopped at its bound', async () => {
      vi.mocked(getTournamentPairings).mockResolvedValue({ pairings: [], truncated: true });

      const res = await post({ dry_run: true });
      const json = await res.json();

      expect(json.data.fixtures).toEqual({ matches: 0, truncated: true });
    });

    it('passes the phases a substitution record names to the planner', async () => {
      // The record names another phase only: it does not tie Departed to Sub here.
      vi.mocked(listAuditLogEntries).mockResolvedValue({
        entries: [
          {
            ...substituteEntry('audit-1', DEPARTED_ID, SUB_ID, '2026-09-01T10:00:00Z'),
            metadata: { scope: 'league', phase_ids: ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a29'] },
          },
        ],
        total: 1,
        limit: 100,
        offset: 0,
      });

      const res = await post({ dry_run: true });
      const json = await res.json();

      expect(json.data.moves).toEqual([]);
    });

    it('expires nothing when a dry run fails', async () => {
      vi.mocked(getTournamentPairings).mockRejectedValue(new Error('timeout'));

      const res = await post({ dry_run: true });

      expect(res.status).toBe(500);
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('expires and records nothing when an apply fails before its first write', async () => {
      vi.mocked(getTournamentPairings).mockRejectedValue(new Error('timeout'));

      const res = await post(APPLY);

      expect(res.status).toBe(500);
      expect(handOverGroupRow).not.toHaveBeenCalled();
      expect(revalidateTag).not.toHaveBeenCalled();
      expect(logAuditEvent).not.toHaveBeenCalled();
    });
  });
});
