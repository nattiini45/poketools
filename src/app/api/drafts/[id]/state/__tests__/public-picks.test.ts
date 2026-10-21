/**
 * Legacy branch of GET /api/drafts/[id]/state: the pick list every viewer
 * receives goes through the public allowlist (`toPublicPick`) with voided
 * picks dropped, so admin correction data never leaks. The engine is real;
 * only the reads are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DraftPickWithPlayer } from '@/types/draft';

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(async () => ({ playerId: 'viewer', isAdmin: false, isResourceAdmin: false })),
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn(), getPicksByPool: vi.fn() }));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonParticipants: vi.fn(async () => [
    { id: 'p1', name: 'Ash' },
    { id: 'p2', name: 'Brock' },
  ]),
  getSeasonById: vi.fn(async () => ({ id: 'season-1', format_type: 'draft' })),
}));
vi.mock('@/lib/supabase/queries/format-rules', () => ({ getFormatRules: vi.fn(async () => null) }));
vi.mock('@/lib/supabase/queries/evolutions', () => ({
  getSeasonTrackers: vi.fn(),
  getAllTiers: vi.fn(),
  getPlayerWildcards: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/draft/progress-engine', () => ({
  loadDraftTokenLedger: vi.fn(),
  computeRemainingPointsFromLedger: vi.fn(),
  hasAllocatedDraftTokensFromLedger: vi.fn(),
}));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));

import { GET } from '@/app/api/drafts/[id]/state/route';
import { getDraftPoolById, getPicksByPool } from '@/lib/supabase/queries/drafts';
import { toPublicPick, toPublicPicks } from '@/lib/draft/public-pick';

const POOL_ID = '11111111-1111-4111-8111-111111111111';
const SECRETS = ['SECRET-override', 'SECRET-void', 'SECRET-made-by', 'SECRET-request', 'SECRET-voider', 'SECRET-slot'];

function pick(n: number, playerId: string, extra: Partial<DraftPickWithPlayer> = {}): DraftPickWithPlayer {
  return {
    id: `pick-${n}`,
    draft_pool_id: POOL_ID,
    player_id: playerId,
    player_name: playerId === 'p1' ? 'Ash' : 'Brock',
    pokemon_name: `Mon${n}`,
    pick_number: n,
    round: 1,
    points_spent: 10,
    timestamp: '2026-10-01T00:00:00.000Z',
    line_id: `line-${n}`,
    line_entry_id: null,
    slot_id: 'SECRET-slot',
    redraft_slot_id: null,
    client_request_id: 'SECRET-request',
    made_by: 'SECRET-made-by',
    made_by_role: 'admin',
    override_reason: 'SECRET-override',
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...extra,
  };
}

const PUBLIC_KEYS = ['id', 'player_id', 'player_name', 'pokemon_name', 'line_id', 'pick_number', 'round', 'points_spent', 'timestamp'];

describe('GET /api/drafts/[id]/state — legacy picks are public', () => {
  beforeEach(() => {
    vi.mocked(getDraftPoolById).mockResolvedValue({
      id: POOL_ID,
      season_id: 'season-1',
      draft_type: 'snake',
      point_budget: 100,
      status: 'in_progress',
      engine: 'legacy',
    } as never);
    vi.mocked(getPicksByPool).mockResolvedValue([
      pick(1, 'p1'),
      pick(2, 'p2', { voided_at: '2026-10-02T00:00:00.000Z', voided_by: 'SECRET-voider', void_reason: 'SECRET-void' }),
    ]);
  });

  it('sends only allowlisted pick fields and drops voided picks', async () => {
    const res = await GET(new NextRequest(`http://localhost/api/drafts/${POOL_ID}/state`), {
      params: Promise.resolve({ id: POOL_ID }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
    const body = JSON.parse(text) as { data: { picks: Record<string, unknown>[]; rosters: Record<string, string[]> } };
    expect(body.data.picks.map((p) => p.id)).toEqual(['pick-1']);
    expect(Object.keys(body.data.picks[0]).sort()).toEqual([...PUBLIC_KEYS].sort());
    // The overlay (DraftViewer fromLegacy) and the legacy board still find what they read.
    expect(body.data.picks[0]).toMatchObject({ player_id: 'p1', player_name: 'Ash', pokemon_name: 'Mon1', pick_number: 1, round: 1, points_spent: 10, line_id: 'line-1' });
    expect(body.data.rosters).toHaveProperty('p1');
  });
});

describe('toPublicPick / toPublicPicks', () => {
  it('maps to exactly the public keys and filters voided picks', () => {
    expect(Object.keys(toPublicPick(pick(1, 'p1'))).sort()).toEqual([...PUBLIC_KEYS].sort());
    const out = toPublicPicks([pick(1, 'p1'), pick(2, 'p2', { voided_at: '2026-10-02T00:00:00.000Z' })]);
    expect(out.map((p) => p.id)).toEqual(['pick-1']);
  });
});
