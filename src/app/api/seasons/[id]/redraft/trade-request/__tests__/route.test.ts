import { describe, it, expect, vi, beforeEach } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireResourceAdmin: vi.fn(),
  AuthError: MockAuthError,
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/format-rules', () => ({
  getFormatRules: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getListEntries: vi.fn(),
}));

// The real module is loaded only for its DB-free parts (the typed RPC error and
// its reason → code map); the client it imports is stubbed, every query mocked.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));

vi.mock('@/lib/supabase/queries/redraft-trade-requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries/redraft-trade-requests')>();
  return {
    createTradeRequest: vi.fn(),
    getTradeRequest: vi.fn(),
    getPendingTradeRequestsForPlayer: vi.fn(),
    getPendingTradeRequestsForSeason: vi.fn(),
    setConsent: vi.fn(),
    executeTradeRequest: vi.fn(),
    cancelTradeRequest: vi.fn(),
    TradeRequestExecutionError: actual.TradeRequestExecutionError,
    tradeRpcRejection: actual.tradeRpcRejection,
  };
});

vi.mock('@/lib/draft/redraft-engine', () => ({
  prepareRedraftSwap: vi.fn(),
}));

vi.mock('@/lib/draft/progress-engine', () => ({
  computeRemainingPoints: vi.fn(),
}));

// special-rules is real (isRedraftExcluded / isCosmogLine are pure). Only mock
// if a test needs to force exclusion; otherwise let it run.

import { POST as createTradeRequestRoute } from '../route';
import { POST as consentRoute } from '../[rid]/consent/route';
import { POST as cancelRoute } from '../[rid]/cancel/route';
import {
  GET as listTradeRequestsRoute,
} from '../../trade-requests/route';

import { requirePlayer, requireResourceAdmin } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import {
  createTradeRequest,
  getTradeRequest,
  setConsent,
  executeTradeRequest,
  cancelTradeRequest,
  getPendingTradeRequestsForPlayer,
  getPendingTradeRequestsForSeason,
  TradeRequestExecutionError,
} from '@/lib/supabase/queries/redraft-trade-requests';
import { prepareRedraftSwap } from '@/lib/draft/redraft-engine';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { revalidateTag } from 'next/cache';
import { participationLineBase } from '@/lib/format-pack';

// ── Fixtures ──────────────────────────────────────────────────────────

const seasonId = '00000000-0000-4000-8000-000000000001';
const listVersionId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';
const playerAId = '00000000-0000-4000-8000-000000000004';
const playerBId = '00000000-0000-4000-8000-000000000005';
const trackerAId = '00000000-0000-4000-8000-000000000006';
const trackerBId = '00000000-0000-4000-8000-000000000007';
const requestId = '00000000-0000-4000-8000-000000000008';

const epbSeason = {
  id: seasonId,
  format_type: 'evolution_point_buy',
  point_buy_list_id: listVersionId,
} as never;

// Same season but a non-EPB format — assertEpbSeason must reject it.
const nonEpbSeason = {
  id: seasonId,
  format_type: 'draft',
  point_buy_list_id: listVersionId,
} as never;

const rulesOpen = {
  redraft_phase_open: true,
  draft_budget: 100,
  draft_token_ratio: 3,
};

const adminPlayer = makePlayer({ playerId: adminId, isAdmin: true });
const playerA = makePlayer({ playerId: playerAId, name: 'Alice' });
const playerB = makePlayer({ playerId: playerBId, name: 'Bob' });

const trackerA = {
  id: trackerAId,
  season_id: seasonId,
  player_id: playerAId,
  base_pokemon: 'Charmander',
  current_form: 'Charmander',
  current_stage: 1,
  total_kos: 0,
  real_kills: 0,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
};

const trackerB = {
  id: trackerBId,
  season_id: seasonId,
  player_id: playerBId,
  base_pokemon: 'Bulbasaur',
  current_form: 'Bulbasaur',
  current_stage: 1,
  total_kos: 0,
  real_kills: 0,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
};

const entryA = {
  id: 'ea',
  list_version_id: listVersionId,
  base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon',
  stage3_pokemon: 'Charizard',
  price: 10,
  kills_to_stage2: 5,
  additional_kills_to_stage3: 10,
  special_rules: null,
};

const entryB = {
  id: 'eb',
  list_version_id: listVersionId,
  base_pokemon: 'Bulbasaur',
  stage2_pokemon: 'Ivysaur',
  stage3_pokemon: 'Venusaur',
  price: 10,
  kills_to_stage2: 5,
  additional_kills_to_stage3: 10,
  special_rules: null,
};

function makeRequestRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: requestId,
    season_id: seasonId,
    initiated_by: adminId,
    player_a_id: playerAId,
    from_tracker_a_id: trackerAId,
    line_a: 'Charmander',
    player_b_id: playerBId,
    from_tracker_b_id: trackerBId,
    line_b: 'Bulbasaur',
    status: 'pending',
    consent_a: false,
    consent_b: false,
    created_at: '2026-08-13T00:00:00Z',
    executed_at: null,
    cancelled_at: null,
    cancelled_by: null,
    executed_tracker_ids: null,
    ...overrides,
  } as never;
}

// A successful prepareRedraftSwap result: both sides swap equal-priced lines.
function makePreparedSwap(pointsSpent = 0) {
  return {
    swap: {
      points_spent: pointsSpent,
      payload: {
        player_id: playerAId,
        from_tracker_id: trackerAId,
        new_tracker: {
          base_pokemon: 'Bulbasaur',
          current_form: 'Bulbasaur',
          current_stage: 1,
          total_kos: 0,
          real_kills: 0,
          evolution_points_awarded: 0,
          locked_stage3_pokemon: 'Venusaur',
        },
        history: {
          to_base_pokemon: 'Bulbasaur',
          to_stage3_pokemon: 'Venusaur',
          transfer_type: 'trade',
          trade_partner_id: playerBId,
          missing_kills_transferred: 0,
          points_spent: pointsSpent,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults so individual tests only override what they assert.
  vi.mocked(getSeasonById).mockResolvedValue(epbSeason);
  vi.mocked(getFormatRules).mockResolvedValue(rulesOpen as never);
  vi.mocked(getSeasonTrackers).mockResolvedValue([trackerA, trackerB] as never);
  vi.mocked(getListEntries).mockResolvedValue([entryA, entryB] as never);
  vi.mocked(computeRemainingPoints).mockResolvedValue(100 as never);
  vi.mocked(prepareRedraftSwap).mockResolvedValue(makePreparedSwap() as never);
  vi.mocked(executeTradeRequest).mockResolvedValue(['new-ta', 'new-tb'] as never);
  // List route defaults (only used by the list describe block).
  vi.mocked(getPendingTradeRequestsForPlayer).mockResolvedValue([makeRequestRow()] as never);
  vi.mocked(getPendingTradeRequestsForSeason).mockResolvedValue([makeRequestRow()] as never);
});

// ── Create endpoint ──────────────────────────────────────────────────

describe('POST /api/seasons/[id]/redraft/trade-request (create)', () => {
  it('returns 200 with a pending request when a resource admin initiates', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createTradeRequest).mockResolvedValue(makeRequestRow());

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('pending');
    expect(json.data.consent_a).toBe(false);
    expect(json.data.consent_b).toBe(false);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', seasonId);
    // createTradeRequest received the resolved sides + denormalized lines.
    expect(createTradeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        season_id: seasonId,
        initiated_by: adminId,
        player_a_id: playerAId,
        from_tracker_a_id: trackerAId,
        line_a: 'Charmander',
        player_b_id: playerBId,
        from_tracker_b_id: trackerBId,
        line_b: 'Bulbasaur',
      })
    );
    // Crucially: the swap engine was NOT invoked at create time.
  });

  it('returns 403 when the caller is not a resource admin', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new MockAuthError('Forbidden', 403));

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Forbidden');
    expect(createTradeRequest).not.toHaveBeenCalled();
  });

  // The participation line is the active format pack's (`participationLineBase`); it is redraft-locked.
  it.skipIf(!participationLineBase())('rejects the participation line at create time', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    const cosmogTracker = {
      ...trackerA,
      id: trackerAId,
      base_pokemon: participationLineBase(),
    } as never;
    const cosmogEntry = {
      ...entryA,
      base_pokemon: participationLineBase(),
      special_rules: null,
    } as never;
    vi.mocked(getSeasonTrackers).mockResolvedValue([cosmogTracker, trackerB] as never);
    vi.mocked(getListEntries).mockResolvedValue([cosmogEntry, entryB] as never);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('cannot be traded');
    expect(createTradeRequest).not.toHaveBeenCalled();
  });

  it('surfaces a one-pending-per-tracker violation as 409', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    const uniqueErr = Object.assign(new Error('duplicate'), { code: '23505' });
    vi.mocked(createTradeRequest).mockRejectedValue(uniqueErr);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already has a pending trade');
  });

  it('returns 403 when the redraft phase is closed', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getFormatRules).mockResolvedValue({ ...rulesOpen, redraft_phase_open: false } as never);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('Redraft phase is not open');
    expect(json.code).toBe('redraft_phase_not_open');
  });

  it('answers an invalid body with validation_failed and keeps the English text', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerAId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Validation failed: A trade requires two different players');
    expect(json.code).toBe('validation_failed');
    expect(json.params).toEqual({ issues: 'A trade requires two different players' });
  });

  it('requires both source trackers (trade_source_trackers_required)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: null,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Both source trackers are required to initiate a trade');
    expect(json.code).toBe('trade_source_trackers_required');
  });

  it('needs a bound point-buy list (point_buy_list_unbound)', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ ...(epbSeason as object), point_buy_list_id: null } as never);

    const req = makeRequest({
      player_a_id: playerAId,
      from_tracker_a_id: trackerAId,
      player_b_id: playerBId,
      from_tracker_b_id: trackerBId,
    });
    const res = await createTradeRequestRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('No point-buy list is bound to this season');
    expect(json.code).toBe('point_buy_list_unbound');
  });
});

// ── Consent endpoint ──────────────────────────────────────────────────

describe('POST /api/seasons/[id]/redraft/trade-request/[rid]/consent', () => {
  it('stays pending when only player A consents', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    // Initial load: nothing consented yet.
    vi.mocked(getTradeRequest)
      .mockResolvedValueOnce(makeRequestRow({ consent_a: false, consent_b: false }))
      // After setConsent reload: only A consented.
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }));
    vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true }) as never);

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('pending');
    expect(json.data.consent_a).toBe(true);
    expect(json.data.consent_b).toBe(false);
    expect(setConsent).toHaveBeenCalledWith(requestId, 'a');
    // Not both consented -> no execution.
    expect(executeTradeRequest).not.toHaveBeenCalled();
    // Nothing public changed, so no read-cache entry is expired.
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('executes atomically when B consents after A (fresh re-validation + single RPC)', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerB);
    // Initial load: A already consented.
    vi.mocked(getTradeRequest)
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }))
      // After setConsent reload: both consented.
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: true }))
      // Final reload after RPC success: executed.
      .mockResolvedValueOnce(
        makeRequestRow({ status: 'executed', executed_tracker_ids: ['new-ta', 'new-tb'] }) as never
      );
    vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true, consent_b: true }) as never);

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('executed');

    // Fresh remaining points were computed for BOTH players (not cached).
    expect(computeRemainingPoints).toHaveBeenCalledWith(seasonId, playerAId, 100, 3);
    expect(computeRemainingPoints).toHaveBeenCalledWith(seasonId, playerBId, 100, 3);
    // Both sides were prepared with transfer_type 'trade' + cross partner id.
    expect(prepareRedraftSwap).toHaveBeenCalledTimes(2);
    expect(prepareRedraftSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        season_id: seasonId,
        player_id: playerAId,
        from_tracker_id: trackerAId,
        to_line: entryB,
        transfer_type: 'trade',
        trade_partner_id: playerBId,
      })
    );
    expect(prepareRedraftSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        season_id: seasonId,
        player_id: playerBId,
        from_tracker_id: trackerBId,
        to_line: entryA,
        transfer_type: 'trade',
        trade_partner_id: playerAId,
      })
    );
    // The SINGLE atomic RPC ran with both payloads — no TS claim/revert/store.
    expect(executeTradeRequest).toHaveBeenCalledTimes(1);
    expect(executeTradeRequest).toHaveBeenCalledWith(
      requestId,
      expect.objectContaining({ length: 2 })
    );
    const swapsArg = vi.mocked(executeTradeRequest).mock.calls[0][1];
    expect(swapsArg).toHaveLength(2);
    // The old swap RPC + claim/revert/store are no longer used by this route.
    // D37: the executed trade changes both rosters; the league shows it on the next view.
    expect(revalidateTag).toHaveBeenCalledWith(`season:${seasonId}`, { expire: 0 });
  });

  it('returns 403 when a non-participant tries to consent', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId: 'random' }));
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('not a participant');
    expect(json.code).toBe('trade_not_participant');
    expect(setConsent).not.toHaveBeenCalled();
  });

  it('returns a format_mismatch error (400) for a non-EPB season before consenting', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getSeasonById).mockResolvedValue(nonEpbSeason);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('format_mismatch');
    expect(setConsent).not.toHaveBeenCalled();
    expect(executeTradeRequest).not.toHaveBeenCalled();
  });

  it('returns 409 and leaves the request pending when prepareRedraftSwap fails at execute time', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerB);
    vi.mocked(getTradeRequest)
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }))
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: true }));
    vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true, consent_b: true }) as never);
    // Fresh re-validation fails: not enough points.
    vi.mocked(prepareRedraftSwap).mockResolvedValueOnce({ error: 'Not enough points for upgrade' } as never);

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('Not enough points');
    expect(json.code).toBe('trade_side_a_invalid');
    expect(json.params).toEqual({ reason: 'Not enough points for upgrade' });
    // The RPC was NOT called (prepare failed before it), and consent was
    // recorded but the request stays pending and retryable — no TS revert.
    expect(executeTradeRequest).not.toHaveBeenCalled();
  });

  it('returns 409 with the RPC message when the RPC aborts and the request is still pending', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerB);
    vi.mocked(getTradeRequest)
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }))
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: true }))
      // Reload after RPC failure: still pending (transaction rolled back).
      .mockResolvedValueOnce(makeRequestRow({ status: 'pending', consent_a: true, consent_b: true }) as never);
    vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true, consent_b: true }) as never);
    vi.mocked(executeTradeRequest).mockRejectedValue(
      new TradeRequestExecutionError('phase_closed', 'P0001')
    );

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('phase_closed');
    expect(json.code).toBe('redraft_phase_not_open');
    // The RPC was attempted once; the old swap RPC was never used.
    expect(executeTradeRequest).toHaveBeenCalledTimes(1);
  });

  it('returns an idempotent executed response when the RPC rejects but another caller finalized it', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerB);
    vi.mocked(getTradeRequest)
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }))
      .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: true }))
      // Reload after RPC failure: another caller won the race and executed it.
      .mockResolvedValueOnce(
        makeRequestRow({ status: 'executed', executed_tracker_ids: ['new-ta', 'new-tb'] }) as never
      );
    vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true, consent_b: true }) as never);
    // Our RPC call lost the race (request_not_executable — already executed).
    vi.mocked(executeTradeRequest).mockRejectedValue(
      new TradeRequestExecutionError('request_not_executable', 'P0001')
    );

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    // Idempotent: the race winner's result is returned, not a 409.
    expect(res.status).toBe(200);
    expect(json.data.status).toBe('executed');
    expect(json.data.executed_tracker_ids).toEqual(['new-ta', 'new-tb']);
  });

  it('returns idempotent success when the trade is already executed', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getTradeRequest).mockResolvedValue(
      makeRequestRow({ status: 'executed' }) as never
    );

    const req = makeRequest();
    const res = await consentRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('executed');
    expect(setConsent).not.toHaveBeenCalled();
    expect(executeTradeRequest).not.toHaveBeenCalled();
  });
});

// ── Consent endpoint: error codes (errors/draft-legacy) ───────────────

/** Player B consents last, so the route runs the fresh re-validation and the RPC. */
function consentAsLastSide(rpcReload?: unknown) {
  vi.mocked(requirePlayer).mockResolvedValue(playerB);
  const mock = vi
    .mocked(getTradeRequest)
    .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: false }))
    .mockResolvedValueOnce(makeRequestRow({ consent_a: true, consent_b: true }));
  if (rpcReload) mock.mockResolvedValueOnce(rpcReload as never);
  vi.mocked(setConsent).mockResolvedValue(makeRequestRow({ consent_a: true, consent_b: true }) as never);
}

async function consent() {
  const res = await consentRoute(makeRequest(), { params: makeParams({ id: seasonId, rid: requestId }) });
  return { res, json: await res.json() };
}

describe('consent route error codes', () => {
  it('trade_request_not_found when the request does not exist', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getTradeRequest).mockResolvedValue(null as never);

    const { res, json } = await consent();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Trade request not found');
    expect(json.code).toBe('trade_request_not_found');
  });

  it('trade_request_wrong_season when the request belongs to another season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow({ season_id: 'other-season' }));

    const { res, json } = await consent();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Trade request does not belong to this season');
    expect(json.code).toBe('trade_request_wrong_season');
  });

  it('trade_side_b_invalid carries the failing reason as a param when the engine gave no refusal', async () => {
    consentAsLastSide();
    vi.mocked(prepareRedraftSwap)
      .mockResolvedValueOnce(makePreparedSwap() as never)
      .mockResolvedValueOnce({ error: 'You do not own this line' } as never);

    const { res, json } = await consent();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Player B side failed: You do not own this line');
    expect(json.code).toBe('trade_side_b_invalid');
    expect(json.params).toEqual({ reason: 'You do not own this line' });
  });

  it('forwards the engine refusal code and params of a failing side', async () => {
    consentAsLastSide();
    vi.mocked(prepareRedraftSwap)
      .mockResolvedValueOnce({
        error: 'Not enough points for upgrade. Need 5, have 2',
        refusal: { code: 'redraft_insufficient_points', params: { cost: 5, remaining: 2 } },
      })
      .mockResolvedValueOnce(makePreparedSwap() as never);

    const { res, json } = await consent();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Not enough points for upgrade. Need 5, have 2');
    expect(json.code).toBe('redraft_insufficient_points');
    expect(json.params).toEqual({ cost: 5, remaining: 2 });
    expect(executeTradeRequest).not.toHaveBeenCalled();
  });

  it('forwards a parameterless refusal code for side B', async () => {
    consentAsLastSide();
    vi.mocked(prepareRedraftSwap)
      .mockResolvedValueOnce(makePreparedSwap() as never)
      .mockResolvedValueOnce({ error: 'You do not own this line', refusal: { code: 'redraft_line_not_owned' } });

    const { res, json } = await consent();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Player B side failed: You do not own this line');
    expect(json.code).toBe('redraft_line_not_owned');
    expect(json.params).toBeUndefined();
  });

  it.each([
    ['request_not_executable', 'trade_request_not_executable', undefined],
    ['multiple_draft_pools', 'trade_multiple_draft_pools', undefined],
    ['insufficient_points', 'trade_insufficient_points', undefined],
    ['Trade request not found', 'trade_request_not_found', undefined],
    [
      `Source tracker ${trackerAId} not found for this player in this season`,
      'trade_source_tracker_unavailable',
      undefined,
    ],
    ['Line Bulbasaur is already owned by another player', 'trade_line_already_owned', { pokemon: 'Bulbasaur' }],
    ['something new', 'trade_execution_rejected', { reason: 'something new' }],
  ])('maps the RPC reason %j to %s and keeps the RPC text', async (reason, code, params) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    consentAsLastSide(makeRequestRow({ status: 'pending', consent_a: true, consent_b: true }));
    vi.mocked(executeTradeRequest).mockRejectedValue(new TradeRequestExecutionError(reason, 'P0001'));

    const { res, json } = await consent();

    expect(res.status).toBe(409);
    expect(json.error).toBe(reason);
    expect(json.code).toBe(code);
    expect(json.params).toEqual(params);
  });
});

// ── Cancel endpoint ───────────────────────────────────────────────────

describe('POST /api/seasons/[id]/redraft/trade-request/[rid]/cancel', () => {
  it('allows a resource admin to cancel a pending trade', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());
    vi.mocked(cancelTradeRequest).mockResolvedValue(
      makeRequestRow({ status: 'cancelled', cancelled_by: adminId }) as never
    );

    const req = makeRequest();
    const res = await cancelRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('cancelled');
    expect(cancelTradeRequest).toHaveBeenCalledWith(requestId, adminId);
  });

  it('allows either participant to cancel their pending trade', async () => {
    // requireResourceAdmin fails with 403 -> falls back to requirePlayer.
    vi.mocked(requireResourceAdmin).mockRejectedValue(new MockAuthError('Forbidden', 403));
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());
    vi.mocked(cancelTradeRequest).mockResolvedValue(
      makeRequestRow({ status: 'cancelled', cancelled_by: playerAId }) as never
    );

    const req = makeRequest();
    const res = await cancelRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.status).toBe('cancelled');
    expect(cancelTradeRequest).toHaveBeenCalledWith(requestId, playerAId);
  });

  it('returns 403 when a non-participant non-admin tries to cancel', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new MockAuthError('Forbidden', 403));
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId: 'random' }));
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());

    const req = makeRequest();
    const res = await cancelRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('not a participant');
    expect(json.code).toBe('trade_not_participant');
    expect(cancelTradeRequest).not.toHaveBeenCalled();
  });

  it('returns 409 when cancelling an already-executed trade', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow({ status: 'executed' }) as never);

    const req = makeRequest();
    const res = await cancelRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already executed');
    expect(json.code).toBe('trade_already_executed');
    expect(cancelTradeRequest).not.toHaveBeenCalled();
  });

  it('returns a format_mismatch error (400) for a non-EPB season before cancelling', async () => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue(nonEpbSeason);
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());

    const req = makeRequest();
    const res = await cancelRoute(req, { params: makeParams({ id: seasonId, rid: requestId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('format_mismatch');
    expect(cancelTradeRequest).not.toHaveBeenCalled();
  });
});

describe('cancel route error codes', () => {
  async function cancel() {
    const res = await cancelRoute(makeRequest(), { params: makeParams({ id: seasonId, rid: requestId }) });
    return { res, json: await res.json() };
  }

  beforeEach(() => {
    vi.mocked(requireResourceAdmin).mockResolvedValue(adminPlayer);
  });

  it('trade_request_not_found when the request does not exist', async () => {
    vi.mocked(getTradeRequest).mockResolvedValue(null as never);

    const { res, json } = await cancel();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Trade request not found');
    expect(json.code).toBe('trade_request_not_found');
  });

  it('trade_request_wrong_season when the request belongs to another season', async () => {
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow({ season_id: 'other-season' }));

    const { res, json } = await cancel();

    expect(res.status).toBe(400);
    expect(json.code).toBe('trade_request_wrong_season');
  });

  it('trade_already_cancelled for a cancelled request', async () => {
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow({ status: 'cancelled' }));

    const { res, json } = await cancel();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Trade is already cancelled');
    expect(json.code).toBe('trade_already_cancelled');
  });

  it('trade_no_longer_pending when a concurrent caller wins the race', async () => {
    vi.mocked(getTradeRequest).mockResolvedValue(makeRequestRow());
    vi.mocked(cancelTradeRequest).mockResolvedValue(null as never);

    const { res, json } = await cancel();

    expect(res.status).toBe(409);
    expect(json.error).toBe('Trade is no longer pending');
    expect(json.code).toBe('trade_no_longer_pending');
  });
});

// ── List endpoint ─────────────────────────────────────────────────────

describe('GET /api/seasons/[id]/redraft/trade-requests', () => {
  it('returns the caller\'s pending requests for an EPB season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getPendingTradeRequestsForPlayer).mockResolvedValue([makeRequestRow()] as never);

    const req = makeRequest();
    const res = await listTradeRequestsRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.mine).toHaveLength(1);
    expect(getPendingTradeRequestsForPlayer).toHaveBeenCalledWith(seasonId, playerAId);
  });

  it('returns a format_mismatch error (400) for a non-EPB season', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(playerA);
    vi.mocked(getSeasonById).mockResolvedValue(nonEpbSeason);

    const req = makeRequest();
    const res = await listTradeRequestsRoute(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.code).toBe('format_mismatch');
    expect(getPendingTradeRequestsForPlayer).not.toHaveBeenCalled();
  });
});