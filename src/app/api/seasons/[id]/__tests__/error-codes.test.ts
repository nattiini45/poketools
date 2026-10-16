/**
 * Error codes of the non-draft season routes that have no route test of
 * their own (i18n-core §4.1, package A5): each failure branch answers with
 * its English `error` unchanged plus a `code` from `errors/seasons` or
 * `errors/common` (and `params` for templated messages), so the client can
 * show it in the viewer's language.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  expireSeasonReads: vi.fn(),
  expireTournamentReads: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
  diffField: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getCorePool: vi.fn(),
  getSeasonParticipants: vi.fn(),
  setCorePool: vi.fn(),
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
  upsertFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getStagesBySeasonId: vi.fn(),
  reorderPhases: vi.fn(),
  getTournamentById: vi.fn(),
  getTournamentWithDetails: vi.fn(),
  updateTournament: vi.fn(),
  deleteTournament: vi.fn(),
  getParticipants: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  updateParticipantSeeds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
  createGroupBatch: vi.fn(),
  deleteGroupsByTournament: vi.fn(),
  addGroupMembersBatch: vi.fn(),
  moveGroupMember: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/ratings', () => ({
  getPlayerRatingsBatch: vi.fn(),
}));

vi.mock('@/lib/tournament/league-phase', () => ({
  buildLeaguePhase: vi.fn(),
  assertPhaseEditable: vi.fn(),
}));

vi.mock('@/lib/tournament/enrollment-sync', () => ({
  syncStandingsEnrollment: vi.fn(),
}));

vi.mock('@/lib/reconcile/entity-delete-rebuild', () => ({
  rebuildAfterTournamentDelete: vi.fn(),
}));

import { PATCH as patchCores } from '../cores/route';
import { PUT as putFormatRules } from '../format-rules/route';
import { POST as reorderPhases } from '../phases/reorder/route';
import { GET as getPhase, PATCH as patchPhase, DELETE as deletePhase } from '../phases/[phaseId]/route';
import { POST as createGroups } from '../phases/[phaseId]/groups/route';
import { PATCH as moveGroupMember } from '../phases/[phaseId]/groups/members/route';
import { PATCH as patchPhaseSeeds } from '../phases/[phaseId]/participants/route';
import { POST as seedByRating } from '../phases/[phaseId]/participants/seed-by-rating/route';
import { POST as syncStandings } from '../phases/[phaseId]/participants/sync-standings/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById, setCorePool } from '@/lib/supabase/queries/seasons';
import { upsertFormatRules } from '@/lib/supabase/queries/format-rules';
import {
  getParticipants,
  getTournamentById,
  getTournamentWithDetails,
  reorderPhases as reorderPhasesQuery,
  updateParticipantSeeds,
  updateTournament,
  deleteTournament,
} from '@/lib/supabase/queries/tournaments';
import { createGroupBatch, moveGroupMember as moveGroupMemberQuery } from '@/lib/supabase/queries/tournament-groups';
import { syncStandingsEnrollment } from '@/lib/tournament/enrollment-sync';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';

const SEASON_ID = 's1';
const PHASE_ID = 'phase-1';
const P1 = '00000000-0000-4000-8000-000000000001';
const P2 = '00000000-0000-4000-8000-000000000002';
const G1 = '00000000-0000-4000-8000-000000000011';
const G2 = '00000000-0000-4000-8000-000000000012';

const seasonArgs = { params: makeParams({ id: SEASON_ID }) };
const phaseArgs = () => ({ params: makeParams({ id: SEASON_ID, phaseId: PHASE_ID }) });

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** A `validation_failed` answer: the issues are the English error and its only param. */
async function expectValidationFailed(response: Response) {
  const json = await body(response);
  expect(response.status).toBe(400);
  expect(json.success).toBe(false);
  expect(json.code).toBe('validation_failed');
  expect(json.params).toEqual({ issues: json.error });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue({
    playerId: 'admin-1',
    name: 'Admin',
    isAdmin: true,
    isResourceAdmin: true,
    isCreator: false,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  });
  vi.mocked(getTournamentById).mockResolvedValue({
    id: PHASE_ID,
    season_id: SEASON_ID,
    status: 'upcoming',
  } as never);
});

describe('PATCH /api/seasons/[id]/cores', () => {
  it('rejects a body without core_pool with validation_failed', async () => {
    await expectValidationFailed(await patchCores(makeRequest({}) as NextRequest, seasonArgs));
    expect(setCorePool).not.toHaveBeenCalled();
  });
});

describe('PUT /api/seasons/[id]/format-rules', () => {
  it('keeps its English "Validation failed: …" text and adds validation_failed with the issues', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'evolution_point_buy' } as never);

    const response = await putFormatRules(
      makeRequest({ banned_moves: 'Spore' }) as NextRequest,
      seasonArgs,
    );
    const json = await body(response);

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/^Validation failed: /);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toBe(`Validation failed: ${(json.params as { issues: string }).issues}`);
    expect(upsertFormatRules).not.toHaveBeenCalled();
  });

  it('passes the format gate code through for a non-EPB league', async () => {
    vi.mocked(getSeasonById).mockResolvedValue({ id: SEASON_ID, format_type: 'singles' } as never);
    // safeErrorResponse logs the UserFacingError server-side.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await putFormatRules(makeRequest({}) as NextRequest, seasonArgs);
    const json = await body(response);

    expect(response.status).toBe(400);
    expect(json.code).toBe('format_mismatch');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('POST /api/seasons/[id]/phases/reorder', () => {
  it('rejects an empty phase list with validation_failed', async () => {
    await expectValidationFailed(await reorderPhases(makeRequest({ phase_ids: [] }) as NextRequest, seasonArgs));
    expect(reorderPhasesQuery).not.toHaveBeenCalled();
  });
});

describe('/api/seasons/[id]/phases/[phaseId]', () => {
  it('GET answers a phase of another league with 404 PHASE_NOT_FOUND', async () => {
    vi.mocked(getTournamentWithDetails).mockResolvedValue({ id: PHASE_ID, season_id: 'other' } as never);

    const response = await getPhase(makeRequest() as NextRequest, phaseArgs());
    const json = await body(response);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: 'Phase not found', code: 'PHASE_NOT_FOUND' });
  });

  it('PATCH answers an unknown phase with 404 PHASE_NOT_FOUND', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const response = await patchPhase(makeRequest({ name: 'Playoffs' }) as NextRequest, phaseArgs());
    const json = await body(response);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: 'Phase not found', code: 'PHASE_NOT_FOUND' });
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('PATCH rejects an unknown status with validation_failed', async () => {
    await expectValidationFailed(await patchPhase(makeRequest({ status: 'paused' }) as NextRequest, phaseArgs()));
    expect(updateTournament).not.toHaveBeenCalled();
  });

  it('DELETE answers an unknown phase with 404 PHASE_NOT_FOUND', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const response = await deletePhase(makeRequest() as NextRequest, phaseArgs());
    const json = await body(response);

    expect(response.status).toBe(404);
    expect(json.code).toBe('PHASE_NOT_FOUND');
    expect(deleteTournament).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/phases/[phaseId]/groups', () => {
  it('rejects a single group with validation_failed', async () => {
    await expectValidationFailed(await createGroups(makeRequest({ group_count: 1 }) as NextRequest, phaseArgs()));
    expect(createGroupBatch).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]/groups/members', () => {
  const move = { player_id: P1, from_group_id: G1, to_group_id: G2 };

  it('answers a phase of another league with 404 PHASE_NOT_FOUND', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: PHASE_ID, season_id: 'other' } as never);

    const response = await moveGroupMember(makeRequest(move) as NextRequest, phaseArgs());
    const json = await body(response);

    expect(response.status).toBe(404);
    expect(json).toMatchObject({ error: 'Phase not found', code: 'PHASE_NOT_FOUND' });
    expect(moveGroupMemberQuery).not.toHaveBeenCalled();
  });

  it('rejects a malformed move with validation_failed', async () => {
    await expectValidationFailed(
      await moveGroupMember(makeRequest({ ...move, to_group_id: 'g2' }) as NextRequest, phaseArgs()),
    );
  });
});

describe('PATCH /api/seasons/[id]/phases/[phaseId]/participants (seeds)', () => {
  it('rejects duplicate seeds with phase_seed_duplicate', async () => {
    const response = await patchPhaseSeeds(
      makeRequest({ seeds: [{ player_id: P1, seed: 1 }, { player_id: P2, seed: 1 }] }) as NextRequest,
      phaseArgs(),
    );
    const json = await body(response);

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ error: 'Duplicate seed values are not allowed', code: 'phase_seed_duplicate' });
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
  });

  it('names the player who is not a participant in the message and in params', async () => {
    vi.mocked(getParticipants).mockResolvedValue([]);

    const response = await patchPhaseSeeds(
      makeRequest({ seeds: [{ player_id: P1, seed: 1 }] }) as NextRequest,
      phaseArgs(),
    );
    const json = await body(response);

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      error: `Player ${P1} is not a participant`,
      code: 'phase_seed_not_participant',
      params: { player_id: P1 },
    });
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
  });

  it('rejects a malformed seed list with validation_failed', async () => {
    await expectValidationFailed(await patchPhaseSeeds(makeRequest({ seeds: [] }) as NextRequest, phaseArgs()));
  });
});

describe('POST /api/seasons/[id]/phases/[phaseId]/participants/seed-by-rating', () => {
  it('answers a phase without participants with phase_seed_no_participants', async () => {
    vi.mocked(getParticipants).mockResolvedValue([]);

    const response = await seedByRating(makeRequest() as NextRequest, phaseArgs());
    const json = await body(response);

    expect(response.status).toBe(400);
    expect(json).toMatchObject({ error: 'No participants to seed', code: 'phase_seed_no_participants' });
    expect(updateParticipantSeeds).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/phases/[phaseId]/participants/sync-standings', () => {
  it('rejects a malformed body with validation_failed', async () => {
    await expectValidationFailed(await syncStandings(makeRequest({ top_n: 0 }) as NextRequest, phaseArgs()));
    expect(syncStandingsEnrollment).not.toHaveBeenCalled();
  });
});
