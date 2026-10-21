import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(),
}));

// --------------- imports (after mocks) ---------------

import { GET } from '@/app/api/matches/[id]/route';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { PRIVATE_MATCH_FIELDS, PUBLIC_MATCH_FIELDS, toPublicMatch } from '@/lib/match/public-match';
import { expectNoPrivateMatchData, fullMatchRow } from '@/lib/match/__tests__/private-match-fields';

// --------------- helpers ---------------

const routeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const MATCH_ID = '33333333-3333-4333-8333-333333333333';
const MISSING_ID = '44444444-4444-4444-8444-444444444444';

const baseMatch = {
  id: MATCH_ID,
  tournament_id: 't-1',
  round_id: 'r-1',
  player_1_id: 'p1',
  player_2_id: 'p2',
  player_1_name: 'Alice',
  player_2_name: 'Bob',
  winner_id: 'p1',
  winner_name: 'Alice',
  status: 'completed',
  games: [],
  notes: 'internal admin note — should be stripped',
};

// --------------- tests ---------------

describe('GET /api/matches/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns match details and strips notes from the response', async () => {
    vi.mocked(getMatchById).mockResolvedValue(baseMatch as never);

    const request = {} as NextRequest;
    const response = await GET(request, routeParams(MATCH_ID));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.id).toBe(MATCH_ID);
    expect(payload.data).not.toHaveProperty('notes');
  });

  it('returns the PublicMatch shape only: no admin notes, submitter or confirmation timestamps', async () => {
    const row = fullMatchRow({ id: MATCH_ID });
    vi.mocked(getMatchById).mockResolvedValue(row);

    const response = await GET({} as NextRequest, routeParams(MATCH_ID));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(payload.data)).toEqual([...PUBLIC_MATCH_FIELDS]);
    expect(payload.data).toEqual(JSON.parse(JSON.stringify(toPublicMatch(row))));
    for (const key of PRIVATE_MATCH_FIELDS) expect(payload.data).not.toHaveProperty(key);
    expectNoPrivateMatchData(payload);
  });

  it('returns 404 when match does not exist', async () => {
    vi.mocked(getMatchById).mockResolvedValue(null as never);

    const request = {} as NextRequest;
    const response = await GET(request, routeParams(MISSING_ID));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('not found');
    expect(payload.code).toBe('match_not_found');
  });

  it.each(['abc', 'no-such', `${MATCH_ID}x`, ''])(
    'returns 404 INVALID_MATCH_ID for the malformed id %j without querying',
    async (id) => {
      const response = await GET({} as NextRequest, routeParams(id));
      const payload = await response.json();

      expect(response.status).toBe(404);
      expect(payload).toEqual({ success: false, error: 'Match not found', code: 'INVALID_MATCH_ID' });
      expect(getMatchById).not.toHaveBeenCalled();
    },
  );

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getMatchById).mockRejectedValue(new Error('db'));

    const request = {} as NextRequest;
    const response = await GET(request, routeParams(MATCH_ID));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.success).toBe(false);
  });
});
