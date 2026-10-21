import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';
import { createTranslator } from '@/i18n/core';
import { errorsDraft } from '@/i18n/messages/errors/draft';

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));

vi.mock('@/lib/draft/redraft-engine', () => ({
  getRedraftEligibleLines: vi.fn(),
}));

vi.mock('@/lib/draft/progress-engine', () => ({
  computeRemainingPoints: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  expireDraftReads: vi.fn(),
  expireSeasonReads: vi.fn(),
}));

import { GET, POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getRedraftEligibleLines } from '@/lib/draft/redraft-engine';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { expireDraftReads, expireSeasonReads } from '@/lib/revalidation';

// ── Fixtures ──────────────────────────────────────────────────────────

const seasonId = '00000000-0000-4000-8000-000000000001';
const listVersionId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';
const playerId = '00000000-0000-4000-8000-000000000004';
const partnerId = '00000000-0000-4000-8000-000000000005';
const fromTrackerId = '00000000-0000-4000-8000-000000000006';
const toEntryId = '00000000-0000-4000-8000-000000000008';

const adminPlayer = makePlayer({ playerId: adminId, isAdmin: true });

const epbSeason = {
  id: seasonId,
  format_type: 'evolution_point_buy',
  point_buy_list_id: listVersionId,
} as never;

const rulesOpen = {
  redraft_phase_open: true,
  draft_budget: 180,
  draft_token_ratio: 3,
} as never;

const fromTracker = {
  id: fromTrackerId,
  season_id: seasonId,
  player_id: playerId,
  base_pokemon: 'Charmander',
  current_form: 'Charmander',
  current_stage: 1,
  total_kos: 0,
  real_kills: 0,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
  line_id: 'charmander--charizard',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSeasonById).mockResolvedValue(epbSeason);
  vi.mocked(getFormatRules).mockResolvedValue(rulesOpen);
  vi.mocked(getListEntries).mockResolvedValue([] as never);
  vi.mocked(computeRemainingPoints).mockResolvedValue(100 as never);
});

/** Nothing is read or written by the retired POST. */
function expectUntouched() {
  expect(getSeasonById).not.toHaveBeenCalled();
  expect(getFormatRules).not.toHaveBeenCalled();
  expect(getListEntries).not.toHaveBeenCalled();
  expect(computeRemainingPoints).not.toHaveBeenCalled();
  expect(expireDraftReads).not.toHaveBeenCalled();
  expect(expireSeasonReads).not.toHaveBeenCalled();
}

/** A real POST request with a raw body (the retired POST never reads it). */
function postRaw(body: string | null): NextRequest {
  return new NextRequest(`http://localhost:3000/api/seasons/${seasonId}/redraft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === null ? {} : { body }),
  });
}

/** A real POST request with a JSON body. */
function post(body: unknown): NextRequest {
  return postRaw(JSON.stringify(body));
}

const TRADE_RETIRED = {
  success: false,
  error: 'Trades were retired. Lines change hands only through the secret-drop redraft.',
  code: 'REDRAFT_TRADE_RETIRED',
};

const trade = {
  player_id: playerId,
  from_tracker_id: fromTrackerId,
  to_line_entry_id: toEntryId,
  transfer_type: 'trade',
  trade_partner_id: partnerId,
};

describe('POST /api/seasons/[id]/redraft — trades retired', () => {
  it.each([
    ['an admin trade execute', adminPlayer, trade],
    ['an admin trade preview', adminPlayer, { ...trade, preview: true }],
    ['a player trade', makePlayer({ playerId }), trade],
    ['a body without transfer_type', adminPlayer, { player_id: playerId }],
    ['an empty body', adminPlayer, {}],
  ])('%s answers 410 REDRAFT_TRADE_RETIRED and touches nothing', async (_name, caller, body) => {
    vi.mocked(requirePlayer).mockResolvedValue(caller);
    const res = await POST(post(body));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(TRADE_RETIRED);
    expectUntouched();
  });

  it.each([
    ['no body at all', null],
    ['an empty body', ''],
    ['a whitespace-only body', ' \n\t '],
    ['malformed JSON', '{"transfer_type": "free_swap",'],
    ['a non-JSON text body', 'trade please'],
    ['a JSON array', '[]'],
    ['JSON null', 'null'],
    ['a JSON string', '"free_swap"'],
  ])('%s answers 410 REDRAFT_TRADE_RETIRED, never a 500', async (_name, raw) => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId }));
    const res = await POST(postRaw(raw));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(TRADE_RETIRED);
    expectUntouched();
  });

  it('a malformed body from an anonymous caller is still 401 (auth before the body)', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new MockAuthError('Not authenticated', 401));
    const res = await POST(postRaw('{not json'));
    expect(res.status).toBe(401);
  });

  it('never reads the body: the retired answer cannot depend on it', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId }));
    const req = postRaw('{"transfer_type": "free_swap"}');
    const text = vi.spyOn(req, 'text');
    const json = vi.spyOn(req, 'json');
    const res = await POST(req);
    expect(res.status).toBe(410);
    expect(text).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
  });

  it('an unexpected failure is a logged 500, not a retired answer', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new Error('auth backend down'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(post(trade));
      expect(res.status).toBe(500);
      expect((await res.json()).code).not.toBe('REDRAFT_TRADE_RETIRED');
      expect(errorLog).toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });

  it('the code has its English and German catalog text', () => {
    expect(createTranslator(errorsDraft, 'en').dynamic('REDRAFT_TRADE_RETIRED')).toBe(
      'Trades were retired. Lines change hands only through the secret-drop redraft.',
    );
    expect(createTranslator(errorsDraft, 'de').dynamic('REDRAFT_TRADE_RETIRED')).toBe(
      'Trades wurden abgeschafft. Linien wechseln nur noch über den Redraft mit verdeckter Abgabe.',
    );
  });

  it('an anonymous caller gets 401, not the retired answer', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(new MockAuthError('Not authenticated', 401));
    const res = await POST(post(trade));
    expect(res.status).toBe(401);
    expect((await res.json()).code).not.toBe('REDRAFT_TRADE_RETIRED');
    expectUntouched();
  });
});

describe('POST /api/seasons/[id]/redraft — a former free swap gets the same answer', () => {
  const freeSwap = {
    player_id: playerId,
    from_tracker_id: fromTrackerId,
    to_line_entry_id: toEntryId,
    transfer_type: 'free_swap',
  };

  it.each([
    ['a player execute', makePlayer({ playerId }), freeSwap],
    ['a player preview', makePlayer({ playerId }), { ...freeSwap, preview: true }],
    ['an admin acting for another player', adminPlayer, freeSwap],
  ])('%s answers 410 REDRAFT_TRADE_RETIRED and touches nothing', async (_name, caller, body) => {
    vi.mocked(requirePlayer).mockResolvedValue(caller);
    const res = await POST(post(body));
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(TRADE_RETIRED);
    expectUntouched();
  });
});

describe('GET /api/seasons/[id]/redraft — read-only state (kept)', () => {
  it('GET: the redraft state no longer carries the retired free_lines', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId, isAdmin: false }));
    vi.mocked(getRedraftEligibleLines).mockResolvedValue([fromTracker] as never);
    const res = await GET(makeRequest(undefined, { player_id: playerId }), { params: makeParams({ id: seasonId }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).not.toHaveProperty('free_lines');
    expect(json.data).toMatchObject({ remaining_points: 100, redraft_phase_open: true });
    expect(json.data.eligible_lines).toHaveLength(1);
  });

  it("GET: another player's redraft state is a coded 403", async () => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId, isAdmin: false }));
    const req = makeRequest(undefined, { player_id: partnerId });
    const res = await GET(req, { params: makeParams({ id: seasonId }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'You can only view your own redraft state',
      code: 'redraft_state_not_own',
    });
  });
});
