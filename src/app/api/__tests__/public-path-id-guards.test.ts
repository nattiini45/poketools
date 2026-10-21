/**
 * Public GET routes with a UUID path segment answer 404 with the resource's
 * `INVALID_<NOUN>_ID` code for a malformed id, BEFORE any database access
 * (code review M6, repo convention of matches/[id]). Without the guard,
 * Postgres rejects the non-UUID filter and the route answers 500.
 *
 * The Supabase client is replaced by a proxy that fails the test on any use,
 * so a passing case proves no query ran.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const touched: string[] = [];
vi.mock('@/lib/supabase/client', () => {
  const trap: ProxyHandler<object> = {
    get(_target, prop) {
      touched.push(String(prop));
      throw new Error(`supabase.${String(prop)} used before the path-id guard`);
    },
  };
  return { supabase: new Proxy({}, trap) };
});

// The session layer (next-auth) does not load in vitest; the guard runs before any auth call.
vi.mock('@/auth', () => ({ auth: vi.fn(() => { throw new Error('auth() used before the path-id guard'); }) }));

const VALID = '12345678-1234-4123-8123-123456789abc';
const MALFORMED = ['abc', 'p-1', `${VALID}x`, "1' OR '1'='1"];

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ROUTES: [string, () => Promise<{ GET: unknown }>, string, Record<string, string>, string][] = [
  ['achievements/[playerId]', () => import('@/app/api/achievements/[playerId]/route'), 'playerId', {}, 'INVALID_PLAYER_ID'],
  ['ratings/[playerId]', () => import('@/app/api/ratings/[playerId]/route'), 'playerId', {}, 'INVALID_PLAYER_ID'],
  ['ratings/[playerId]/history', () => import('@/app/api/ratings/[playerId]/history/route'), 'playerId', {}, 'INVALID_PLAYER_ID'],
  ['streaks/[playerId]', () => import('@/app/api/streaks/[playerId]/route'), 'playerId', {}, 'INVALID_PLAYER_ID'],
  ['signatures/[playerId]', () => import('@/app/api/signatures/[playerId]/route'), 'playerId', {}, 'INVALID_PLAYER_ID'],
  ['players/[id]/public-profile', () => import('@/app/api/players/[id]/public-profile/route'), 'id', {}, 'INVALID_PLAYER_ID'],
  ['broadcast/state/[mid]', () => import('@/app/api/broadcast/state/[mid]/route'), 'mid', {}, 'INVALID_MATCH_ID'],
  ['broadcast/preview/[mid]', () => import('@/app/api/broadcast/preview/[mid]/route'), 'mid', {}, 'INVALID_MATCH_ID'],
  ['broadcast/recap/[sid]', () => import('@/app/api/broadcast/recap/[sid]/route'), 'sid', {}, 'INVALID_SEASON_ID'],
  ['broadcast/standings/[sid]', () => import('@/app/api/broadcast/standings/[sid]/route'), 'sid', {}, 'INVALID_SEASON_ID'],
  ['broadcast/solo/[sessionId]', () => import('@/app/api/broadcast/solo/[sessionId]/route'), 'sessionId', {}, 'INVALID_SESSION_ID'],
  ['teams/library/[id]', () => import('@/app/api/teams/library/[id]/route'), 'id', {}, 'INVALID_TEAM_ID'],
  ['seasons/[id]/cores', () => import('@/app/api/seasons/[id]/cores/route'), 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/participants', () => import('@/app/api/seasons/[id]/participants/route'), 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases', () => import('@/app/api/seasons/[id]/phases/route'), 'id', {}, 'INVALID_SEASON_ID'],
  [
    'seasons/[id]/phases/[phaseId]/participants (season id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/route'),
    'id',
    { phaseId: VALID },
    'INVALID_SEASON_ID',
  ],
  [
    'seasons/[id]/phases/[phaseId]/participants (phase id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/route'),
    'phaseId',
    { id: VALID },
    'INVALID_PHASE_ID',
  ],
  [
    'seasons/[id]/phases/[phaseId] (season id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/route'),
    'id',
    { phaseId: VALID },
    'INVALID_SEASON_ID',
  ],
  [
    'seasons/[id]/phases/[phaseId] (phase id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/route'),
    'phaseId',
    { id: VALID },
    'INVALID_PHASE_ID',
  ],
  [
    'seasons/[id]/phases/[phaseId]/groups (season id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/route'),
    'id',
    { phaseId: VALID },
    'INVALID_SEASON_ID',
  ],
  [
    'seasons/[id]/phases/[phaseId]/groups (phase id)',
    () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/route'),
    'phaseId',
    { id: VALID },
    'INVALID_PHASE_ID',
  ],
  ['tournaments/[id]/groups', () => import('@/app/api/tournaments/[id]/groups/route'), 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/participants', () => import('@/app/api/tournaments/[id]/participants/route'), 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/rounds', () => import('@/app/api/tournaments/[id]/rounds/route'), 'id', {}, 'INVALID_TOURNAMENT_ID'],
  [
    'tournaments/[id]/rounds/[rid] (tournament id)',
    () => import('@/app/api/tournaments/[id]/rounds/[rid]/route'),
    'id',
    { rid: VALID },
    'INVALID_TOURNAMENT_ID',
  ],
  [
    'tournaments/[id]/rounds/[rid] (round id)',
    () => import('@/app/api/tournaments/[id]/rounds/[rid]/route'),
    'rid',
    { id: VALID },
    'INVALID_ROUND_ID',
  ],
  ['tournaments/[id]/reports', () => import('@/app/api/tournaments/[id]/reports/route'), 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]', () => import('@/app/api/tournaments/[id]/route'), 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['seasons/[id]', () => import('@/app/api/seasons/[id]/route'), 'id', {}, 'INVALID_SEASON_ID'],
  ['rulesets/[id]', () => import('@/app/api/rulesets/[id]/route'), 'id', {}, 'INVALID_RULESET_ID'],
  ['broadcast/storylines/[id]', () => import('@/app/api/broadcast/storylines/[id]/route'), 'id', {}, 'INVALID_STORYLINE_ID'],
  [
    'point-buy-lists/[id]/search-index',
    () => import('@/app/api/point-buy-lists/[id]/search-index/route'),
    'id',
    {},
    'INVALID_POINT_BUY_LIST_ID',
  ],
  // Drafts keep their own convention (UserFacingError POOL_NOT_FOUND, as drafts/[id]/picks does).
  ['drafts/[id]/replay-events', () => import('@/app/api/drafts/[id]/replay-events/route'), 'id', {}, 'POOL_NOT_FOUND'],
];

function request(): NextRequest {
  const url = new URL('http://localhost:3000/api/x');
  return { url: url.toString(), nextUrl: url, headers: new Headers() } as unknown as NextRequest;
}

/**
 * The first import of a route module transforms its whole dependency graph, which can take
 * several seconds on a cold or busy machine. It runs once per route in a hook with its own
 * budget, so the per-case tests (default timeout) only time the guard itself.
 */
const ROUTE_IMPORT_TIMEOUT_MS = 60_000;

describe('public path-id guards', () => {
  describe.each(ROUTES)('GET %s', (_name, load, param, otherParams, code) => {
    let GET: Handler;
    beforeAll(async () => {
      GET = ((await load()) as { GET: Handler }).GET;
    }, ROUTE_IMPORT_TIMEOUT_MS);

    it.each(MALFORMED)(`answers 404 ${code} for %j without touching the database`, async (bad) => {
      touched.length = 0;

      const res = await GET(request(), { params: Promise.resolve({ ...otherParams, [param]: bad }) });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: expect.any(String), code });
      expect(touched).toEqual([]);
    });
  });
});
