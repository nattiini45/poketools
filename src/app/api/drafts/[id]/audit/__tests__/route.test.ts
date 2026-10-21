/**
 * GET /api/drafts/[id]/audit (draft-backend §8.1 #15, §10.4; B-ADM) with the
 * real `listDraftAudit` over a fake Supabase client (no DB).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoPrivatePlayerData, fullPlayerRow } from '@/lib/players/__tests__/private-player-fields';

interface Call {
  table: string;
  ops: [string, unknown[]][];
}

const db = vi.hoisted(() => ({
  calls: [] as { table: string; ops: [string, unknown[]][] }[],
  results: {} as Record<string, unknown[]>,
}));

vi.mock('@/lib/supabase/client', () => {
  function builder(table: string) {
    const call: Call = { table, ops: [] };
    db.calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'lt', 'order', 'limit']) {
      chain[op] = (...args: unknown[]) => {
        call.ops.push([op, args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      resolve({ data: db.results[table] ?? [], error: null });
    return chain;
  }
  return { supabase: { from: (table: string) => builder(table) } };
});

vi.mock('@/lib/auth/helpers', () => ({
  requireDraftAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('@/lib/supabase/queries/drafts', () => ({ getDraftPoolById: vi.fn() }));

import { GET } from '@/app/api/drafts/[id]/audit/route';
import { requireDraftAdmin, AuthError } from '@/lib/auth/helpers';
import { getDraftPoolById } from '@/lib/supabase/queries/drafts';

const POOL = '11111111-1111-4111-8111-111111111111';
const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const P1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const get = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/drafts/${POOL}/audit${qs}`), { params: Promise.resolve({ id: POOL }) });

const logRow = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  occurred_at: `2026-10-11T12:00:0${id % 10}Z`,
  actor_id: ADMIN,
  actor_role: 'admin',
  action: 'pick_voided',
  player_id: P1,
  slot_id: null,
  pick_id: 'pick-1',
  line_id: 'ralts--gallade',
  before: { line_id: 'ralts--gallade', pick_number: 4 },
  after: { requeue: true, restored_slot_id: 'slot-9' },
  reason: 'Wrong line clicked',
  is_public: true,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  db.calls = [];
  db.results = {};
  vi.mocked(requireDraftAdmin).mockResolvedValue({ playerId: ADMIN, isAdmin: true } as never);
  vi.mocked(getDraftPoolById).mockResolvedValue({ id: POOL, season_id: 'season-1', engine: 'queue' } as never);
});

describe('GET /api/drafts/[id]/audit', () => {
  it('returns entries with actor, previous/new state and names, without private player data', async () => {
    db.results.draft_action_log = [
      logRow(7),
      logRow(6, { actor_id: null, actor_role: 'system', action: 'timeout', pick_id: null, before: null, after: null, reason: null }),
      logRow(5, { action: 'seats_changed', pick_id: null, player_id: null, before: [{ player_id: P1, seat: 1 }] }),
    ];
    db.results.players = [
      { ...fullPlayerRow({ id: ADMIN, name: 'Admin Ada' }) },
      { ...fullPlayerRow({ id: P1, name: 'Mara Feldkamp' }) },
    ];
    db.results.draft_picks = [{ id: 'pick-1', pick_number: 4, redraft_slot_id: 'rs-1' }];
    db.results.redraft_slots = [{ id: 'rs-1', label: 'B' }];

    const res = await get();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.next_cursor).toBeNull();
    expect(json.data.entries[0]).toEqual({
      id: '7',
      occurred_at: '2026-10-11T12:00:07Z',
      actor: { player_id: ADMIN, name: 'Admin Ada', role: 'admin' },
      action: 'pick_voided',
      player_name: 'Mara Feldkamp',
      line_id: 'ralts--gallade',
      slot_label: 'B',
      pick_number: 4,
      before: { line_id: 'ralts--gallade', pick_number: 4 },
      after: { requeue: true, restored_slot_id: 'slot-9' },
      note: 'Wrong line clicked',
      is_public: true,
    });
    expect(json.data.entries[1].actor).toEqual({ player_id: null, name: 'System', role: 'system' });
    expect(json.data.entries[2].before).toEqual({ value: [{ player_id: P1, seat: 1 }] });
    expectNoPrivatePlayerData(json);

    // Player names: only id + name are selected.
    const playersCall = db.calls.find((c) => c.table === 'players');
    expect(playersCall?.ops[0]).toEqual(['select', ['id, name']]);
  });

  it('filters by action (repeatable), player and cursor, newest first, and pages with limit + 1', async () => {
    db.results.draft_action_log = [logRow(9), logRow(8), logRow(7)];

    const res = await get(`?action=pick_voided&action=paused&player=${P1}&cursor=10&limit=2`);
    const json = await res.json();

    const log = db.calls.find((c) => c.table === 'draft_action_log');
    expect(log?.ops).toEqual([
      ['select', [expect.stringContaining('before, after, reason, is_public')]],
      ['eq', ['draft_pool_id', POOL]],
      ['in', ['action', ['pick_voided', 'paused']]],
      ['eq', ['player_id', P1]],
      ['lt', ['id', '10']],
      ['order', ['id', { ascending: false }]],
      ['limit', [3]],
    ]);
    expect(json.data.entries.map((e: { id: string }) => e.id)).toEqual(['9', '8']);
    expect(json.data.next_cursor).toBe('8');
  });

  it('rejects an unknown action and a limit over 200', async () => {
    expect((await get('?action=pick_deleted')).status).toBe(400);
    expect((await get('?limit=201')).status).toBe(400);
  });

  it('is admin-only (a non-admin gets 403 and no rows are read)', async () => {
    vi.mocked(requireDraftAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required for this draft', 403),
    );
    expect((await get()).status).toBe(403);
    expect(db.calls).toHaveLength(0);
  });

  it('returns an empty page without extra reads', async () => {
    const json = await (await get()).json();
    expect(json.data).toEqual({ entries: [], next_cursor: null });
    expect(db.calls.map((c) => c.table)).toEqual(['draft_action_log']);
  });
});
