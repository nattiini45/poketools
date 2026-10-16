import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// ─── Mocks ──────────────────────────────────────────────────────────

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
  updateTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
}));

vi.mock('@/lib/tournament/round-robin', () => ({
  generateRoundRobinRound: vi.fn(),
  getRoundRobinTotalRounds: vi.fn(),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/tournaments/[id]/generate-all-rounds/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch } from '@/lib/supabase/queries/matches';
import { revalidateTag } from 'next/cache';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import {
  generateRoundRobinRound,
  getRoundRobinTotalRounds,
} from '@/lib/tournament/round-robin';

// ─── Helpers ────────────────────────────────────────────────────────

const routeParams = { params: Promise.resolve({ id: 'tourney-1' }) };

const mockTournament = {
  id: 'tourney-1',
  bracket_type: 'round_robin',
  status: 'active',
  current_round: 0,
  best_of_default: 3,
  bo_overrides: {} as Record<string, number>,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/tournaments/[id]/generate-all-rounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
    expect(json.code).toBe('tournament_not_found');
  });

  it('returns 400 for non-round_robin tournaments', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, bracket_type: 'single_elimination' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('only supported for round_robin');
    expect(json.code).toBe('rounds_round_robin_only');
  });

  it('returns 400 for completed tournaments', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'completed' } as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('already completed');
    expect(json.code).toBe('tournament_already_completed');
  });

  it('returns 400 when fewer than 2 participants', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }] as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('at least 2 participants');
    expect(json.code).toBe('tournament_participants_too_few');
  });

  it('returns 400 when all rounds already generated', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1 },
      { round_number: 2 },
      { round_number: 3 },
    ] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('already been generated');
    expect(json.code).toBe('rounds_all_generated');
  });

  it('creates all missing rounds and returns 201', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'upcoming' } as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([]);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(3);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
    } as never);
    vi.mocked(createRound).mockImplementation(async (input) => ({
      id: `round-${input.round_number}`,
      ...input,
    }) as never);

    const res = await POST({} as NextRequest, routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);
    expect(createMatchBatch).toHaveBeenCalledTimes(3);
    expect(updateTournament).toHaveBeenCalledWith('tourney-1', expect.objectContaining({ status: 'active' }));
    // D37: the new pairings show on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournament:tourney-1', { expire: 0 });
  });

  it('uses group members when groups exist', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getParticipants).mockResolvedValue([
      { id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' },
    ] as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      { members: [{ player_id: 'p1' }, { player_id: 'p2' }] },
      { members: [{ player_id: 'p3' }, { player_id: 'p4' }] },
    ] as never);
    vi.mocked(getRoundRobinTotalRounds).mockReturnValue(1);
    vi.mocked(generateRoundRobinRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
    } as never);
    vi.mocked(createRound).mockResolvedValue({ id: 'round-1', round_number: 1 } as never);

    const res = await POST({} as NextRequest, routeParams);
    await res.json();

    expect(res.status).toBe(201);
    expect(generateRoundRobinRound).toHaveBeenCalledTimes(2); // once per group
  });
});
