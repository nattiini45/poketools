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

// The apply-log helpers stay real: the route records what the log holds.
vi.mock('@/lib/season/substitute', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/season/substitute')>()),
  substituteParticipant: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

// A failed apply reads the season's stages to expire their reads too.
vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
}));

import { POST } from '../route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { substituteParticipant, type SubstituteInput } from '@/lib/season/substitute';
import { logAuditEvent } from '@/lib/audit/log';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { revalidateTag } from 'next/cache';

const SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const OUT_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const IN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const STAGE_1_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a21';
const STAGE_2_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

/** The error a resumable apply throws when a group slot moved mid-run. */
function slotChangedError() {
  return new UserFacingError('The group changed during the substitution; run it again', {
    code: 'GROUP_SLOT_CHANGED',
    status: 409,
  });
}

function post(dryRun: boolean) {
  return POST(
    makeRequest({
      out_player_id: OUT_ID,
      in_player_id: IN_ID,
      scope: 'league',
      dry_run: dryRun,
    }),
    { params: makeParams({ id: SEASON_ID }) },
  );
}

const previewSummary = {
  roster_swapped: true,
  phases: [],
  affected_matches: [],
  matches_repaired: 0,
  matches_skipped: [],
};

describe('POST /api/seasons/[id]/participants/substitute', () => {
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
    } as never);
    vi.mocked(substituteParticipant).mockResolvedValue(previewSummary);
    vi.mocked(getStagesBySeasonId).mockResolvedValue([
      { id: STAGE_1_ID },
      { id: STAGE_2_ID },
    ] as never);
    // safeErrorResponse and the expiry fallback log server-side.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('returns dry-run preview without audit log', async () => {
    const res = await POST(
      makeRequest({
        out_player_id: OUT_ID,
        in_player_id: IN_ID,
        scope: 'league',
        dry_run: true,
      }),
      { params: makeParams({ id: SEASON_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(substituteParticipant).toHaveBeenCalledWith({
      seasonId: SEASON_ID,
      outPlayerId: OUT_ID,
      inPlayerId: IN_ID,
      scope: 'league',
      dryRun: true,
      log: expect.any(Object),
    });
    expect(logAuditEvent).not.toHaveBeenCalled();
    // A preview writes nothing, so it expires nothing.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('commits substitute and records audit log', async () => {
    const res = await POST(
      makeRequest({
        out_player_id: OUT_ID,
        in_player_id: IN_ID,
        scope: 'league',
        dry_run: false,
      }),
      { params: makeParams({ id: SEASON_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.participant.substitute' }),
    );
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON_ID}`, { expire: 0 });
    // A successful apply expires the phases its summary names; it reads no stages.
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
  });

  describe('a failed apply', () => {
    it("expires the season and every stage's reads, then returns the substitution's error", async () => {
      vi.mocked(substituteParticipant).mockRejectedValue(slotChangedError());

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(409);
      // Nothing was written: the partial signal says so exactly.
      expect(json).toEqual({
        success: false,
        error: 'The group changed during the substitution; run it again',
        code: 'GROUP_SLOT_CHANGED',
        partial: null,
      });

      expect(getStagesBySeasonId).toHaveBeenCalledTimes(1);
      expect(getStagesBySeasonId).toHaveBeenCalledWith(SEASON_ID);
      expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON_ID}`, { expire: 0 });
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE_1_ID}`, { expire: 0 });
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE_2_ID}`, { expire: 0 });

      // A failed apply that wrote nothing records no audit event.
      expect(logAuditEvent).not.toHaveBeenCalled();
    });

    it('records the steps that landed before the failure as a partial substitution, with the step it stopped at', async () => {
      vi.mocked(substituteParticipant).mockImplementation(async (input: SubstituteInput) => {
        const log = input.log!;
        log.proposals_cancelled.push('match-1');
        log.matches_repaired.push('match-1');
        log.groups_handed_over.push({ phase_id: STAGE_1_ID, group_id: 'group-1' });
        log.enrollments_swapped.push(STAGE_1_ID);
        log.groups_handed_over.push({ phase_id: STAGE_2_ID, group_id: null });
        log.phases_touched.push(STAGE_1_ID, STAGE_2_ID);
        log.stopped_at = { step: 'enrollment', phase_id: STAGE_2_ID, match_id: null };
        throw slotChangedError();
      });

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(409);
      // The response carries the error, its code and exactly what was written.
      expect(json).toEqual({
        success: false,
        error: 'The group changed during the substitution; run it again',
        code: 'GROUP_SLOT_CHANGED',
        partial: {
          written: {
            proposals_cancelled: ['match-1'],
            matches_repaired: ['match-1'],
            matches_skipped: [],
            groups_handed_over: [
              { phase_id: STAGE_1_ID, group_id: 'group-1' },
              { phase_id: STAGE_2_ID, group_id: null },
            ],
            enrollments_swapped: [STAGE_1_ID],
            roster_swapped: false,
          },
          phase_ids: [STAGE_1_ID, STAGE_2_ID],
          stopped_at: { step: 'enrollment', phase_id: STAGE_2_ID, match_id: null },
        },
      });
      expect(logAuditEvent).toHaveBeenCalledTimes(1);
      expect(logAuditEvent).toHaveBeenCalledWith({
        actor_id: 'admin-1',
        actor_name: 'Admin',
        action: 'season.participant.substitute',
        resource_type: 'season',
        resource_id: SEASON_ID,
        changes: { out_player_id: { before: OUT_ID, after: IN_ID } },
        metadata: {
          scope: 'league',
          partial: true,
          failure_code: 'GROUP_SLOT_CHANGED',
          phase_ids: [STAGE_1_ID, STAGE_2_ID],
          written: {
            proposals_cancelled: ['match-1'],
            matches_repaired: ['match-1'],
            matches_skipped: [],
            groups_handed_over: [
              { phase_id: STAGE_1_ID, group_id: 'group-1' },
              { phase_id: STAGE_2_ID, group_id: null },
            ],
            enrollments_swapped: [STAGE_1_ID],
            roster_swapped: false,
          },
          stopped_at: { step: 'enrollment', phase_id: STAGE_2_ID, match_id: null },
        },
      });
      // The expiry still runs, before the audit.
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE_2_ID}`, { expire: 0 });
    });

    it('records a partial substitution after an unexpected error with a null failure code', async () => {
      vi.mocked(substituteParticipant).mockImplementation(async (input: SubstituteInput) => {
        input.log!.proposals_cancelled.push('match-1');
        input.log!.stopped_at = { step: 'match', phase_id: STAGE_1_ID, match_id: 'match-1' };
        throw new Error('connection reset');
      });

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(500);
      // The static fallback message, still with the partial signal.
      expect(json).toEqual({
        success: false,
        error: 'Failed to substitute participant',
        partial: {
          written: {
            proposals_cancelled: ['match-1'],
            matches_repaired: [],
            matches_skipped: [],
            groups_handed_over: [],
            enrollments_swapped: [],
            roster_swapped: false,
          },
          phase_ids: [],
          stopped_at: { step: 'match', phase_id: STAGE_1_ID, match_id: 'match-1' },
        },
      });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ partial: true, failure_code: null, phase_ids: [] }),
        }),
      );
    });

    it('still records the partial substitution when the read-cache expiry fails', async () => {
      vi.mocked(getStagesBySeasonId).mockRejectedValue(new Error('stages read failed'));
      vi.mocked(substituteParticipant).mockImplementation(async (input: SubstituteInput) => {
        input.log!.roster_swapped = true;
        throw slotChangedError();
      });

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.partial).toMatchObject({ written: { roster_swapped: true } });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ partial: true }) }),
      );
    });

    it('still expires the reads when the error is not user-facing (generic 500)', async () => {
      vi.mocked(substituteParticipant).mockRejectedValue(new Error('connection reset'));

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: 'Failed to substitute participant', partial: null });
      expect(getStagesBySeasonId).toHaveBeenCalledWith(SEASON_ID);
      expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON_ID}`, { expire: 0 });
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE_1_ID}`, { expire: 0 });
      expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE_2_ID}`, { expire: 0 });
    });

    it('logs an expiry failure and still returns the original error', async () => {
      const stagesError = new Error('stages read failed');
      vi.mocked(substituteParticipant).mockRejectedValue(slotChangedError());
      vi.mocked(getStagesBySeasonId).mockRejectedValue(stagesError);

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json).toEqual({
        success: false,
        error: 'The group changed during the substitution; run it again',
        code: 'GROUP_SLOT_CHANGED',
        partial: null,
      });
      expect(consoleError).toHaveBeenCalledWith(
        '[substitute] read-cache expiry after a failed apply failed:',
        stagesError,
      );
      expect(revalidateTag).not.toHaveBeenCalled();
    });

    it('logs a tag-expiry failure and still returns the original error', async () => {
      const expireError = new Error('revalidateTag failed');
      vi.mocked(substituteParticipant).mockRejectedValue(slotChangedError());
      vi.mocked(revalidateTag).mockImplementationOnce(() => {
        throw expireError;
      });

      const res = await post(false);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('GROUP_SLOT_CHANGED');
      expect(consoleError).toHaveBeenCalledWith(
        '[substitute] read-cache expiry after a failed apply failed:',
        expireError,
      );
    });
  });

  it('records the phases and group rows a completed apply handed over, and the matches it skipped', async () => {
    vi.mocked(substituteParticipant).mockImplementation(async (input: SubstituteInput) => {
      input.log!.groups_handed_over.push(
        { phase_id: STAGE_1_ID, group_id: 'group-1' },
        { phase_id: STAGE_2_ID, group_id: null },
      );
      return {
        roster_swapped: true,
        phases: [
          { phase_id: STAGE_1_ID, phase_name: 'Groups', seed: 2, group: { id: 'group-1', name: 'Group A' } },
          { phase_id: STAGE_2_ID, phase_name: 'Playoffs', seed: 2, group: null },
        ],
        affected_matches: [],
        matches_repaired: 3,
        matches_skipped: [
          {
            match_id: 'match-9',
            tournament_id: STAGE_1_ID,
            tournament_name: 'Groups',
            round_id: 'round-1',
            player_1_id: OUT_ID,
            player_2_id: 'x',
            player_1_name: 'Out',
            player_2_name: 'X',
            reason: 'has_games',
          },
        ],
      };
    });

    const res = await post(false);

    expect(res.status).toBe(200);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'admin-1',
      actor_name: 'Admin',
      action: 'season.participant.substitute',
      resource_type: 'season',
      resource_id: SEASON_ID,
      changes: { out_player_id: { before: OUT_ID, after: IN_ID } },
      metadata: {
        scope: 'league',
        phases_updated: 2,
        matches_repaired: 3,
        phase_ids: [STAGE_1_ID, STAGE_2_ID],
        groups: [{ phase_id: STAGE_1_ID, group_id: 'group-1' }],
        matches_skipped: [{ match_id: 'match-9', reason: 'has_games' }],
      },
    });
  });

  it('passes a closed league through as 409 SEASON_CLOSED and records nothing', async () => {
    vi.mocked(substituteParticipant).mockRejectedValue(
      new UserFacingError('The league is completed; its roster can no longer be substituted', {
        code: 'SEASON_CLOSED',
        status: 409,
      }),
    );

    const res = await post(false);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('SEASON_CLOSED');
    expect(json.partial).toBeNull();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('returns partial: null for an apply that ran steps but wrote nothing (a lost race)', async () => {
    vi.mocked(substituteParticipant).mockImplementation(async (input: SubstituteInput) => {
      // Its match was re-paired meanwhile and nothing else landed.
      input.log!.matches_skipped.push('match-1');
      input.log!.stopped_at = { step: 'enrollment', phase_id: STAGE_1_ID, match_id: null };
      throw new UserFacingError('Outgoing player is no longer enrolled in Groups', {
        code: 'ENROLLMENT_CHANGED',
        status: 409,
      });
    });

    const res = await post(false);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({ code: 'ENROLLMENT_CHANGED', partial: null });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('a failed dry run expires nothing and returns its error', async () => {
    vi.mocked(substituteParticipant).mockRejectedValue(
      new UserFacingError('Outgoing player is not on the league roster', {
        code: 'OUT_NOT_ON_ROSTER',
      }),
    );

    const res = await post(true);
    const json = await res.json();

    expect(res.status).toBe(400);
    // A preview writes nothing, so it carries no partial signal.
    expect(json).toEqual({
      success: false,
      error: 'Outgoing player is not on the league roster',
      code: 'OUT_NOT_ON_ROSTER',
    });
    expect(getStagesBySeasonId).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads', async () => {
    const res = await POST(
      makeRequest({ out_player_id: 'bad', in_player_id: IN_ID, scope: 'league' }),
      { params: makeParams({ id: SEASON_ID }) },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: json.error });
    // Rejected before the substitution ran: no partial field.
    expect(json).not.toHaveProperty('partial');
    expect(substituteParticipant).not.toHaveBeenCalled();
  });
});
