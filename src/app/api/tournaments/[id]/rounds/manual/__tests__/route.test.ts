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

// ─── Imports (after mocks) ──────────────────────────────────────────

import { POST } from '@/app/api/tournaments/[id]/rounds/manual/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getTournamentById,
  getParticipants,
  updateTournament,
} from '@/lib/supabase/queries/tournaments';
import { getRoundsByTournament, createRound } from '@/lib/supabase/queries/rounds';
import { createMatchBatch } from '@/lib/supabase/queries/matches';
import { revalidateTag } from 'next/cache';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'tourney-1' }) };

const P1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const P2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const P3 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03';
const P4 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a04';

const mockTournament = {
  id: 'tourney-1',
  bracket_type: 'swiss',
  status: 'active',
  current_round: 1,
  best_of_default: 3,
  bo_overrides: {} as Record<string, number>,
};

const mockParticipants = [
  { id: P1 }, { id: P2 }, { id: P3 }, { id: P4 },
];

// ─── Tests ──────────────────────────────────────────────────────────

describe('POST /api/tournaments/[id]/rounds/manual', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns auth error when not resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authorized', 403),
    );

    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
  });

  it('returns 400 when pairings empty', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);

    const res = await POST(makeRequest({ pairings: [] }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('At least one pairing');
    expect(json.code).toBe('validation_failed');
  });

  it('returns 404 when tournament not found', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(null);

    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Tournament not found');
    expect(json.code).toBe('tournament_not_found');
  });

  it('returns 400 when tournament is completed', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, status: 'completed' } as never);

    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('already completed');
    expect(json.code).toBe('tournament_already_completed');
  });

  it('returns 400 when current round not completed (non-RR)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'active' },
    ] as never);

    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not yet completed');
    expect(json.code).toBe('tournament_current_round_incomplete');
  });

  it('returns 400 when player paired against themselves', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);

    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P1 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('cannot be paired against themselves');
    expect(json.code).toBe('pairing_self');
  });

  it('returns 400 when non-participant in pairing', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);

    const STRANGER = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380aff';
    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: STRANGER }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('not a participant');
    expect(json.code).toBe('tournament_player_not_participant');
  });

  it('returns 400 when player appears in multiple pairings', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);

    const res = await POST(
      makeRequest({
        pairings: [
          { player_1_id: P1, player_2_id: P2 },
          { player_1_id: P1, player_2_id: P3 },
        ],
      }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('appears in multiple pairings');
    expect(json.code).toBe('pairing_player_repeated');
  });

  it('returns 400 when too many participants unpaired', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);

    // Only pair 2 of 4 — leaves 2 unpaired
    const res = await POST(
      makeRequest({ pairings: [{ player_1_id: P1, player_2_id: P2 }] }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('must be paired');
    expect(json.code).toBe('pairing_players_unpaired');
  });

  it('creates a manual round successfully', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { round_number: 1, status: 'completed' },
    ] as never);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(createRound).mockResolvedValue({
      id: 'round-2',
      round_number: 2,
      name: 'Round 2',
    } as never);

    const res = await POST(
      makeRequest({
        pairings: [
          { player_1_id: P1, player_2_id: P2 },
          { player_1_id: P3, player_2_id: P4 },
        ],
      }),
      routeParams,
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(createMatchBatch).toHaveBeenCalledTimes(1);
    expect(updateTournament).toHaveBeenCalledWith('tourney-1', { current_round: 2 });
    expect(revalidateTag).toHaveBeenCalledWith('tournament:tourney-1', { expire: 0 });
  });

  it('activates upcoming tournament when creating first round', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getTournamentById).mockResolvedValue({
      ...mockTournament,
      status: 'upcoming',
      current_round: 0,
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([]);
    vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
    vi.mocked(createRound).mockResolvedValue({
      id: 'round-1',
      round_number: 1,
      name: 'Round 1',
    } as never);

    const res = await POST(
      makeRequest({
        pairings: [
          { player_1_id: P1, player_2_id: P2 },
          { player_1_id: P3, player_2_id: P4 },
        ],
      }),
      routeParams,
    );
    await res.json();

    expect(res.status).toBe(201);
    expect(updateTournament).toHaveBeenCalledWith('tourney-1', {
      status: 'active',
      current_round: 1,
    });
  });
});
