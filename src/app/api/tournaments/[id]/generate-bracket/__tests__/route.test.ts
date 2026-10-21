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

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
  updateSeason: vi.fn(),
}));

vi.mock('@/lib/tournament/bracket-generate', () => ({
  generateEliminationBracket: vi.fn(),
}));

vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));

import { POST } from '@/app/api/tournaments/[id]/generate-bracket/route';
import { requireResourceAdmin, AuthError } from '@/lib/auth/helpers';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';

const tournamentId = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ id: tournamentId }) };

function request(): NextRequest {
  return {} as NextRequest;
}

describe('POST /api/tournaments/[id]/generate-bracket', () => {
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

  it('answers a non-elimination format with bracket_generate_elim_only', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'swiss',
      status: 'upcoming',
    } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Full bracket generation only applies to elimination formats');
    expect(payload.code).toBe('bracket_generate_elim_only');
    expect(generateEliminationBracket).not.toHaveBeenCalled();
  });

  it('answers a completed tournament with tournament_already_completed', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({
      id: tournamentId,
      bracket_type: 'single_elim',
      status: 'completed',
    } as never);

    const response = await POST(request(), params);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Tournament is already completed');
    expect(payload.code).toBe('tournament_already_completed');
    expect(generateEliminationBracket).not.toHaveBeenCalled();
  });
});
