import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    requirePlayer: vi.fn(),
    AuthError,
  };
});

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  isResourceAdminFor: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  deleteRound: vi.fn(),
  getRoundsByTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchesByRound: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(),
}));

vi.mock('@/lib/pkmn/game-pipeline', () => ({
  resetMatch: vi.fn(),
}));

vi.mock('@/lib/match/aggregate-rebuild', () => ({
  rebuildAggregatesForScope: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  revalidateMatchPages: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  updateTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  },
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { DELETE } from '@/app/api/admin/rounds/[id]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getRoundById, getRoundsByTournament, deleteRound } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound } from '@/lib/supabase/queries/matches';
import { rebuildAggregatesForScope } from '@/lib/match/aggregate-rebuild';
import { resetMatch } from '@/lib/pkmn/game-pipeline';
import { updateTournament } from '@/lib/supabase/queries/tournaments';
import { revalidateMatchPages } from '@/lib/revalidation';
import { logAuditEvent } from '@/lib/audit/log';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import { getGamesByMatch } from '@/lib/supabase/queries/games';

const mockPlayer = { playerId: 'player-1', isAdmin: true, isCreator: false, name: 'Admin' };
const routeParams = { params: Promise.resolve({ id: 'ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f' }) };

const baseRound = {
  id: 'ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f',
  tournament_id: 'tourn-1',
  name: 'Round 1',
  round_number: 1,
  best_of: 3,
  status: 'pending',
  pairings_generated: true,
  deadline: null,
  bracket_side: null as 'winners' | null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('DELETE /api/admin/rounds/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue(mockPlayer as never);
  });

  it('returns 404 with round_not_found when the round does not exist', async () => {
    vi.mocked(getRoundById).mockResolvedValue(null as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Round not found', code: 'round_not_found' });
  });

  it('returns 403 with forbidden when the caller is neither admin nor resource admin', async () => {
    vi.mocked(requirePlayer).mockResolvedValue({ ...mockPlayer, isAdmin: false } as never);
    vi.mocked(getRoundById).mockResolvedValue(baseRound as never);
    vi.mocked(isResourceAdminFor).mockResolvedValue(false);

    const res = await DELETE({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(deleteRound).not.toHaveBeenCalled();
  });

  it('refuses deleting an earlier round that has games, with round_delete_not_allowed', async () => {
    vi.mocked(getRoundById).mockResolvedValue(baseRound as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      baseRound,
      { ...baseRound, id: 'round-2', name: 'Round 2', round_number: 2 },
    ] as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([{ id: 'match-1', status: 'completed' }] as never);
    vi.mocked(getGamesByMatch).mockResolvedValue([{ id: 'game-1' }] as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Only the latest round or rounds with zero games can be deleted');
    expect(body.code).toBe('round_delete_not_allowed');
    expect(deleteRound).not.toHaveBeenCalled();
  });

  it('refuses deleting a structure-generated elimination round', async () => {
    vi.mocked(getRoundById).mockResolvedValue({
      ...baseRound,
      name: 'Finals',
      bracket_side: 'winners',
    } as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([
      { ...baseRound, bracket_side: 'winners', name: 'Finals' },
    ] as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.code).toBe('STRUCTURE_ELIM_ROUND_DELETE');
    expect(body.error).toContain('Regenerate Bracket');
    expect(deleteRound).not.toHaveBeenCalled();
    expect(resetMatch).not.toHaveBeenCalled();
    expect(rebuildAggregatesForScope).not.toHaveBeenCalled();
  });

  it('allows deleting a legacy / RR / Swiss round and rebuilds tournament aggregates', async () => {
    vi.mocked(getRoundById).mockResolvedValue(baseRound as never);
    vi.mocked(getRoundsByTournament).mockResolvedValue([baseRound] as never);
    vi.mocked(getMatchesByRound).mockResolvedValue([] as never);
    vi.mocked(rebuildAggregatesForScope).mockResolvedValue({
      gamesProcessed: 0,
    } as never);

    const res = await DELETE({} as NextRequest, routeParams);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(deleteRound).toHaveBeenCalledWith('ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f');
    expect(updateTournament).toHaveBeenCalledWith('tourn-1', { current_round: 0 });
    expect(revalidateMatchPages).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalled();
    expect(rebuildAggregatesForScope).toHaveBeenCalledWith('tournament', 'tourn-1');
  });
});
