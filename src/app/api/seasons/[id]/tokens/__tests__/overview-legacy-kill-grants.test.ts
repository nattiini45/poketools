/**
 * No carried-over comeback stock (no transition rule): there is no legacy Comeback stock.
 * One-shot kill_token grants (`epb_token_grants`) are neither read into the ledger nor counted as
 * spent; spent = Σ `epb_comeback_token_spends`, exactly like `v_spent` in the SQL
 * `epb_spend_comeback_tokens` (20261018140000_epb_comeback_rules.sql), so both balances agree.
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

function ledger(): DraftTokenLedger {
  return {
    picks: [{ player_id: P1, points_spent: 90 }],
    draftGrants: [],
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
    ledger: ledger(),
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

describe('buildTokenOverview — no legacy Comeback stock', () => {
  it('spent = Σ spends of the player; other players’ spends do not count', () => {
    const spend = (playerId: string, amount: number, id: string) => ({
      id,
      season_id: SEASON,
      player_id: playerId,
      line_id: 'gible--garchomp',
      tracker_id: 't1',
      amount,
      client_request_id: `r-${id}`,
      created_by: playerId,
      created_at: '2026-10-05T00:00:00Z',
    });
    const dto = buildTokenOverview(
      ctx({ earned: { byPlayer: { [P1]: 4 }, history: [] }, spends: [spend(P1, 1, 'a'), spend(P2, 3, 'b')] }),
      P1,
      NOW,
    );
    expect(dto.comeback).toMatchObject({ earned: 4, spent: 1, unspent: 3 });
  });

  it('wiring: only draft_token grants are read, and no grant reaches the Comeback balance', async () => {
    vi.mocked(getDraftPoolBySeason).mockResolvedValue({ id: 'pool-1', season_id: SEASON, point_budget: 100 } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([{ player_id: P1, points_spent: 90 }] as never);
    vi.mocked(getDraftPoolsBySeason).mockResolvedValue([]);
    // The database refuses kill_token grant rows (CHECK epb_token_grants_no_kill_token), so draft grants are all there is.
    const grants = [grant(P1, 'draft_token', 2), grant(P2, 'draft_token', 1)];
    vi.mocked(getTokenGrants).mockImplementation(async (_season, type) => grants.filter((g) => !type || g.grant_type === type));
    vi.mocked(getRedraftHistory).mockResolvedValue([]);
    vi.mocked(getRedraftSlotRefunds).mockResolvedValue([]);
    vi.mocked(getDraftTokenPurchases).mockResolvedValue([]);

    const loaded = await loadDraftTokenLedger(SEASON);
    expect(getTokenGrants).toHaveBeenCalledTimes(1);
    expect(getTokenGrants).toHaveBeenCalledWith(SEASON, 'draft_token');

    const dto = buildTokenOverview(ctx({ ledger: loaded }), P1, NOW);
    expect(dto.comeback).toMatchObject({ earned: 2, spent: 0, unspent: 2 });
    // the draft_token grant still drives the Draft Kill Token count
    expect(buildTokenOverview(ctx({ ledger: loaded }), P2, NOW).draft_kill.owned).toBe(1);
  });
});
