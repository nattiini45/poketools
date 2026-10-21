import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

vi.mock('@/lib/tournament/bracket-generate', () => ({
  regenerateEliminationBracket: vi.fn(),
}));

import { POST } from '@/app/api/tournaments/[id]/regenerate-bracket/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { regenerateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { UserFacingError } from '@/lib/api/user-facing-error';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: tournamentId }) };

function request(body: unknown = {}): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/tournaments/[id]/regenerate-bracket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireResourceAdmin).mockResolvedValue({ playerId: 'admin-1', name: 'Admin' } as never);
  });

  it('requires tournament resource admin first', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Forbidden', 403));

    const response = await POST(request(), params);
    expect(requireResourceAdmin).toHaveBeenCalledWith('tournament', tournamentId);
    expect(response.status).toBe(403);
    expect(getTournamentById).not.toHaveBeenCalled();
  });

  it('answers a missing tournament with tournament_not_found', async () => {
    vi.mocked(getTournamentById).mockResolvedValue(null as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Tournament not found');
    expect(payload.code).toBe('tournament_not_found');
  });

  it('answers a non-elimination format with bracket_regenerate_elim_only', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: tournamentId, bracket_type: 'round_robin' } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Bracket regeneration only applies to elimination formats');
    expect(payload.code).toBe('bracket_regenerate_elim_only');
    expect(regenerateEliminationBracket).not.toHaveBeenCalled();
  });

  it('answers an invalid body with validation_failed and the issues as its param', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: tournamentId, bracket_type: 'single_elim' } as never);

    const response = await POST(request({ cascade: 'yes' }), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('validation_failed');
    expect(payload.params).toEqual({ issues: payload.error });
    expect(regenerateEliminationBracket).not.toHaveBeenCalled();
  });

  it('passes the REGENERATE_PLAYED engine error through with its code and params', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'double_elim',
      season_id: null,
    } as never);
    vi.mocked(getParticipants).mockResolvedValue([] as never);
    vi.mocked(regenerateEliminationBracket).mockRejectedValue(
      new UserFacingError('3 played matches will be reset and all results rolled back.', {
        code: 'REGENERATE_PLAYED',
        params: { count: 3 },
        status: 409,
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.code).toBe('REGENERATE_PLAYED');
    expect(payload.params).toEqual({ count: 3 });
  });
});
