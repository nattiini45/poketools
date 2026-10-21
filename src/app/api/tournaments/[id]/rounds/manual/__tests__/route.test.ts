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

vi.mock('@/lib/supabase/queries/season-groups', () => ({
  seasonHasGroups: vi.fn(),
}));

vi.mock('@/lib/tournament/group-rounds', () => ({
  ensurePhaseGroupsFromLeague: vi.fn(),
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
import { seasonHasGroups } from '@/lib/supabase/queries/season-groups';
import { ensurePhaseGroupsFromLeague } from '@/lib/tournament/group-rounds';
import { revalidateTag } from 'next/cache';

// ─── Helpers ────────────────────────────────────────────────────────

const makeRequest = (body: Record<string, unknown>) =>
  ({ json: () => Promise.resolve(body) }) as unknown as NextRequest;

const routeParams = { params: Promise.resolve({ id: 'a5cb20ac-a127-482d-855d-d802e29185bc' }) };

const P1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a01';
const P2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a02';
const P3 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a03';
const P4 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a04';

const mockTournament = {
  id: 'a5cb20ac-a127-482d-855d-d802e29185bc',
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

  describe('grouped league', () => {
    const SEASON_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99';
    const twoPairings = {
      pairings: [
        { player_1_id: P1, player_2_id: P2 },
        { player_1_id: P3, player_2_id: P4 },
      ],
    };

    beforeEach(() => {
      vi.mocked(requireResourceAdmin).mockResolvedValue(undefined as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([] as never);
      vi.mocked(getParticipants).mockResolvedValue(mockParticipants as never);
      vi.mocked(createRound).mockResolvedValue({ id: 'round-1', round_number: 1, name: 'Round 1' } as never);
    });

    it('refuses a manual round in a round robin phase of a league with groups (409), writing nothing', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...mockTournament,
        bracket_type: 'round_robin',
        season_id: SEASON_ID,
      } as never);
      vi.mocked(seasonHasGroups).mockResolvedValue(true);

      const res = await POST(makeRequest(twoPairings), routeParams);
      const json = await res.json();

      expect(res.status).toBe(409);
      expect(json.code).toBe('rounds_manual_league_grouped');
      expect(seasonHasGroups).toHaveBeenCalledWith(SEASON_ID);
      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).not.toHaveBeenCalled();
      expect(ensurePhaseGroupsFromLeague).not.toHaveBeenCalled();
    });

    it('allows it in a round robin phase of a league without groups', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({
        ...mockTournament,
        bracket_type: 'round_robin',
        season_id: SEASON_ID,
      } as never);
      vi.mocked(seasonHasGroups).mockResolvedValue(false);

      const res = await POST(makeRequest(twoPairings), routeParams);

      expect(res.status).toBe(201);
      expect(createRound).toHaveBeenCalledTimes(1);
    });

    it('mirrors the league groups before the round in any other league phase (a Swiss phase), like the generate routes', async () => {
      const swiss = { ...mockTournament, season_id: SEASON_ID };
      vi.mocked(getTournamentById).mockResolvedValue(swiss as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed' }] as never);

      const res = await POST(makeRequest(twoPairings), routeParams);

      expect(res.status).toBe(201);
      expect(seasonHasGroups).not.toHaveBeenCalled();
      expect(ensurePhaseGroupsFromLeague).toHaveBeenCalledWith(SEASON_ID, swiss);
      expect(vi.mocked(ensurePhaseGroupsFromLeague).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(createRound).mock.invocationCallOrder[0],
      );
    });

    it('writes nothing when the mirror refuses (a trainer in no league group)', async () => {
      vi.mocked(getTournamentById).mockResolvedValue({ ...mockTournament, season_id: SEASON_ID } as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed' }] as never);
      const refusal = Object.assign(new Error('Every trainer of this phase must be in a league group first'), {
        code: 'PHASE_PLAYER_WITHOUT_LEAGUE_GROUP',
      });
      vi.mocked(ensurePhaseGroupsFromLeague).mockRejectedValueOnce(refusal);

      await POST(makeRequest(twoPairings), routeParams);

      expect(createRound).not.toHaveBeenCalled();
      expect(createMatchBatch).not.toHaveBeenCalled();
    });

    it('does not mirror outside a league', async () => {
      vi.mocked(getTournamentById).mockResolvedValue(mockTournament as never);
      vi.mocked(getRoundsByTournament).mockResolvedValue([{ round_number: 1, status: 'completed' }] as never);

      await POST(makeRequest(twoPairings), routeParams);

      expect(ensurePhaseGroupsFromLeague).not.toHaveBeenCalled();
    });
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
    expect(updateTournament).toHaveBeenCalledWith('a5cb20ac-a127-482d-855d-d802e29185bc', { current_round: 2 });
    expect(revalidateTag).toHaveBeenCalledWith('tournament:a5cb20ac-a127-482d-855d-d802e29185bc', { expire: 0 });
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
    expect(updateTournament).toHaveBeenCalledWith('a5cb20ac-a127-482d-855d-d802e29185bc', {
      status: 'active',
      current_round: 1,
    });
  });
});
