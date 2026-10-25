/**
 * Every dynamic API route with a UUID path segment answers a malformed id with
 * 404 and the resource's `INVALID_<NOUN>_ID` code (repo convention, code
 * review M6, decisions round 3), BEFORE any database access. Without the
 * guard, Postgres rejects the non-UUID filter and the route answers 500.
 *
 * Public GETs are pinned in `public-path-id-guards.test.ts`; this file covers
 * every guarded handler that sits behind an auth guard. The caller is a live
 * site admin (creator too), so every auth guard passes and the request reaches
 * the path guard; the real `requireResourceAdmin` / `requireDraftAdmin` run and
 * refuse a malformed id themselves. The Supabase client is a proxy that fails
 * the test on any use, so a passing case proves no query ran.
 *
 * League groups (lead ruling round 4): every league groups route
 * (`seasons/[id]/groups/**`), every phase groups route
 * (`seasons/[id]/phases/[phaseId]/groups/**`; its public GET is pinned in
 * `public-path-id-guards.test.ts`) and `drafts/route.ts`, whose season id is a
 * query parameter (`GET /api/drafts?season_id=`, its own describe below).
 *
 * Not here, by design:
 * - `[name]` / `[species]` / `[pokemon]` / `[token]` / `[...nextauth]`
 *   segments are not UUIDs;
 * - `drafts/[id]/favorites` ignores its id. Every other draft route with a pool
 *   id is listed with the draft convention's `POOL_NOT_FOUND` (its own uuid
 *   check, `getQueuePool` or `requireDraftAdmin`), the path id before the body.
 * - handlers that read no id: `drafts/[id]/favorites` GET/PUT, and the retired
 *   `seasons/[id]/draft-tokens` POST, `seasons/[id]/kill-tokens` GET/POST and
 *   `seasons/[id]/redraft` POST, which answer 410 whatever the id (a guard
 *   would turn the retired answer into a 404 for no gain).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

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

const ADMIN_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'discord-admin' }, provider: 'discord', player: null, expires: '' })),
  loadSessionPlayer: vi.fn(async () => ({
    playerId: ADMIN_ID,
    name: 'Admin',
    isAdmin: true,
    isResourceAdmin: true,
    isCreator: true,
    psUsername: '',
    championsUsername: '',
    avatarUrl: null,
    status: 'active',
  })),
}));

const VALID = '12345678-1234-4123-8123-123456789abc';
const MALFORMED = ['abc', `${VALID}x`, "1' OR '1'='1"];

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Loader = () => Promise<Partial<Record<Method, unknown>>>;

/** [route, loader, methods, malformed segment, the other segments, expected code] */
type Case = [string, Loader, Method[], string, Record<string, string>, string];

const CASES: Case[] = [
  ['admin/achievements/[id]', () => import('@/app/api/admin/achievements/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_ACHIEVEMENT_ID'],
  ['admin/games/[id]', () => import('@/app/api/admin/games/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_GAME_ID'],
  ['admin/matches/[id]/replay-import', () => import('@/app/api/admin/matches/[id]/replay-import/route'), ['POST'], 'id', {}, 'INVALID_MATCH_ID'],
  ['admin/matches/[id]/replay-preview', () => import('@/app/api/admin/matches/[id]/replay-preview/route'), ['POST'], 'id', {}, 'INVALID_MATCH_ID'],
  ['admin/matches/[id]/reset', () => import('@/app/api/admin/matches/[id]/reset/route'), ['POST'], 'id', {}, 'INVALID_MATCH_ID'],
  ['admin/players/[id]/suspend', () => import('@/app/api/admin/players/[id]/suspend/route'), ['POST'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['admin/players/[id]/unsuspend', () => import('@/app/api/admin/players/[id]/unsuspend/route'), ['POST'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['admin/rounds/[id]', () => import('@/app/api/admin/rounds/[id]/route'), ['DELETE'], 'id', {}, 'INVALID_ROUND_ID'],
  ['admin/rounds/[id]/reset', () => import('@/app/api/admin/rounds/[id]/reset/route'), ['POST'], 'id', {}, 'INVALID_ROUND_ID'],
  ['admin/wiki/reports/[id]', () => import('@/app/api/admin/wiki/reports/[id]/route'), ['PATCH'], 'id', {}, 'INVALID_WIKI_REPORT_ID'],
  ['avatar/gallery/[id]', () => import('@/app/api/avatar/gallery/[id]/route'), ['DELETE'], 'id', {}, 'INVALID_GALLERY_ITEM_ID'],
  ['broadcast/caster-data/[mid]', () => import('@/app/api/broadcast/caster-data/[mid]/route'), ['GET'], 'mid', {}, 'INVALID_MATCH_ID'],
  ['broadcast/presets/[id]', () => import('@/app/api/broadcast/presets/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_PRESET_ID'],
  ['broadcast/storylines/[id]', () => import('@/app/api/broadcast/storylines/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_STORYLINE_ID'],
  ['cast-sessions/[id]', () => import('@/app/api/cast-sessions/[id]/route'), ['GET', 'PATCH', 'DELETE'], 'id', {}, 'INVALID_SESSION_ID'],
  ['cast-sessions/[id]/populate', () => import('@/app/api/cast-sessions/[id]/populate/route'), ['POST'], 'id', {}, 'INVALID_SESSION_ID'],
  ['confirm-match/[mid]', () => import('@/app/api/confirm-match/[mid]/route'), ['POST'], 'mid', {}, 'INVALID_MATCH_ID'],
  ['discord-webhooks/[id]', () => import('@/app/api/discord-webhooks/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_WEBHOOK_ID'],
  ['discord-webhooks/[id]/test', () => import('@/app/api/discord-webhooks/[id]/test/route'), ['POST'], 'id', {}, 'INVALID_WEBHOOK_ID'],
  ['draft-pool-entries/[id]', () => import('@/app/api/draft-pool-entries/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_POOL_ENTRY_ID'],
  ['draft-pool-templates/[id]', () => import('@/app/api/draft-pool-templates/[id]/route'), ['GET', 'DELETE'], 'id', {}, 'INVALID_POOL_TEMPLATE_ID'],
  ['drafts/[id]/picks/[pickId]/void', () => import('@/app/api/drafts/[id]/picks/[pickId]/void/route'), ['POST'], 'pickId', { id: VALID }, 'INVALID_PICK_ID'],
  ['drafts/[id]/picks/[pickId]/correct', () => import('@/app/api/drafts/[id]/picks/[pickId]/correct/route'), ['POST'], 'pickId', { id: VALID }, 'INVALID_PICK_ID'],
  ['drafts/[id]/participants/[playerId]/penalty', () => import('@/app/api/drafts/[id]/participants/[playerId]/penalty/route'), ['POST'], 'playerId', { id: VALID }, 'INVALID_PLAYER_ID'],
  ['drafts/[id]/redraft/slots/[redraftSlotId]/restore', () => import('@/app/api/drafts/[id]/redraft/slots/[redraftSlotId]/restore/route'), ['POST'], 'redraftSlotId', { id: VALID }, 'INVALID_REDRAFT_SLOT_ID'],
  ['drafts/[id] (pool id)', () => import('@/app/api/drafts/[id]/route'), ['GET', 'PATCH', 'DELETE'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/state (pool id)', () => import('@/app/api/drafts/[id]/state/route'), ['GET'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/my-turn (pool id)', () => import('@/app/api/drafts/[id]/my-turn/route'), ['GET'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/audit (pool id)', () => import('@/app/api/drafts/[id]/audit/route'), ['GET'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/config (pool id)', () => import('@/app/api/drafts/[id]/config/route'), ['PATCH'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/end (pool id)', () => import('@/app/api/drafts/[id]/end/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/extensions (pool id)', () => import('@/app/api/drafts/[id]/extensions/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/free-order (pool id)', () => import('@/app/api/drafts/[id]/free-order/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/pause (pool id)', () => import('@/app/api/drafts/[id]/pause/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/start (pool id)', () => import('@/app/api/drafts/[id]/start/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/picks (pool id)', () => import('@/app/api/drafts/[id]/picks/route'), ['GET', 'POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/redraft (pool id)', () => import('@/app/api/drafts/[id]/redraft/route'), ['PATCH'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/redraft/publish (pool id)', () => import('@/app/api/drafts/[id]/redraft/publish/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/redraft/submission (pool id)', () => import('@/app/api/drafts/[id]/redraft/submission/route'), ['GET', 'PUT'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/undo (admin: pool id)', () => import('@/app/api/drafts/[id]/undo/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/replay-events (admin: pool id)', () => import('@/app/api/drafts/[id]/replay-events/route'), ['POST'], 'id', {}, 'POOL_NOT_FOUND'],
  ['drafts/[id]/redraft/submissions (admin: pool id)', () => import('@/app/api/drafts/[id]/redraft/submissions/route'), ['GET'], 'id', {}, 'POOL_NOT_FOUND'],
  ['evolutions/[id]', () => import('@/app/api/evolutions/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_EVOLUTION_TIER_ID'],
  ['generate-round/[tid]', () => import('@/app/api/generate-round/[tid]/route'), ['POST'], 'tid', {}, 'INVALID_TOURNAMENT_ID'],
  ['match-proposals/[id]/accept', () => import('@/app/api/match-proposals/[id]/accept/route'), ['POST'], 'id', {}, 'INVALID_PROPOSAL_ID'],
  ['match-proposals/[id]/reject', () => import('@/app/api/match-proposals/[id]/reject/route'), ['POST'], 'id', {}, 'INVALID_PROPOSAL_ID'],
  ['matches/[id]/epb-replay-viewed', () => import('@/app/api/matches/[id]/epb-replay-viewed/route'), ['GET', 'POST'], 'id', {}, 'INVALID_MATCH_ID'],
  ['matches/[id]/proposals', () => import('@/app/api/matches/[id]/proposals/route'), ['GET', 'POST'], 'id', {}, 'INVALID_MATCH_ID'],
  ['players/[id]', () => import('@/app/api/players/[id]/route'), ['GET', 'PATCH', 'DELETE'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['players/[id]/avatar', () => import('@/app/api/players/[id]/avatar/route'), ['POST', 'DELETE'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['players/[id]/claim', () => import('@/app/api/players/[id]/claim/route'), ['POST'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['players/[id]/profile', () => import('@/app/api/players/[id]/profile/route'), ['GET'], 'id', {}, 'INVALID_PLAYER_ID'],
  ['point-buy-lists/[id]', () => import('@/app/api/point-buy-lists/[id]/route'), ['GET', 'PATCH'], 'id', {}, 'INVALID_POINT_BUY_LIST_ID'],
  ['point-buy-lists/[id]/entries', () => import('@/app/api/point-buy-lists/[id]/entries/route'), ['GET', 'POST'], 'id', {}, 'INVALID_POINT_BUY_LIST_ID'],
  ['rulesets/[id]', () => import('@/app/api/rulesets/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_RULESET_ID'],
  ['seasons/[id]', () => import('@/app/api/seasons/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/advance', () => import('@/app/api/seasons/[id]/advance/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/comeback-tokens/open', () => import('@/app/api/seasons/[id]/comeback-tokens/open/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/comeback-tokens/spend', () => import('@/app/api/seasons/[id]/comeback-tokens/spend/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/cores', () => import('@/app/api/seasons/[id]/cores/route'), ['PATCH'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/cores/assign', () => import('@/app/api/seasons/[id]/cores/assign/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/draft-kill-tokens', () => import('@/app/api/seasons/[id]/draft-kill-tokens/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/evolution-points/recalculate', () => import('@/app/api/seasons/[id]/evolution-points/recalculate/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/format-rules', () => import('@/app/api/seasons/[id]/format-rules/route'), ['GET', 'PUT'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/groups', () => import('@/app/api/seasons/[id]/groups/route'), ['GET', 'PUT'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/groups/members', () => import('@/app/api/seasons/[id]/groups/members/route'), ['PATCH'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/groups/[groupId] (season id)', () => import('@/app/api/seasons/[id]/groups/[groupId]/route'), ['PATCH'], 'id', { groupId: VALID }, 'INVALID_SEASON_ID'],
  ['seasons/[id]/groups/[groupId] (group id)', () => import('@/app/api/seasons/[id]/groups/[groupId]/route'), ['PATCH'], 'groupId', { id: VALID }, 'INVALID_GROUP_ID'],
  ['seasons/[id]/phases/[phaseId]/groups (season id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/route'), ['POST', 'DELETE'], 'id', { phaseId: VALID }, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/[phaseId]/groups (phase id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/route'), ['POST', 'DELETE'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/phases/[phaseId]/groups/members (season id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/members/route'), ['PATCH'], 'id', { phaseId: VALID }, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/[phaseId]/groups/members (phase id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/members/route'), ['PATCH'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/phases/[phaseId]/groups/repair (season id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/repair/route'), ['POST'], 'id', { phaseId: VALID }, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/[phaseId]/groups/repair (phase id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/groups/repair/route'), ['POST'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/participants', () => import('@/app/api/seasons/[id]/participants/route'), ['POST', 'DELETE', 'PATCH'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/participants/substitute', () => import('@/app/api/seasons/[id]/participants/substitute/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases', () => import('@/app/api/seasons/[id]/phases/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/reorder', () => import('@/app/api/seasons/[id]/phases/reorder/route'), ['POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/[phaseId] (season id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/route'), ['PATCH', 'DELETE'], 'id', { phaseId: VALID }, 'INVALID_SEASON_ID'],
  ['seasons/[id]/phases/[phaseId] (phase id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/route'), ['PATCH', 'DELETE'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/phases/[phaseId]/participants (phase id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/route'), ['POST', 'DELETE', 'PATCH'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/phases/[phaseId]/participants/seed-by-rating', () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/seed-by-rating/route'), ['POST'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/phases/[phaseId]/participants/sync-standings', () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/sync-standings/route'), ['POST'], 'phaseId', { id: VALID }, 'INVALID_PHASE_ID'],
  ['seasons/[id]/progress', () => import('@/app/api/seasons/[id]/progress/route'), ['GET', 'POST'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/redraft', () => import('@/app/api/seasons/[id]/redraft/route'), ['GET'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/redraft/phase', () => import('@/app/api/seasons/[id]/redraft/phase/route'), ['GET', 'PATCH'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/tokens', () => import('@/app/api/seasons/[id]/tokens/route'), ['GET'], 'id', {}, 'INVALID_SEASON_ID'],
  ['seasons/[id]/tokens/me', () => import('@/app/api/seasons/[id]/tokens/me/route'), ['GET'], 'id', {}, 'INVALID_SEASON_ID'],
  ['social-integrations/[id]', () => import('@/app/api/social-integrations/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_INTEGRATION_ID'],
  ['social-integrations/[id]/test', () => import('@/app/api/social-integrations/[id]/test/route'), ['POST'], 'id', {}, 'INVALID_INTEGRATION_ID'],
  ['teams/[id]', () => import('@/app/api/teams/[id]/route'), ['GET', 'PATCH', 'DELETE'], 'id', {}, 'INVALID_TEAM_ID'],
  ['tournaments/[id]', () => import('@/app/api/tournaments/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/generate-all-rounds', () => import('@/app/api/tournaments/[id]/generate-all-rounds/route'), ['POST'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/generate-bracket', () => import('@/app/api/tournaments/[id]/generate-bracket/route'), ['POST'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/participants', () => import('@/app/api/tournaments/[id]/participants/route'), ['POST', 'DELETE', 'PATCH'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/regenerate-bracket', () => import('@/app/api/tournaments/[id]/regenerate-bracket/route'), ['POST'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/repair-bracket', () => import('@/app/api/tournaments/[id]/repair-bracket/route'), ['POST'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/rounds/manual', () => import('@/app/api/tournaments/[id]/rounds/manual/route'), ['POST'], 'id', {}, 'INVALID_TOURNAMENT_ID'],
  ['tournaments/[id]/rounds/[rid] (round id)', () => import('@/app/api/tournaments/[id]/rounds/[rid]/route'), ['PATCH'], 'rid', { id: VALID }, 'INVALID_ROUND_ID'],
  ['tournaments/[id]/rounds/[rid]/matches/[mid]/repair (round id)', () => import('@/app/api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair/route'), ['PATCH'], 'rid', { id: VALID, mid: VALID }, 'INVALID_ROUND_ID'],
  ['tournaments/[id]/rounds/[rid]/matches/[mid]/repair (match id)', () => import('@/app/api/tournaments/[id]/rounds/[rid]/matches/[mid]/repair/route'), ['PATCH'], 'mid', { id: VALID, rid: VALID }, 'INVALID_MATCH_ID'],
  ['wiki/notes/[id]', () => import('@/app/api/wiki/notes/[id]/route'), ['PATCH', 'DELETE'], 'id', {}, 'INVALID_NOTE_ID'],
  ['wiki/notes/[id]/report', () => import('@/app/api/wiki/notes/[id]/report/route'), ['POST'], 'id', {}, 'INVALID_NOTE_ID'],
];

/** The resource-admin guard refuses a malformed season / tournament id itself, with the same 404. */
const RESOURCE_ADMIN_CASES: Case[] = [
  ['seasons/[id]/phases/[phaseId]/participants (season id)', () => import('@/app/api/seasons/[id]/phases/[phaseId]/participants/route'), ['POST'], 'id', { phaseId: VALID }, 'INVALID_SEASON_ID'],
  ['tournaments/[id]/rounds/[rid] (tournament id)', () => import('@/app/api/tournaments/[id]/rounds/[rid]/route'), ['PATCH'], 'id', { rid: VALID }, 'INVALID_TOURNAMENT_ID'],
];

function request(method: Method): NextRequest {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' };
  const body = method !== 'GET' && method !== 'DELETE' ? '{}' : undefined;
  return new NextRequest('http://localhost:3000/api/x', { method, headers, body });
}

/** First import of a route transforms its dependency graph: give it its own budget. */
const ROUTE_IMPORT_TIMEOUT_MS = 60_000;

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('authenticated path-id guards', () => {
  describe.each([...CASES, ...RESOURCE_ADMIN_CASES])('%s', (_name, load, methods, param, otherParams, code) => {
    let mod: Partial<Record<Method, unknown>>;
    beforeAll(async () => {
      mod = await load();
    }, ROUTE_IMPORT_TIMEOUT_MS);

    it.each(methods.flatMap((m) => MALFORMED.map((bad) => [m, bad] as const)))(
      `%s answers 404 ${code} for %j without touching the database`,
      async (method, bad) => {
        touched.length = 0;
        const handler = mod[method] as Handler | undefined;
        expect(handler, `${method} is exported`).toBeTypeOf('function');

        const res = await handler!(request(method), { params: Promise.resolve({ ...otherParams, [param]: bad }) });

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ success: false, error: expect.any(String), code });
        expect(touched).toEqual([]);
      }
    );
  });
});

describe('drafts/route.ts: the season id query parameter (GET /api/drafts?season_id=)', () => {
  let GET: (req: NextRequest) => Promise<Response>;
  beforeAll(async () => {
    ({ GET } = await import('@/app/api/drafts/route'));
  }, ROUTE_IMPORT_TIMEOUT_MS);

  it.each(MALFORMED)('answers 404 INVALID_SEASON_ID for %j without touching the database', async (bad) => {
    touched.length = 0;
    const url = `http://localhost:3000/api/drafts?season_id=${encodeURIComponent(bad)}`;
    const res = await GET(new NextRequest(url, { method: 'GET' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: expect.any(String), code: 'INVALID_SEASON_ID' });
    expect(touched).toEqual([]);
  });
});
