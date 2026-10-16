/**
 * GET /api/seasons/[id]/phases/[phaseId]/participants is public. It must map
 * each participant field by field to `{ id, name, avatar_url, seed,
 * starting_bracket }`: before, it spread the player row and dropped only
 * `discord_id` / `auth_user_id`, so moderation and admin columns went out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  updateParticipantSeeds: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(),
}));

vi.mock('@/lib/tournament/league-phase', () => ({
  assertPhaseEditable: vi.fn(),
}));

import { GET } from '../route';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';
import type { ParticipantWithSeed } from '@/types/tournament';

const routeArgs = { params: Promise.resolve({ id: 'season-1', phaseId: 'phase-1' }) };

const fullRows: ParticipantWithSeed[] = [
  { ...fullPlayerRow({ id: 'p1', name: 'Ash' }), seed: 1, starting_bracket: 'winners' },
  { ...fullPlayerRow({ id: 'p2', name: 'Gary', avatar_url: null }), seed: null, starting_bracket: 'losers' },
];

describe('GET /api/seasons/[id]/phases/[phaseId]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'phase-1', season_id: 'season-1' } as never);
  });

  it('returns only { id, name, avatar_url, seed, starting_bracket } per participant', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeArgs);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([
      { id: 'p1', name: 'Ash', avatar_url: fullRows[0].avatar_url, seed: 1, starting_bracket: 'winners' },
      { id: 'p2', name: 'Gary', avatar_url: null, seed: null, starting_bracket: 'losers' },
    ]);
    expect(getParticipants).toHaveBeenCalledWith('phase-1');
  });

  it('the response carries no private player column (JSON.stringify check)', async () => {
    vi.mocked(getParticipants).mockResolvedValue(fullRows);

    const res = await GET({} as NextRequest, routeArgs);

    expectNoPrivatePlayerData(await res.json());
  });

  it('a phase of another league is a 404, not a participant list', async () => {
    vi.mocked(getTournamentById).mockResolvedValue({ id: 'phase-1', season_id: 'other' } as never);

    const res = await GET({} as NextRequest, routeArgs);

    expect(res.status).toBe(404);
    expect(getParticipants).not.toHaveBeenCalled();
  });

  it('returns 500 when the read fails', async () => {
    vi.mocked(getParticipants).mockRejectedValue(new Error('DB error'));

    const res = await GET({} as NextRequest, routeArgs);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch phase participants');
  });
});
