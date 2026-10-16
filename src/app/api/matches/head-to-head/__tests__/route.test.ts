import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// --------------- mocks ---------------

// The route is a thin validator over `publicReads.tournamentHeadToHead`; the
// entry's key, tags, TTL, ordering and stored shape are asserted in
// `src/lib/cache/__tests__/public-reads.test.ts`.
vi.mock('@/lib/cache/public-reads', () => ({
  publicReads: { tournamentHeadToHead: vi.fn(), tournamentMatches: vi.fn() },
}));

// --------------- imports (after mocks) ---------------

import { GET } from '@/app/api/matches/head-to-head/route';
import { publicReads } from '@/lib/cache/public-reads';
import { toPublicMatch } from '@/lib/match/public-match';
import { fullMatchRow } from '@/lib/match/__tests__/private-match-fields';
import type { PublicMatch } from '@/lib/match/public-match';

// --------------- helpers ---------------

const T_ID = '11111111-1111-4111-8111-111111111111';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function request(query: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/matches/head-to-head');
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return new Request(url.toString()) as unknown as NextRequest;
}

const PAIR = { tournament_id: T_ID, player_1_id: ALICE, player_2_id: BOB };

/** What the cached entry holds: the pair's `PublicMatch` rows, oldest first. */
function pairRows(): PublicMatch[] {
  return [
    fullMatchRow({
      id: 'm-1', tournament_id: T_ID, player_1_id: ALICE, player_2_id: BOB, winner_id: ALICE,
      created_at: '2026-03-01T00:00:00.000Z',
    }),
    // Bob vs Alice (seats swapped), the later match.
    fullMatchRow({
      id: 'm-2', tournament_id: T_ID, player_1_id: BOB, player_2_id: ALICE, winner_id: BOB,
      created_at: '2026-03-02T00:00:00.000Z',
    }),
  ].map(toPublicMatch);
}

// --------------- tests ---------------

describe('GET /api/matches/head-to-head', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publicReads.tournamentHeadToHead).mockResolvedValue(pairRows());
  });

  it("returns the pair's completed matches, oldest first, with their games", async () => {
    const response = await GET(request(PAIR));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.map((m: { id: string }) => m.id)).toEqual(['m-1', 'm-2']);
    expect(payload.data[0].games).toHaveLength(2);
  });

  it("serves the pair-scoped cached read, never the tournament-wide list", async () => {
    await GET(request(PAIR));

    expect(publicReads.tournamentHeadToHead).toHaveBeenCalledTimes(1);
    expect(publicReads.tournamentHeadToHead).toHaveBeenCalledWith(T_ID, ALICE, BOB);
    expect(publicReads.tournamentMatches).not.toHaveBeenCalled();
  });

  it('passes the ids lower-cased, so a differently cased URL hits the same entry', async () => {
    await GET(request({ ...PAIR, tournament_id: T_ID.toUpperCase(), player_2_id: BOB.toUpperCase() }));

    expect(publicReads.tournamentHeadToHead).toHaveBeenCalledWith(T_ID, ALICE, BOB);
  });

  it('returns an empty list when the players never met', async () => {
    vi.mocked(publicReads.tournamentHeadToHead).mockResolvedValue([]);

    const response = await GET(request(PAIR));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({ success: true, data: [] });
  });

  it.each(['tournament_id', 'player_1_id', 'player_2_id'] as const)(
    'returns 400 MISSING_PARAM without %s',
    async (name) => {
      const query: Record<string, string> = { ...PAIR };
      delete query[name];

      const response = await GET(request(query));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toEqual({ success: false, error: `${name} is required`, code: 'MISSING_PARAM', params: { name } });
      expect(publicReads.tournamentHeadToHead).not.toHaveBeenCalled();
    },
  );

  it.each(['tournament_id', 'player_1_id', 'player_2_id'] as const)(
    'returns 400 INVALID_PARAM for a malformed %s',
    async (name) => {
      const response = await GET(request({ ...PAIR, [name]: 'abc' }));
      const payload = await response.json();

      expect(response.status).toBe(400);
      expect(payload).toEqual({ success: false, error: `${name} must be a valid UUID`, code: 'INVALID_PARAM', params: { name } });
      expect(publicReads.tournamentHeadToHead).not.toHaveBeenCalled();
    },
  );

  it('returns 400 SAME_PLAYER when both ids name one player, whatever their case', async () => {
    const response = await GET(request({ ...PAIR, player_2_id: ALICE.toUpperCase() }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.code).toBe('SAME_PLAYER');
    expect(publicReads.tournamentHeadToHead).not.toHaveBeenCalled();
  });

  it('returns 500 through safeErrorResponse when the read fails', async () => {
    vi.mocked(publicReads.tournamentHeadToHead).mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(request(PAIR));
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload.success).toBe(false);
      expect(payload.error).toBe('Failed to fetch head-to-head matches');
      expect(JSON.stringify(payload)).not.toContain('db down');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
