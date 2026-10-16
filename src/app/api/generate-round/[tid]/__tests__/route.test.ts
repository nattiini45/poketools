import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  updateSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundsByTournament: vi.fn(),
  createRound: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  createMatchBatch: vi.fn(),
  getCompletedMatchRecords: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournament-groups', () => ({
  getGroupsByTournament: vi.fn(),
}));

vi.mock('@/lib/tournament', () => ({
  generateRound: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({
  emitDiscordEvent: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  emitSocialEvent: vi.fn(),
}));

vi.mock('@/lib/ai/trigger', () => ({
  triggerTournamentReport: vi.fn(),
}));

vi.mock('@/lib/feature-flags', () => ({
  ENABLE_KALE_CABBAGE: false,
}));

// --------------- imports (after mocks) ---------------

import { POST } from '@/app/api/generate-round/[tid]/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getSeasonById, updateSeason } from '@/lib/supabase/queries/seasons';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getGroupsByTournament } from '@/lib/supabase/queries/tournament-groups';
import { generateRound } from '@/lib/tournament';
import { revalidateTag } from 'next/cache';

// --------------- helpers ---------------

const routeParams = (tid: string) => ({ params: Promise.resolve({ tid }) });

const baseTournament = {
  id: 't-1',
  name: 'Weekly #5',
  status: 'active' as const,
  season_id: 's-1',
  bracket_type: 'swiss' as const,
  current_round: 1,
  best_of_default: 3,
  bo_overrides: {} as Record<string, number>,
};

const participants = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
  { id: 'p4', name: 'Dave' },
];

// --------------- tests ---------------

describe('POST /api/generate-round/[tid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: auth passes
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    // Happy-path defaults
    vi.mocked(getTournamentById).mockResolvedValue(baseTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(participants as never);
    vi.mocked(getCompletedMatchRecords).mockResolvedValue([] as never);
    vi.mocked(getGroupsByTournament).mockResolvedValue([] as never);
    vi.mocked(generateRound).mockReturnValue({
      pairings: [
        { player_1_id: 'p1', player_2_id: 'p2' },
        { player_1_id: 'p3', player_2_id: 'p4' },
      ],
      round_name: 'Round 2',
    } as never);
    vi.mocked(createRound).mockResolvedValue({
      id: 'r-2',
      tournament_id: 't-1',
      name: 'Round 2',
      round_number: 2,
      best_of: 3,
      status: 'pending',
    } as never);
  });

  // ---- auth ----

  it('returns auth error when not a resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
  });

  // ---- validation ----

  it('returns 404 when tournament does not exist', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('no-such'));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('returns 400 when tournament is already completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'completed',
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('already completed');
    expect(payload.code).toBe('tournament_already_completed');
  });

  it('returns 400 when current round is not completed (non-round-robin)', async () => {
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'active' },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('not yet completed');
    expect(payload.code).toBe('tournament_current_round_incomplete');
  });

  it('allows generating ahead for round_robin even if current round is not completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'round_robin',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'active' },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
  });

  it('returns 400 when fewer than 2 participants', async () => {
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1', name: 'Solo' }] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('at least 2');
    expect(payload.code).toBe('tournament_participants_too_few');
  });

  // ---- happy path ----

  it('generates the next round and returns 201', async () => {
    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe('r-2');

    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', 't-1');
    expect(createRound).toHaveBeenCalledWith(
      expect.objectContaining({
        tournament_id: 't-1',
        round_number: 2,
        best_of: 3,
      })
    );
    expect(createMatchBatch).toHaveBeenCalledWith([
      expect.objectContaining({ round_id: 'r-2', player_1_id: 'p1', player_2_id: 'p2' }),
      expect.objectContaining({ round_id: 'r-2', player_1_id: 'p3', player_2_id: 'p4' }),
    ]);
    expect(updateTournament).toHaveBeenCalledWith('t-1', { current_round: 2 });
    // D37: the pairings show on the tournament and league pages' next view.
    expect(revalidateTag).toHaveBeenCalledWith('tournament:t-1', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('season:s-1', { expire: 0 });
  });

  it('uses bo_overrides when the round name matches', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bo_overrides: { 'Round 2': 5 },
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('t-1'));

    expect(createRound).toHaveBeenCalledWith(
      expect.objectContaining({ best_of: 5 })
    );
  });

  it('transitions upcoming tournament to active on first round', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('t-1'));

    expect(updateTournament).toHaveBeenCalledWith('t-1', {
      status: 'active',
      current_round: 1,
    });
  });

  it('bubbles up season status from upcoming to active', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 's-1',
      status: 'upcoming',
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('t-1'));

    expect(updateSeason).toHaveBeenCalledWith('s-1', { status: 'active' });
  });

  it('does NOT update season when season is already active', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
    vi.mocked(getSeasonById).mockResolvedValue({
      id: 's-1',
      status: 'active',
    } as never);

    const request = {} as NextRequest;
    await POST(request, routeParams('t-1'));

    expect(updateSeason).not.toHaveBeenCalled();
  });

  it('handles group-scoped pairings', async () => {
    vi.mocked(getGroupsByTournament).mockResolvedValue([
      {
        id: 'g-1',
        name: 'Group A',
        members: [
          { player_id: 'p1', player_name: 'Alice' },
          { player_id: 'p2', player_name: 'Bob' },
        ],
      },
      {
        id: 'g-2',
        name: 'Group B',
        members: [
          { player_id: 'p3', player_name: 'Carol' },
          { player_id: 'p4', player_name: 'Dave' },
        ],
      },
    ] as never);

    vi.mocked(generateRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      round_name: 'Round 2',
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));

    expect(response.status).toBe(201);
    // generateRound should be called once per group
    expect(generateRound).toHaveBeenCalledTimes(2);
  });

  it('returns 400 with BRACKET_V2_MANAGED for structure-generated elim brackets', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bracket_side: 'winners' },
    ] as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('BRACKET_V2_MANAGED');
    expect(generateRound).not.toHaveBeenCalled();
  });

  it('allows generate-round for legacy elim brackets without bracket_side', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      ...baseTournament,
      bracket_type: 'single_elim',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed', bracket_side: null },
    ] as never);
    vi.mocked(generateRound).mockReturnValue({
      pairings: [{ player_1_id: 'p1', player_2_id: 'p2' }],
      round_name: 'Semifinals',
    } as never);

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(generateRound).toHaveBeenCalled();
  });

  // ---- error handling ----

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getParticipants).mockRejectedValue(new Error('db'));

    const request = {} as NextRequest;
    const response = await POST(request, routeParams('t-1'));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
