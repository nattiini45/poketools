import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Error codes of GET /api/match-prep/opponent-summary (i18n-core §4.1,
 * package A2). The English `error` text is unchanged.
 */

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/matches', () => ({ getMatchById: vi.fn() }));
vi.mock('@/lib/supabase/queries/games', () => ({ getOpponentBattleStatsInTournament: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ getTournamentById: vi.fn() }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('@/lib/pkmn/threat-list', () => ({ buildThreatEntry: vi.fn() }));

import { GET } from '@/app/api/match-prep/opponent-summary/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getMatchById } from '@/lib/supabase/queries/matches';

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/match-prep/opponent-summary${query}`);
}

describe('GET /api/match-prep/opponent-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p-1', isAdmin: false } as never);
  });

  it('sends MISSING_PARAM with the param name when match_id is missing', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: 'match_id is required',
      code: 'MISSING_PARAM',
      params: { name: 'match_id' },
    });
  });

  it('sends match_not_found for an unknown match', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null);
    const res = await GET(request('?match_id=m-1'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Match not found', code: 'match_not_found' });
  });

  it('sends forbidden when the viewer is not in the match', async () => {
    vi.mocked(getMatchById).mockResolvedValue({
      id: 'm-1',
      player_1_id: 'p-2',
      player_2_id: 'p-3',
    } as never);
    const res = await GET(request('?match_id=m-1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Forbidden', code: 'forbidden' });
  });
});
