/**
 * GET /api/drafts/[id]/picks — no-leak test (review G2, finding 1).
 *
 * The pick list is open to every signed-in player, so admin correction data
 * (override/void reasons, voider, actor, client_request_id) must never reach
 * it, and a voided pick must not be listed at all. The read runs the REAL
 * `getPicksByPool` over a fake Supabase client that applies the `.eq` filter
 * to in-memory `draft_picks` rows, so the route's own allowlist is what is
 * under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
}));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const filters: [string, unknown][] = [];
    const rows = (): Row[] =>
      (db.tables[table] ?? []).filter((r) => filters.every(([col, value]) => r[col] === value)).map((r) => ({ ...r }));
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters.push([col, value]);
        return chain;
      },
      order: () => chain,
      maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null }),
    };
    return chain;
  }
  return { supabase: { from: (table: string) => builder(table), rpc: vi.fn() } };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/revalidation', () => ({ expireDraftReads: vi.fn() }));
vi.mock('@/lib/draft/notify', () => ({ dispatchDraftNotifications: vi.fn() }));
vi.mock('@/lib/discord/notify', () => ({ emitDiscordEvent: vi.fn() }));
vi.mock('@/lib/social/notify', () => ({ emitSocialEvent: vi.fn() }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: vi.fn() };
});

import { GET } from '@/app/api/drafts/[id]/picks/route';
import { requirePlayer } from '@/lib/auth/helpers';

const POOL = '11111111-1111-4111-8111-111111111111';
const OTHER_POOL = '22222222-2222-4222-8222-222222222222';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const OVERRIDE_REASON = 'confirmed via Discord DM secret-override';
const VOID_REASON = 'wrong branch picked secret-void';
const CLIENT_REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const FORBIDDEN_KEYS = [
  'override_reason',
  'void_reason',
  'voided_at',
  'voided_by',
  'made_by',
  'made_by_role',
  'client_request_id',
];

const ctx = (id = POOL) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest(`http://localhost/api/drafts/${POOL}/picks`);

function pickRow(over: Row): Row {
  return {
    id: 'pick-1',
    draft_pool_id: POOL,
    player_id: A,
    pokemon_name: 'Eevee',
    pick_number: 1,
    round: 1,
    points_spent: 20,
    timestamp: '2026-10-12T10:00:00Z',
    line_id: 'eevee--sylveon',
    line_entry_id: 'entry-1',
    slot_id: 'slot-1',
    redraft_slot_id: null,
    client_request_id: null,
    made_by: null,
    made_by_role: null,
    override_reason: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    players: { name: 'Ash' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db.tables = {
    draft_picks: [
      pickRow({ id: 'pick-normal' }),
      pickRow({
        id: 'pick-voided',
        player_id: B,
        pokemon_name: 'Dratini',
        pick_number: 2,
        line_id: 'dratini--dragonite',
        players: { name: 'Misty' },
        client_request_id: CLIENT_REQUEST_ID,
        made_by: ADMIN,
        made_by_role: 'admin',
        override_reason: OVERRIDE_REASON,
        voided_at: '2026-10-12T11:00:00Z',
        voided_by: ADMIN,
        void_reason: VOID_REASON,
      }),
      pickRow({ id: 'pick-other-pool', draft_pool_id: OTHER_POOL, pick_number: 1 }),
    ],
  };
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: B, name: 'Misty', isAdmin: false, isResourceAdmin: false } as never);
});

describe('GET /api/drafts/[id]/picks — no leak of admin correction data', () => {
  it('returns only the standing pick, through the public allowlist', async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; data: Row[] };
    expect(json.success).toBe(true);
    expect(json.data).toEqual([
      {
        id: 'pick-normal',
        player_id: A,
        player_name: 'Ash',
        pokemon_name: 'Eevee',
        line_id: 'eevee--sylveon',
        pick_number: 1,
        round: 1,
        points_spent: 20,
        timestamp: '2026-10-12T10:00:00Z',
      },
    ]);
  });

  it('serializes none of the admin keys or reason strings', async () => {
    const res = await GET(req(), ctx());
    const body = await res.text();
    for (const key of FORBIDDEN_KEYS) expect(body, `leaked key ${key}`).not.toContain(`"${key}"`);
    for (const secret of [OVERRIDE_REASON, VOID_REASON, CLIENT_REQUEST_ID, ADMIN, 'pick-voided']) {
      expect(body, `leaked ${secret}`).not.toContain(secret);
    }
  });

  it('answers 404 for a malformed pool id without reading picks', async () => {
    const res = await GET(req(), ctx('not-a-uuid'));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { success: boolean; code?: string };
    expect(json).toMatchObject({ success: false, code: 'POOL_NOT_FOUND' });
  });
});
