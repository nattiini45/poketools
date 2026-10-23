/**
 * GET/PUT /api/drafts/[id]/favorites.
 * The real query module runs against a small in-memory fake of the client.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  rows: [] as { player_id: string; line_id: string; created_at: string }[],
  calls: [] as string[],
}));

vi.mock('@/lib/supabase/client', () => {
  function builder() {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'delete' | 'upsert' = 'select';
    let upsertRow: { player_id: string; line_id: string } | null = null;
    const run = () => {
      if (op === 'upsert' && upsertRow) {
        const row = upsertRow;
        if (!db.rows.some((r) => r.player_id === row.player_id && r.line_id === row.line_id)) {
          db.rows.push({ ...row, created_at: new Date(Date.now() + db.rows.length).toISOString() });
        }
        return { data: null, error: null };
      }
      const match = (r: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => r[k] === v);
      if (op === 'delete') {
        db.rows = db.rows.filter((r) => !match(r));
        return { data: null, error: null };
      }
      return { data: db.rows.filter(match).map((r) => ({ line_id: r.line_id })), error: null };
    };
    const chain = {
      select: () => chain,
      order: () => chain,
      limit: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      delete: () => {
        op = 'delete';
        return chain;
      },
      upsert: (row: { player_id: string; line_id: string }) => {
        op = 'upsert';
        upsertRow = row;
        return chain;
      },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => {
        db.calls.push(table);
        return builder();
      },
    },
  };
});

vi.mock('@/lib/auth/helpers', () => ({
  requirePlayer: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import { GET, PUT } from '@/app/api/drafts/[id]/favorites/route';
import { requirePlayer, AuthError } from '@/lib/auth/helpers';
import { MAX_FAVORITE_LINES } from '@/lib/supabase/queries/drafts-favorites';

const POOL = '11111111-1111-4111-8111-111111111111';
const params = { params: Promise.resolve({ id: POOL }) };
const url = `http://localhost/api/drafts/${POOL}/favorites`;
const put = (body: unknown) => PUT(new Request(url, { method: 'PUT', body: JSON.stringify(body) }), params);
const get = () => GET(new Request(url), params);

beforeEach(() => {
  db.rows = [
    { player_id: 'p1', line_id: 'eevee--sylveon', created_at: '2026-10-01T00:00:00Z' },
    { player_id: 'p2', line_id: 'gible--garchomp', created_at: '2026-10-01T00:00:00Z' },
  ];
  db.calls = [];
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'p1', isAdmin: false, isResourceAdmin: false } as never);
});

describe('GET /api/drafts/[id]/favorites', () => {
  it('returns only the viewer\'s favourites in one read', async () => {
    const res = await get();
    expect(await res.json()).toEqual({ success: true, data: { line_ids: ['eevee--sylveon'] } });
    expect(db.calls).toEqual(['draft_line_favorites']);
  });

  it('requires a signed-in player', async () => {
    vi.mocked(requirePlayer).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Not authenticated', 401),
    );
    expect((await get()).status).toBe(401);
  });
});

describe('PUT /api/drafts/[id]/favorites', () => {
  it('adds a favourite for the viewer and answers the new list', async () => {
    const res = await put({ line_id: 'dratini--dragonite', favorite: true });
    expect(await res.json()).toEqual({ success: true, data: { line_ids: ['eevee--sylveon', 'dratini--dragonite'] } });
    expect(db.rows.filter((r) => r.player_id === 'p1').map((r) => r.line_id)).toContain('dratini--dragonite');
    expect(db.calls).toHaveLength(2);
  });

  it('removes a favourite; removing an absent one writes nothing', async () => {
    expect((await (await put({ line_id: 'eevee--sylveon', favorite: false })).json()).data.line_ids).toEqual([]);
    db.calls = [];
    expect((await (await put({ line_id: 'eevee--sylveon', favorite: false })).json()).data.line_ids).toEqual([]);
    expect(db.calls).toEqual(['draft_line_favorites']);
    // Another player's favourites are untouched.
    expect(db.rows).toEqual([{ player_id: 'p2', line_id: 'gible--garchomp', created_at: '2026-10-01T00:00:00Z' }]);
  });

  it('refuses more than the limit with FAVORITES_LIMIT {max}', async () => {
    db.rows = Array.from({ length: MAX_FAVORITE_LINES }, (_, i) => ({
      player_id: 'p1', line_id: `line${i}--final${i}`, created_at: '2026-10-01T00:00:00Z',
    }));
    const res = await put({ line_id: 'dratini--dragonite', favorite: true });
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json).toMatchObject({ code: 'FAVORITES_LIMIT', params: { max: 200 } });
  });

  it('rejects a malformed line id or extra keys with 400 validation_failed', async () => {
    for (const body of [
      { line_id: 'Not A Line', favorite: true },
      { line_id: 'eevee--sylveon', favorite: true, player_id: 'p2' },
    ]) {
      const res = await put(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('validation_failed');
    }
    expect(db.calls).toEqual([]);
  });
});
