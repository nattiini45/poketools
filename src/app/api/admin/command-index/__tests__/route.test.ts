import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { COMMAND_INDEX_LIMIT } from '@/lib/admin/command-index';

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode: number, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }
  return { requireAnyAdmin: vi.fn(), AuthError };
});

vi.mock('@/lib/auth/admin-scope', () => ({ getAdminScope: vi.fn() }));

interface Row {
  id: string;
  name: string;
  archived: boolean;
  created_at: string;
  season_id?: string | null;
  // Columns the route must never hand out.
  description?: string;
  ruleset_id?: string;
  discord_id?: string;
}

/** A fake service-role client over two tables: applies select, in, is, order and limit like PostgREST would. */
const db = { seasons: [] as Row[], tournaments: [] as Row[], failWith: null as Error | null };
const reads: Array<{ table: string; select: string; ids: string[] | null; limit: number | null }> = [];

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(table: 'seasons' | 'tournaments') {
      const query = { select: '', ids: null as string[] | null, standalone: false, order: [] as Array<[string, boolean]>, limit: null as number | null };
      const proxy: Record<string, unknown> = {
        select: (columns: string) => ((query.select = columns), proxy),
        in: (_column: string, ids: string[]) => ((query.ids = ids), proxy),
        is: () => ((query.standalone = true), proxy),
        order: (column: string, options?: { ascending?: boolean }) => (query.order.push([column, options?.ascending ?? true]), proxy),
        limit: (n: number) => ((query.limit = n), proxy),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          reads.push({ table, select: query.select, ids: query.ids, limit: query.limit });
          if (db.failWith) return Promise.resolve({ data: null, error: db.failWith }).then(resolve, reject);
          let rows = db[table].filter((row) => (query.ids === null || query.ids.includes(row.id)) && (!query.standalone || row.season_id == null));
          for (const [column, ascending] of [...query.order].reverse()) {
            rows = [...rows].sort((a, b) => {
              const x = String((a as unknown as Record<string, unknown>)[column]);
              const y = String((b as unknown as Record<string, unknown>)[column]);
              return ascending ? x.localeCompare(y) : y.localeCompare(x);
            });
          }
          if (query.limit !== null) rows = rows.slice(0, query.limit);
          const wanted = query.select.split(',').map((column) => column.trim());
          const data = rows.map((row) => Object.fromEntries(wanted.map((column) => [column, (row as unknown as Record<string, unknown>)[column]])));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return proxy;
    },
  },
}));

import { GET } from '../route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';

const PLAYER = { playerId: 'p1', isAdmin: false, isResourceAdmin: true };

const SITE = { playerId: 'p1', isSiteAdmin: true, seasonIds: null, tournamentIds: null };

function season(id: string, createdAt: string, overrides: Partial<Row> = {}): Row {
  return { id, name: `League ${id}`, archived: false, created_at: createdAt, description: 'private text', ruleset_id: 'r-1', ...overrides };
}
function tournament(id: string, createdAt: string, overrides: Partial<Row> = {}): Row {
  return { id, name: `Cup ${id}`, archived: false, created_at: createdAt, season_id: null, ruleset_id: 'r-1', ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  reads.length = 0;
  db.failWith = null;
  db.seasons = [
    season('s-old', '2026-01-01T00:00:00.000Z', { archived: true }),
    season('s-new', '2026-03-01T00:00:00.000Z'),
    season('s-other', '2026-02-01T00:00:00.000Z'),
  ];
  db.tournaments = [
    tournament('t-mid', '2026-02-15T00:00:00.000Z'),
    tournament('t-own', '2026-02-20T00:00:00.000Z'),
    // A phase of s-new: reached through its league, never listed on its own.
    tournament('t-phase', '2026-03-02T00:00:00.000Z', { season_id: 's-new' }),
  ];
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE);
});

describe('GET /api/admin/command-index', () => {
  it('gives a site admin every league and standalone tournament, newest first, archived flagged', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [
        { id: 's-new', name: 'League s-new', kind: 'league', archived: false },
        { id: 't-own', name: 'Cup t-own', kind: 'tournament', archived: false },
        { id: 't-mid', name: 'Cup t-mid', kind: 'tournament', archived: false },
        { id: 's-other', name: 'League s-other', kind: 'league', archived: false },
        { id: 's-old', name: 'League s-old', kind: 'league', archived: true },
      ],
    });
  });

  it('carries ids and names only: exactly four keys per entry, nothing else leaves the route', async () => {
    const body = await (await GET()).json();
    for (const entry of body.data) expect(Object.keys(entry).sort()).toEqual(['archived', 'id', 'kind', 'name']);
    for (const read of reads) expect(read.select).toBe('id, name, archived, created_at');
    expect(JSON.stringify(body)).not.toMatch(/private text|r-1|discord/);
    expectNoPrivatePlayerData(body);
  });

  it('guards first and reads nothing for a caller who is not an admin', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    let res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Not authenticated', code: 'unauthenticated' });

    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });

    expect(getAdminScope).not.toHaveBeenCalled();
    expect(reads).toHaveLength(0);
  });

  it('scopes a resource admin to their own league and standalone tournaments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({
      playerId: 'p1',
      isSiteAdmin: false,
      seasonIds: ['s-other'],
      // The cascade of an assigned league lists its phases too: a phase is not a competition of its own here.
      tournamentIds: ['t-own', 't-phase'],
    });
    const body = await (await GET()).json();
    expect(body.data.map((entry: { id: string }) => entry.id)).toEqual(['t-own', 's-other']);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
  });

  it('shows a tournament-only admin the tournament and no league', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ playerId: 'p1', isSiteAdmin: false, seasonIds: [], tournamentIds: ['t-mid'] });
    const body = await (await GET()).json();
    expect(body.data).toEqual([{ id: 't-mid', name: 'Cup t-mid', kind: 'tournament', archived: false }]);
    expect(reads.filter((read) => read.table === 'seasons')).toHaveLength(0);
  });

  it('answers an empty list, not an error, when every assignment was removed', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ playerId: 'p1', isSiteAdmin: false, seasonIds: [], tournamentIds: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: [] });
    expect(reads).toHaveLength(0);
  });

  it('caps the list at 500 entries, the newest ones, with each read bounded below max_rows', async () => {
    const stamp = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString();
    db.seasons = Array.from({ length: 400 }, (_, i) => season(`s${String(i).padStart(3, '0')}`, stamp(i * 2)));
    db.tournaments = Array.from({ length: 400 }, (_, i) => tournament(`t${String(i).padStart(3, '0')}`, stamp(i * 2 + 1)));
    const body = await (await GET()).json();
    expect(body.data).toHaveLength(COMMAND_INDEX_LIMIT);
    // Interleaved timestamps: the 500 newest are the last 250 of each kind.
    expect(body.data[0].id).toBe('t399');
    expect(body.data.at(-1).id).toBe('s150');
    expect(body.data.filter((entry: { kind: string }) => entry.kind === 'league')).toHaveLength(250);
    for (const read of reads) expect(read.limit).toBe(COMMAND_INDEX_LIMIT);
  });

  it('answers 500 with the fallback message and no database detail when a read fails', async () => {
    db.failWith = new Error('relation "seasons" is on fire');
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: 'Failed to load the command index' });
    expect(JSON.stringify(body)).not.toContain('on fire');
  });
});
