import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
  repairMatchPairing: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  cancelPendingMatchProposalsForMatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getParticipants: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { PATCH } from '@/app/api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair/route';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { getMatchById, repairMatchPairing } from '@/lib/supabase/queries/matches';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { cancelPendingMatchProposalsForMatch } from '@/lib/supabase/queries/match-proposals';
import { getParticipants } from '@/lib/supabase/queries/tournaments';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const roundId = '00000000-0000-4000-8000-000000000002';
const matchId = '00000000-0000-4000-8000-000000000003';
const originalPlayerOneId = '00000000-0000-4000-8000-000000000011';
const originalPlayerTwoId = '00000000-0000-4000-8000-000000000012';
const repairedPlayerOneId = '00000000-0000-4000-8000-000000000021';
const repairedPlayerTwoId = '00000000-0000-4000-8000-000000000022';
const missingPlayerId = '00000000-0000-4000-8000-000000000099';

const params = { params: Promise.resolve({ id: tournamentId, rid: roundId, mid: matchId }) };
const match = {
  id: matchId,
  tournament_id: tournamentId,
  round_id: roundId,
  player_1_id: originalPlayerOneId,
  player_2_id: originalPlayerTwoId,
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  winner_id: null,
  submitter_id: null,
  status: 'scheduled' as const,
  games: [],
};

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('PATCH /api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
    vi.mocked(getMatchById).mockResolvedValue(match as never);
    vi.mocked(getRoundById).mockResolvedValue({ id: roundId, tournament_id: tournamentId } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: repairedPlayerOneId, name: 'Carol' },
      { id: repairedPlayerTwoId, name: 'Drew' },
    ] as never);
    vi.mocked(repairMatchPairing).mockResolvedValue({
      ...match,
      player_1_id: repairedPlayerOneId,
      player_2_id: repairedPlayerTwoId,
      player_1_name: 'Carol',
      player_2_name: 'Drew',
      status: 'scheduled',
    } as never);
    vi.mocked(cancelPendingMatchProposalsForMatch).mockResolvedValue([]);
  });

  it('repairs a scheduled pairing and records the audit diff', async () => {
    const res = await PATCH(request({ player_1_id: repairedPlayerOneId, player_2_id: repairedPlayerTwoId }), params);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', tournamentId);
    expect(repairMatchPairing).toHaveBeenCalledWith(matchId, repairedPlayerOneId, repairedPlayerTwoId);
    expect(cancelPendingMatchProposalsForMatch).toHaveBeenCalledWith(matchId);
    expect(revalidateMatchPages).toHaveBeenCalledWith(tournamentId, matchId);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'match.repair',
      changes: expect.objectContaining({
        player_1_id: { before: originalPlayerOneId, after: repairedPlayerOneId },
        player_2_id: { before: originalPlayerTwoId, after: repairedPlayerTwoId },
      }),
    }));
  });

  it('rejects pairings when a selected player is not a participant', async () => {
    const res = await PATCH(request({ player_1_id: repairedPlayerOneId, player_2_id: missingPlayerId }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('participants');
    expect(body.code).toBe('repair_players_not_participants');
    expect(repairMatchPairing).not.toHaveBeenCalled();
  });

  it('rejects matches that already have submitted games', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...match, games: [{ id: 'g-1' }] } as never);

    const res = await PATCH(request({ player_1_id: repairedPlayerOneId, player_2_id: repairedPlayerTwoId }), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('submitted games');
    expect(body.code).toBe('repair_match_has_games');
    expect(repairMatchPairing).not.toHaveBeenCalled();
  });

  it('rejects invalid repair payloads', async () => {
    const res = await PATCH(request({ player_1_id: repairedPlayerOneId, player_2_id: repairedPlayerOneId }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(getMatchById).not.toHaveBeenCalled();
  });
});