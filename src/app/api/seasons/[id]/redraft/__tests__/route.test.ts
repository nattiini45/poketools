import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makePlayer, MockAuthError } from '@/lib/__tests__/helpers/auth-mock';
import { makeRequest, makeParams } from '@/lib/__tests__/helpers/api-request';

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

vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getRedraftEligibleLines: vi.fn(),
}));

vi.mock('@/lib/draft/redraft-engine', () => ({
  getRedraftEligibleLines: vi.fn(),
  prepareRedraftSwap: vi.fn(),
}));

vi.mock('@/lib/draft/progress-engine', () => ({
  computeRemainingPoints: vi.fn(),
}));

vi.mock('@/lib/revalidation', () => ({
  expireDraftReads: vi.fn(),
}));

vi.mock('@/lib/draft/trade-consent', () => ({
  createPendingTradeRequest: vi.fn(),
  TradeConsentError: class TradeConsentError extends Error {
    statusCode: number;
    constructor(message: string, status = 400) {
      super(message);
      this.name = 'TradeConsentError';
      this.statusCode = status;
    }
  },
}));

import { GET, POST } from '../route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { getFormatRules } from '@/lib/supabase/queries/format-rules';
import { getListEntries } from '@/lib/supabase/queries/point-buy-lists';
import { getSeasonTrackers } from '@/lib/supabase/queries/evolutions';
import { getRedraftEligibleLines, prepareRedraftSwap } from '@/lib/draft/redraft-engine';
import { computeRemainingPoints } from '@/lib/draft/progress-engine';
import { createPendingTradeRequest } from '@/lib/draft/trade-consent';
import { expireDraftReads } from '@/lib/revalidation';

// ── Fixtures ──────────────────────────────────────────────────────────

const seasonId = '00000000-0000-4000-8000-000000000001';
const listVersionId = '00000000-0000-4000-8000-000000000002';
const adminId = '00000000-0000-4000-8000-000000000003';
const playerId = '00000000-0000-4000-8000-000000000004';
const partnerId = '00000000-0000-4000-8000-000000000005';
const fromTrackerId = '00000000-0000-4000-8000-000000000006';
const partnerTrackerId = '00000000-0000-4000-8000-000000000007';
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

const partnerTracker = {
  id: partnerTrackerId,
  season_id: seasonId,
  player_id: partnerId,
  base_pokemon: 'Bulbasaur',
  current_form: 'Bulbasaur',
  current_stage: 1,
  total_kos: 0,
  real_kills: 0,
  evolution_points_awarded: 0,
  locked_stage3_pokemon: null,
  line_id: 'bulbasaur--venusaur',
} as never;

const fromEntry = {
  id: 'ea',
  list_version_id: listVersionId,
  line_id: 'charmander--charizard',
  base_pokemon: 'Charmander',
  stage2_pokemon: 'Charmeleon',
  stage3_pokemon: 'Charizard',
  price: 10,
  kills_to_stage2: 5,
  additional_kills_to_stage3: 10,
  special_rules: null,
} as never;

const toEntry = {
  id: toEntryId,
  list_version_id: listVersionId,
  line_id: 'bulbasaur--venusaur',
  base_pokemon: 'Bulbasaur',
  stage2_pokemon: 'Ivysaur',
  stage3_pokemon: 'Venusaur',
  price: 10,
  kills_to_stage2: 5,
  additional_kills_to_stage3: 10,
  special_rules: null,
} as never;

function makePreparedSwap(pointsSpent = 0) {
  return {
    swap: {
      points_spent: pointsSpent,
      payload: {
        player_id: playerId,
        from_tracker_id: fromTrackerId,
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
          trade_partner_id: partnerId,
          missing_kills_transferred: 0,
          points_spent: pointsSpent,
        },
      },
    },
  };
}

const pendingTradeRequest = {
  id: '00000000-0000-4000-8000-000000000009',
  season_id: seasonId,
  initiated_by: adminId,
  player_a_id: playerId,
  from_tracker_a_id: fromTrackerId,
  line_a: 'Charmander',
  player_b_id: partnerId,
  from_tracker_b_id: partnerTrackerId,
  line_b: 'Bulbasaur',
  status: 'pending',
  consent_a: false,
  consent_b: false,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSeasonById).mockResolvedValue(epbSeason);
  vi.mocked(getFormatRules).mockResolvedValue(rulesOpen);
  vi.mocked(getListEntries).mockResolvedValue([fromEntry, toEntry] as never);
  vi.mocked(getSeasonTrackers).mockResolvedValue([fromTracker, partnerTracker] as never);
  vi.mocked(computeRemainingPoints).mockResolvedValue(100 as never);
  vi.mocked(prepareRedraftSwap).mockResolvedValue(makePreparedSwap() as never);
  vi.mocked(createPendingTradeRequest).mockResolvedValue(pendingTradeRequest);
});

describe('POST /api/seasons/[id]/redraft — trade branch (consent delegation)', () => {
  it('a non-preview trade creates a PENDING request instead of executing', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);

    const req = makeRequest({
      player_id: playerId,
      from_tracker_id: fromTrackerId,
      to_line_entry_id: toEntryId,
      transfer_type: 'trade',
      trade_partner_id: partnerId,
      // preview intentionally omitted -> non-preview
    });
    const res = await POST(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // The response is now a pending request, NOT an execution result.
    expect(json.data.pending).toBe(true);
    expect(json.data.trade_request.status).toBe('pending');
    expect(json.data.message).toContain('awaiting consent');

    // The handler keeps its draft-read expiry (draft-backend §8.1 #31).
    expect(expireDraftReads).toHaveBeenCalledWith(seasonId);

    // A pending trade request was created with the resolved sides.
    expect(createPendingTradeRequest).toHaveBeenCalledTimes(1);
    const [seasonArg, initiatedByArg, sidesArg] = vi.mocked(createPendingTradeRequest).mock.calls[0];
    expect(seasonArg).toBe(seasonId);
    expect(initiatedByArg).toBe(adminId);
    expect(sidesArg.sideA).toMatchObject({
      player_id: playerId,
      from_tracker_id: fromTrackerId,
      line: 'Charmander',
    });
    expect(sidesArg.sideB).toMatchObject({
      player_id: partnerId,
      from_tracker_id: partnerTrackerId,
      line: 'Bulbasaur',
    });
  });

  it('a preview trade still returns the spend preview and does NOT create a request', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    // Distinct prepared results so we can assert both sides were used.
    vi.mocked(prepareRedraftSwap)
      .mockResolvedValueOnce(makePreparedSwap(0) as never)
      .mockResolvedValueOnce({
        swap: {
          points_spent: 5,
          payload: {
            player_id: partnerId,
            from_tracker_id: partnerTrackerId,
            new_tracker: {
              base_pokemon: 'Charmander',
              current_form: 'Charmander',
              current_stage: 1,
              total_kos: 0,
              real_kills: 0,
              evolution_points_awarded: 0,
              locked_stage3_pokemon: 'Charizard',
            },
            history: {
              to_base_pokemon: 'Charmander',
              to_stage3_pokemon: 'Charizard',
              transfer_type: 'trade',
              trade_partner_id: playerId,
              missing_kills_transferred: 0,
              points_spent: 5,
            },
          },
        },
      } as never);

    const req = makeRequest({
      player_id: playerId,
      from_tracker_id: fromTrackerId,
      to_line_entry_id: toEntryId,
      transfer_type: 'trade',
      trade_partner_id: partnerId,
      preview: true,
    });
    const res = await POST(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Preview still returns the preview shape (no pending flag).
    expect(json.data.preview).toBeDefined();
    expect(json.data.preview.valid).toBe(true);
    expect(json.data.preview.partner_points_spent).toBe(5);
    expect(json.data.pending).toBeUndefined();

    // Preview never executes and never creates a request.
    expect(createPendingTradeRequest).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('rejects a trade from a non-admin (still admin-mediated)', async () => {
    // Caller is the owning player (passes the "own lines" check) but is NOT an
    // admin -> the trade-specific admin gate rejects the trade.
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId, isAdmin: false }));

    const req = makeRequest({
      player_id: playerId,
      from_tracker_id: fromTrackerId,
      to_line_entry_id: toEntryId,
      transfer_type: 'trade',
      trade_partner_id: partnerId,
    });
    const res = await POST(req, { params: makeParams({ id: seasonId }) });
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toContain('admin');
    expect(createPendingTradeRequest).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons/[id]/redraft — free swap retired (draft-backend §8.1 #31)', () => {
  const freeSwap = {
    player_id: playerId,
    from_tracker_id: fromTrackerId,
    to_line_entry_id: toEntryId,
    transfer_type: 'free_swap',
  };

  it.each([
    ['an execute', freeSwap],
    ['a preview', { ...freeSwap, preview: true }],
  ])('%s answers 410 REDRAFT_FREE_SWAP_RETIRED and touches nothing', async (_name, body) => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId }));
    const res = await POST(makeRequest(body), { params: makeParams({ id: seasonId }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Free swaps were replaced by the secret-drop redraft.',
      code: 'REDRAFT_FREE_SWAP_RETIRED',
    });
    expect(getSeasonById).not.toHaveBeenCalled();
    expect(prepareRedraftSwap).not.toHaveBeenCalled();
    expect(expireDraftReads).not.toHaveBeenCalled();
  });

  it('also for an admin acting for another player', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    const res = await POST(makeRequest(freeSwap), { params: makeParams({ id: seasonId }) });
    expect(res.status).toBe(410);
  });
});

describe('POST /api/seasons/[id]/redraft — error codes', () => {
  const trade = {
    player_id: playerId,
    from_tracker_id: fromTrackerId,
    to_line_entry_id: toEntryId,
    transfer_type: 'trade',
    trade_partner_id: partnerId,
  };

  it('a validation failure keeps its English text and carries validation_failed {issues}', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    const res = await POST(makeRequest({ player_id: 'x' }), { params: makeParams({ id: seasonId }) });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/^Validation failed: /);
    expect(json.code).toBe('validation_failed');
    expect(json.params.issues).toBe(json.error.replace('Validation failed: ', ''));
  });

  it('an unbound list → point_buy_list_unbound; a closed phase → redraft_phase_not_open', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    vi.mocked(getSeasonById).mockResolvedValue({ ...(epbSeason as object), point_buy_list_id: null } as never);
    const unbound = await POST(makeRequest(trade), { params: makeParams({ id: seasonId }) });
    expect(unbound.status).toBe(400);
    expect(await unbound.json()).toMatchObject({
      error: 'No point-buy list is bound to this season',
      code: 'point_buy_list_unbound',
    });

    vi.mocked(getSeasonById).mockResolvedValue(epbSeason);
    vi.mocked(getFormatRules).mockResolvedValue({ ...(rulesOpen as object), redraft_phase_open: false } as never);
    const closed = await POST(makeRequest(trade), { params: makeParams({ id: seasonId }) });
    expect(closed.status).toBe(403);
    expect(await closed.json()).toMatchObject({
      error: 'Redraft phase is not open for this season',
      code: 'redraft_phase_not_open',
    });
    expect(createPendingTradeRequest).not.toHaveBeenCalled();
  });

  async function post(body: Record<string, unknown>) {
    const res = await POST(makeRequest(body), { params: makeParams({ id: seasonId }) });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('codes the ownership, target and partner refusals with their English text kept', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId: partnerId, isAdmin: false }));
    expect(await post(trade)).toEqual({
      status: 403,
      json: { success: false, error: 'You can only redraft your own lines', code: 'redraft_lines_not_own' },
    });

    vi.mocked(requirePlayer).mockResolvedValue(makePlayer({ playerId, isAdmin: false }));
    expect(await post(trade)).toEqual({
      status: 403,
      json: {
        success: false,
        error: 'Trades are executed by an admin on behalf of both players',
        code: 'trade_admin_only',
      },
    });

    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    expect(await post({ ...trade, to_line_entry_id: fromTrackerId })).toEqual({
      status: 404,
      json: {
        success: false,
        error: 'Target line not found in the bound point-buy list',
        code: 'redraft_target_line_not_in_list',
      },
    });

    // A missing trade_partner_id is refused by the schema first (validation_failed);
    // the route's own `trade_partner_required` branch is a defensive backstop.
    const noPartner: Record<string, unknown> = { ...trade };
    delete noPartner.trade_partner_id;
    expect((await post(noPartner)).json).toMatchObject({ code: 'validation_failed' });

    vi.mocked(getSeasonTrackers).mockResolvedValue([fromTracker] as never);
    expect(await post(trade)).toEqual({
      status: 400,
      json: {
        success: false,
        error: 'Target line is not owned by the trade partner',
        code: 'trade_target_not_partner_line',
      },
    });

    vi.mocked(getSeasonTrackers).mockResolvedValue([partnerTracker] as never);
    expect(await post(trade)).toEqual({
      status: 404,
      json: { success: false, error: 'Source tracker not found for this player', code: 'trade_source_tracker_missing' },
    });

    vi.mocked(getSeasonTrackers).mockResolvedValue([fromTracker, partnerTracker] as never);
    vi.mocked(getListEntries).mockResolvedValue([toEntry] as never);
    expect(await post(trade)).toEqual({
      status: 400,
      json: {
        success: false,
        error: 'The offered line is not part of the bound point-buy list',
        code: 'trade_offered_line_not_in_list',
      },
    });
    expect(createPendingTradeRequest).not.toHaveBeenCalled();
  });

  it("forwards each side's swap refusal code and params", async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    vi.mocked(prepareRedraftSwap).mockResolvedValueOnce({
      error: 'Not enough points for upgrade. Need 5, have 2',
      refusal: { code: 'redraft_insufficient_points', params: { cost: 5, remaining: 2 } },
    });
    expect(await post(trade)).toEqual({
      status: 400,
      json: {
        success: false,
        error: 'Not enough points for upgrade. Need 5, have 2',
        code: 'redraft_insufficient_points',
        params: { cost: 5, remaining: 2 },
      },
    });

    vi.mocked(prepareRedraftSwap)
      .mockResolvedValueOnce(makePreparedSwap() as never)
      .mockResolvedValueOnce({ error: 'You do not own this line', refusal: { code: 'redraft_line_not_owned' } });
    expect(await post(trade)).toEqual({
      status: 400,
      json: {
        success: false,
        error: 'Trade partner side failed: You do not own this line',
        code: 'redraft_line_not_owned',
      },
    });
  });

  it('matches the partner line by line id: owning the other branch of the base is not enough', async () => {
    vi.mocked(requirePlayer).mockResolvedValue(adminPlayer);
    const hisuiEntry = {
      id: toEntryId,
      list_version_id: listVersionId,
      line_id: 'oshawott--samurotthisui',
      base_pokemon: 'Oshawott',
      stage2_pokemon: 'Dewott',
      stage3_pokemon: 'Samurott-Hisui',
      price: 22,
      kills_to_stage2: 5,
      additional_kills_to_stage3: 10,
      special_rules: null,
    };
    const partnerOtherBranch = {
      ...(partnerTracker as object),
      base_pokemon: 'Oshawott',
      line_id: 'oshawott--samurott',
    };
    vi.mocked(getListEntries).mockResolvedValue([fromEntry, hisuiEntry] as never);
    vi.mocked(getSeasonTrackers).mockResolvedValue([fromTracker, partnerOtherBranch] as never);

    expect(await post(trade)).toEqual({
      status: 400,
      json: {
        success: false,
        error: 'Target line is not owned by the trade partner',
        code: 'trade_target_not_partner_line',
      },
    });

    // The partner owning exactly that branch passes, and the offered line resolves by line id.
    vi.mocked(getSeasonTrackers).mockResolvedValue([
      fromTracker,
      { ...partnerOtherBranch, line_id: 'oshawott--samurotthisui' },
    ] as never);
    expect((await post(trade)).status).toBe(200);
    expect(vi.mocked(prepareRedraftSwap)).toHaveBeenCalledWith(
      expect.objectContaining({ player_id: partnerId, to_line: fromEntry }),
    );
  });

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
