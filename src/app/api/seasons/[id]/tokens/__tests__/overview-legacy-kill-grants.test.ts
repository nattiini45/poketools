/**
 * Review G1 #4/#5: legacy one-shot kill_token grants (`epb_token_grants`) are Comeback Tokens that were
 * already distributed. The overview counts them as spent, exactly like `v_spent` in the SQL
 * `epb_spend_comeback_tokens` (M7), so the overview balance and the RPC balance agree.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('@/lib/supabase/queries/drafts', () => ({
  getDraftPoolBySeason: vi.fn(),
  getDraftPoolsBySeason: vi.fn(),
  getPicksByPool: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/epb-token-grants', () => ({ getTokenGrants: vi.fn() }));
vi.mock('@/lib/supabase/queries/redraft', () => ({ getRedraftHistory: vi.fn(), getRedraftSlotRefunds: vi.fn() }));
vi.mock('@/lib/supabase/queries/epb-draft-token-purchases', () => ({
  getDraftTokenPurchases: vi.fn(),
  purchaseDraftTokenRpc: vi.fn(),
}));

import { buildTokenOverview, type TokenSeasonContext } from '../_lib/overview';
import { loadDraftTokenLedger, type DraftTokenLedger } from '@/lib/draft/progress-engine';
import { getDraftPoolBySeason, getDraftPoolsBySeason, getPicksByPool } from '@/lib/supabase/queries/drafts';
import { getTokenGrants, type EpbTokenGrant } from '@/lib/supabase/queries/epb-token-grants';
import { getRedraftHistory, getRedraftSlotRefunds } from '@/lib/supabase/queries/redraft';
import { getDraftTokenPurchases } from '@/lib/supabase/queries/epb-draft-token-purchases';

const SEASON = '00000000-0000-4000-8000-0000000000a1';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const P2 = '00000000-0000-4000-8000-0000000000b2';
const NOW = new Date('2026-10-11T12:00:00Z');

function grant(playerId: string, grantType: EpbTokenGrant['grant_type'], count: number): EpbTokenGrant {
  return {
    season_id: SEASON,
    player_id: playerId,
    grant_type: grantType,
    token_count: count,
    created_by: null,
    created_at: '2026-09-01T00:00:00Z',
  };
}

function ledger(killGrants: DraftTokenLedger['killGrants']): DraftTokenLedger {
  return {
    picks: [{ player_id: P1, points_spent: 90 }],
    draftGrants: [],
    killGrants,
    redrafts: [],
    draftTokenPurchases: [],
    redraftRefunds: [],
    initialPoolBudget: 100,
  };
}

function ctx(over: Partial<TokenSeasonContext> = {}): TokenSeasonContext {
  return {
    seasonId: SEASON,
    budget: 100,
    cost: 5,
    max: 1,
    comebackAdminOpened: false,
    initialPhase: 'complete',
    closesAt: null,
    redraftComplete: true,
    anyLeagueMatchConfirmed: false,
    entriesByLine: new Map(),
    ledger: ledger([]),
    earned: {
      byPlayer: { [P1]: 2 },
      history: [
        { player_id: P1, match_id: 'm1', matchday: 1, score: '0:5', tokens: 1 },
        { player_id: P1, match_id: 'm2', matchday: 2, score: '0:4', tokens: 1 },
      ],
    },
    spends: [],
    purchases: [],
    trackers: [],
    cosmoMatchdays: new Map(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildTokenOverview — legacy kill_token grants count as spent Comeback Tokens', () => {
  it('earned 2 with a legacy kill_token grant of 2 → spent 2, unspent 0', () => {
    const dto = buildTokenOverview(ctx({ ledger: ledger([{ player_id: P1, token_count: 2 }]) }), P1, NOW);
    expect(dto.comeback.earned).toBe(2);
    expect(dto.comeback.spent).toBe(2);
    expect(dto.comeback.unspent).toBe(0);
  });

  it('adds grants to ledger spends; another player’s grant does not count', () => {
    const spends = [
      {
        id: 'sp1',
        season_id: SEASON,
        player_id: P1,
        line_id: 'gible--garchomp',
        tracker_id: 't1',
        amount: 1,
        client_request_id: 'r1',
        created_by: P1,
        created_at: '2026-10-05T00:00:00Z',
      },
    ];
    const dto = buildTokenOverview(
      ctx({
        earned: { byPlayer: { [P1]: 4 }, history: [] },
        spends,
        ledger: ledger([{ player_id: P1, token_count: 2 }, { player_id: P2, token_count: 3 }]),
      }),
      P1,
      NOW,
    );
    expect(dto.comeback).toMatchObject({ earned: 4, spent: 3, unspent: 1 });
  });

  it('a hand-built ledger without killGrants keeps spent = Σ spends (earned unchanged)', () => {
    const dto = buildTokenOverview(ctx({ ledger: { ...ledger([]), killGrants: undefined } }), P1, NOW);
    expect(dto.comeback).toMatchObject({ earned: 2, spent: 0, unspent: 2 });
  });

  it('wiring: the ledger loader reads grants once and the overview sees the kill_token grant', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1', season_id: SEASON, point_budget: 100 } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([{ player_id: P1, points_spent: 90 }] as never);
    vi.mocked(getDraftPoolsBySeason).mockResolvedValue([]);
    vi.mocked(getTokenGrants).mockResolvedValue([grant(P1, 'kill_token', 2), grant(P2, 'draft_token', 1)]);
    vi.mocked(getRedraftHistory).mockResolvedValue([]);
    vi.mocked(getRedraftSlotRefunds).mockResolvedValue([]);
    vi.mocked(getDraftTokenPurchases).mockResolvedValue([]);

    const loaded = await loadDraftTokenLedger(SEASON);
    expect(getTokenGrants).toHaveBeenCalledTimes(1);

    const dto = buildTokenOverview(ctx({ ledger: loaded }), P1, NOW);
    expect(dto.comeback).toMatchObject({ earned: 2, spent: 2, unspent: 0 });
    // the draft_token grant still drives the Draft Kill Token count, not the Comeback balance
    expect(buildTokenOverview(ctx({ ledger: loaded }), P2, NOW).draft_kill.owned).toBe(1);
  });
});
