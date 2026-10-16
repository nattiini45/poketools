import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';

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

vi.mock('@/lib/tournament/bracket-propagation', () => ({
  repairBracket: vi.fn(),
}));

import { POST } from '@/app/api/tournaments/[id]/repair-bracket/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { repairBracket } from '@/lib/tournament/bracket-propagation';
import { revalidateTag } from 'next/cache';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: tournamentId }) };

function request(): NextRequest {
  return {} as NextRequest;
}

describe('POST /api/tournaments/[id]/repair-bracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({
      playerId: 'admin-1',
      name: 'Admin',
    } as never);
  });

  it('requires tournament resource admin first', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const response = await POST(request(), params);
    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', tournamentId);
    expect(response.status).toBe(403);
  });

  it('returns 404 when the tournament is missing', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('returns 400 for non-elimination brackets', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'round_robin',
    } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('elimination');
    expect(payload.code).toBe('bracket_repair_elim_only');
    expect(repairBracket).not.toHaveBeenCalled();
  });

  it('re-runs propagation materialization', async () => {
    const tournament = { id: tournamentId, bracket_type: 'double_elim' };
    vi.mocked(getTournamentById).mockResolvedValue(tournament as never);
    vi.mocked(getParticipants).mockResolvedValue([{ id: 'p1' }, { id: 'p2' }] as never);
    vi.mocked(repairBracket).mockResolvedValue({ slots_materialized: 2 });

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ slots_materialized: 2 });
    expect(repairBracket).toHaveBeenCalledWith(tournament, [{ id: 'p1' }, { id: 'p2' }]);
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${tournamentId}`, { expire: 0 });
  });
});
