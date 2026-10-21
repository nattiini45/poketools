/**
 * Token routes (draft-backend §8.1 #25–#28, §14.1): guards (own-only for players, season admin for
 * other players and the admin routes), zod 400 `validation_failed`, RPC argument mapping, the season
 * read expiry on success only, and RPC refusals → `errors/draft` code + status + params/detail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeParams, makeRequest } from '@/lib/__tests__/helpers/api-request';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: MockAuthError,
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn(), getSeasonParticipants: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ expireSeasonReads: vi.fn(), expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({
  purchaseDraftKillToken: vi.fn(),
  spendComebackTokens: vi.fn(),
}));
vi.mock('../_lib/overview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../_lib/overview')>();
  return {
    ...actual,
    getEpbSeason: vi.fn(),
    loadTokenSeasonContext: vi.fn(),
    buildTokenOverview: vi.fn(),
  };
});

import { GET as getMine } from '../me/route';
import { GET as getAll } from '../route';
import { POST as buyDraftKillToken } from '../../draft-kill-tokens/route';
import { POST as spendComeback } from '../../comeback-tokens/spend/route';
import { POST as openComeback } from '../../comeback-tokens/open/route';
import { requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { supabase } from '@/lib/supabase/client';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { expireSeasonReads } from '@/lib/revalidation';
import { purchaseDraftKillToken, spendComebackTokens } from '@/lib/draft/progress-engine';
import { DraftRuleError } from '@/lib/draft/errors';
import { buildTokenOverview, getEpbSeason, loadTokenSeasonContext } from '../_lib/overview';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { TokenOverviewDTO } from '@/types/draft-queue';

const SEASON = '00000000-0000-4000-8000-0000000000a1';
const LIST = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const ADMIN = '00000000-0000-4000-8000-0000000000c1';
const REQ = '00000000-0000-4000-8000-0000000000d1';
const LINE = 'chikorita--meganium';

const params = makeParams({ id: SEASON });
const season = { id: SEASON, point_buy_list_id: LIST };
const ctx = { seasonId: SEASON } as never;

function overviewFor(playerId: string): TokenOverviewDTO {
  return {
    season_id: SEASON,
    player_id: playerId,
    initial_draft_complete: true,
    redraft_complete: false,
    draft_kill: { window: 'open', cutoff_at: null, cost: 3, max: 2, owned: 1, unspent_points: 7, lines: [] },
    comeback: { earned: 0, spent: 0, unspent: 0, history: [], spend_open: false, earn_window: 'season' },
    cosmo: null,
    lines: [],
  };
}

/** A PostgREST rule refusal as the token RPCs raise it (P0001 + code + DETAIL json). */
function rpcRefusal(code: string, details: Record<string, unknown> = {}) {
  return { code: 'P0001', message: code, details: JSON.stringify(details), hint: null };
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId: P1 }));
  vi.mocked(requireResourceAdmin).mockRejectedValue(new MockAuthError('Admin access required for this resource', 403));
  vi.mocked(getEpbSeason).mockResolvedValue(season);
  vi.mocked(loadTokenSeasonContext).mockResolvedValue(ctx);
  vi.mocked(buildTokenOverview).mockImplementation((_c, playerId) => overviewFor(playerId));
});

describe('GET /api/seasons/[id]/tokens/me (#25)', () => {
  it('returns the viewer\'s own overview, read for the viewer only', async () => {
    const res = await getMine(makeRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, data: overviewFor(P1) });
    expect(loadTokenSeasonContext).toHaveBeenCalledWith(season, P1);
    expect(requireResourceAdmin).not.toHaveBeenCalled();
    expectNoPrivatePlayerData(json);
  });

  it('?player_id= of another player needs season admin rights: 403 before any read', async () => {
    const res = await getMine(makeRequest(undefined, { player_id: P2 }), { params });
    expect(res.status).toBe(403);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON);
    expect(loadTokenSeasonContext).not.toHaveBeenCalled();
  });

  it('a season admin reads another player\'s overview; an own ?player_id needs no admin', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: P1, isResourceAdmin: true }));
    const res = await getMine(makeRequest(undefined, { player_id: P2 }), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).data.player_id).toBe(P2);
    expect(loadTokenSeasonContext).toHaveBeenCalledWith(season, P2);

    vi.mocked(requireResourceAdmin).mockClear();
    const own = await getMine(makeRequest(undefined, { player_id: P1 }), { params });
    expect(own.status).toBe(200);
    expect(requireResourceAdmin).not.toHaveBeenCalled();
  });

  it('rejects a malformed player_id (400 validation_failed) and an anonymous caller (401)', async () => {
    const bad = await getMine(makeRequest(undefined, { player_id: 'not-a-uuid' }), { params });
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('validation_failed');

    vi.mocked(requirePlayer).mockRejectedValue(new MockAuthError('Not authenticated', 401));
    const anon = await getMine(makeRequest(), { params });
    expect(anon.status).toBe(401);
    expect(getEpbSeason).not.toHaveBeenCalled();
  });

  it('a league outside Evolution Point Buy answers its format code', async () => {
    vi.mocked(getEpbSeason).mockRejectedValue(
      new UserFacingError('This season does not use the Evolution Point Buy format', { code: 'format_mismatch', status: 400 }),
    );
    const res = await getMine(makeRequest(), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('format_mismatch');
  });
});

describe('GET /api/seasons/[id]/tokens (#25b, admin)', () => {
  it('403 for a player before any read', async () => {
    const res = await getAll(makeRequest(), { params });
    expect(res.status).toBe(403);
    expect(getSeasonParticipants).not.toHaveBeenCalled();
    expect(loadTokenSeasonContext).not.toHaveBeenCalled();
  });

  it('one overview per participant from one season context; participant rows never leave', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: ADMIN, isAdmin: true }));
    vi.mocked(getSeasonParticipants).mockResolvedValue([
      fullPlayerRow({ id: P2 }),
      fullPlayerRow({ id: P1 }),
    ] as never);
    const res = await getAll(makeRequest(), { params });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.overviews.map((o: TokenOverviewDTO) => o.player_id)).toEqual([P1, P2]);
    expect(loadTokenSeasonContext).toHaveBeenCalledTimes(1);
    expect(loadTokenSeasonContext).toHaveBeenCalledWith(season);
    expectNoPrivatePlayerData(json);
  });
});

describe('POST /api/seasons/[id]/draft-kill-tokens (#26)', () => {
  const body = { line_id: LINE, client_request_id: REQ };

  it('buys one Draft Kill Token for the caller, expires the season reads and returns the fresh overview', async () => {
    vi.mocked(purchaseDraftKillToken).mockResolvedValue({
      purchase_id: 'pu1',
      tracker_id: 't1',
      line_id: LINE,
      points_spent: 3,
      replay: false,
    });
    const res = await buyDraftKillToken(makeRequest(body), { params });
    expect(res.status).toBe(200);
    expect(purchaseDraftKillToken).toHaveBeenCalledWith(SEASON, P1, LINE, REQ, P1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON);
    expect(loadTokenSeasonContext).toHaveBeenCalledWith(season, P1);
    expect((await res.json()).data).toEqual(overviewFor(P1));
  });

  it('players buy only for themselves: a player_id in the body is a 400 (strict body)', async () => {
    const res = await buyDraftKillToken(makeRequest({ ...body, player_id: P2 }), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(purchaseDraftKillToken).not.toHaveBeenCalled();
  });

  it('rejects a bad line id, a missing request id and malformed JSON', async () => {
    for (const bad of [{ line_id: 'Chikorita', client_request_id: REQ }, { line_id: LINE }]) {
      const res = await buyDraftKillToken(makeRequest(bad), { params });
      expect(res.status).toBe(400);
    }
    const req = makeRequest(body);
    vi.mocked(req.json).mockRejectedValue(new SyntaxError('Unexpected token'));
    const res = await buyDraftKillToken(req, { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
    expect(purchaseDraftKillToken).not.toHaveBeenCalled();
  });

  it.each([
    ['TOKEN_WOULD_EVOLVE', { next: 2, progress: 1 }, 422, { next: 2, progress: 1 }, undefined],
    ['TOKEN_WINDOW_CLOSED', { window: 'closed' }, 409, undefined, { window: 'closed' }],
    ['TOKEN_PLAYER_LIMIT', { max: 2 }, 422, { max: 2 }, undefined],
    ['TOKEN_LINE_LIMIT', {}, 422, undefined, undefined],
    ['TOKEN_POINTS_SHORT', { needed: 3, remaining: 2 }, 422, { needed: 3, remaining: 2 }, undefined],
    ['LINE_FULLY_EVOLVED', {}, 422, undefined, undefined],
    ['TRACKER_NOT_OWNED', { line_id: LINE }, 422, undefined, { line_id: LINE }],
  ])('RPC refusal %s → %s with its params and detail; nothing expires', async (code, details, status, p, detail) => {
    vi.mocked(purchaseDraftKillToken).mockRejectedValue(rpcRefusal(code, details));
    const res = await buyDraftKillToken(makeRequest(body), { params });
    const json = await res.json();
    expect(res.status).toBe(status);
    expect(json.code).toBe(code);
    expect(json.params).toEqual(p);
    expect(json.detail).toEqual(detail);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });

  it('an unexpected failure is a logged 500 with the static fallback', async () => {
    vi.mocked(purchaseDraftKillToken).mockRejectedValue(new Error('connection reset'));
    const res = await buyDraftKillToken(makeRequest(body), { params });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to buy a Draft Kill Token');
    expect(consoleError).toHaveBeenCalled();
  });

  it('401 for an anonymous caller before anything else', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new MockAuthError('Not authenticated', 401));
    const res = await buyDraftKillToken(makeRequest(body), { params });
    expect(res.status).toBe(401);
    expect(getEpbSeason).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/comeback-tokens/spend (#27)', () => {
  const allocations = [
    { line_id: LINE, count: 2 },
    { line_id: 'igglybuff--wigglytuff', count: 1 },
  ];

  it('spends the caller\'s Comeback Tokens and returns the fresh overview', async () => {
    vi.mocked(spendComebackTokens).mockResolvedValue({
      spent: 3,
      balance_after: 1,
      tracker_ids: ['t1', 't2'],
      replay: false,
      earned: 4,
    });
    const res = await spendComeback(makeRequest({ allocations, client_request_id: REQ }), { params });
    expect(res.status).toBe(200);
    // The season's list decides each line's tokens-per-progress rate server-side.
    expect(spendComebackTokens).toHaveBeenCalledWith(SEASON, LIST, P1, allocations, REQ, P1);
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON);
    expect((await res.json()).data.player_id).toBe(P1);
  });

  it.each([
    ['no allocation', { allocations: [], client_request_id: REQ }],
    ['ten lines', { allocations: Array.from({ length: 10 }, (_, i) => ({ line_id: `a${i}--b${i}`, count: 1 })), client_request_id: REQ }],
    ['count 21', { allocations: [{ line_id: LINE, count: 21 }], client_request_id: REQ }],
    ['count 0', { allocations: [{ line_id: LINE, count: 0 }], client_request_id: REQ }],
    ['a repeated line', { allocations: [{ line_id: LINE, count: 1 }, { line_id: LINE, count: 1 }], client_request_id: REQ }],
    ['another player', { allocations, client_request_id: REQ, player_id: P2 }],
    // The per-line comeback rate is server-side: a client can never set it.
    ['a client-sent ratio', { allocations: [{ line_id: LINE, count: 1, ratio: 1 }], client_request_id: REQ }],
  ])('400 validation_failed for %s', async (_name, body) => {
    const res = await spendComeback(makeRequest(body), { params });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(spendComebackTokens).not.toHaveBeenCalled();
  });

  it.each([
    ['COMEBACK_NOT_YET', {}, 409, undefined],
    ['COMEBACK_BALANCE_SHORT', { balance: 1 }, 422, { balance: 1 }],
    ['COMEBACK_TOKENS_NOT_MULTIPLE', { ratio: 2 }, 422, { ratio: 2 }],
  ])('RPC refusal %s → %s', async (code, details, status, p) => {
    vi.mocked(spendComebackTokens).mockRejectedValue(rpcRefusal(code, details));
    const res = await spendComeback(makeRequest({ allocations, client_request_id: REQ }), { params });
    const json = await res.json();
    expect(res.status).toBe(status);
    expect(json).toMatchObject({ success: false, code });
    expect(json.params).toEqual(p);
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/comeback-tokens/spend — TS pre-check refusals', () => {
  it('a count that is not a multiple of the line rate → 422 COMEBACK_TOKENS_NOT_MULTIPLE {ratio}', async () => {
    vi.mocked(spendComebackTokens).mockRejectedValue(new DraftRuleError('COMEBACK_TOKENS_NOT_MULTIPLE', { ratio: 2 }));
    const res = await spendComeback(
      makeRequest({ allocations: [{ line_id: LINE, count: 3 }], client_request_id: REQ }),
      { params },
    );
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json).toMatchObject({ success: false, code: 'COMEBACK_TOKENS_NOT_MULTIPLE', params: { ratio: 2 } });
    expect(expireSeasonReads).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/comeback-tokens/open (#28, admin)', () => {
  it('403 for a player before the body is read or the RPC runs', async () => {
    const req = makeRequest({ open: true });
    const res = await openComeback(req, { params });
    expect(res.status).toBe(403);
    expect(req.json).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('sets the switch through the RPC, expires the season reads and echoes the state', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: ADMIN, isAdmin: true }));
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
    const res = await openComeback(makeRequest({ open: true }), { params });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { open: true } });
    expect(supabase.rpc).toHaveBeenCalledWith('epb_set_comeback_spend_open', {
      p_season_id: SEASON,
      p_actor_id: ADMIN,
      p_open: true,
    });
    expect(expireSeasonReads).toHaveBeenCalledWith(SEASON);
  });

  it('a league without format rules → 422 INVALID_CONFIG {field}; a bad body → 400', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(makePlayer({ playerId: ADMIN, isAdmin: true }));
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: rpcRefusal('INVALID_CONFIG', { field: 'format_rules' }) } as never);
    const res = await openComeback(makeRequest({ open: true }), { params });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'INVALID_CONFIG', params: { field: 'format_rules' } });
    expect(expireSeasonReads).not.toHaveBeenCalled();

    const bad = await openComeback(makeRequest({ open: 'yes' }), { params });
    expect(bad.status).toBe(400);
  });
});
