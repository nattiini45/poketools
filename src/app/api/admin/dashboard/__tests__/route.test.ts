import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';

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

interface Call {
  table: string;
  select: string;
  options: { count?: string; head?: boolean } | undefined;
  filters: Array<{ column: string; values: unknown[] }>;
  limit: number | null;
}

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error?: unknown;
}

const calls: Call[] = [];
let resolve: (call: Call) => QueryResult = () => ({ data: [], count: 0, error: null });

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from(table: string) {
      const call: Call = { table, select: '', options: undefined, filters: [], limit: null };
      calls.push(call);
      const builder = {
        select(columns: string, options?: Call['options']) {
          call.select = columns;
          call.options = options;
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.filters.push({ column, values });
          return builder;
        },
        order() {
          return builder;
        },
        limit(n: number) {
          call.limit = n;
          return builder;
        },
        then(onFulfilled: (value: QueryResult) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: null, count: null, error: null, ...resolve(call) }).then(
            onFulfilled,
            onRejected
          );
        },
      };
      return builder;
    },
  },
}));

import { GET } from '../route';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope, type AdminScope } from '@/lib/auth/admin-scope';

const SITE_PLAYER = { playerId: 'p-site', isAdmin: true, isResourceAdmin: false };
const RES_PLAYER = { playerId: 'p-res', isAdmin: false, isResourceAdmin: true };

const SITE_SCOPE: AdminScope = { playerId: 'p-site', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
const RES_SCOPE: AdminScope = {
  playerId: 'p-res',
  isSiteAdmin: false,
  seasonIds: ['season-1'],
  tournamentIds: ['t-1', 't-2', 't-3'],
};
const EMPTY_SCOPE: AdminScope = { ...RES_SCOPE, seasonIds: [], tournamentIds: [] };

function attentionRow(id: string, createdAt: string, seasonName: string | null) {
  return {
    id,
    tournament_id: 't-1',
    status: 'disputed',
    created_at: createdAt,
    player_1: { name: 'Mara' },
    player_2: { name: 'Nora' },
    tournaments: { name: 'Group stage', seasons: seasonName ? { name: seasonName } : null },
  };
}

const COUNTS: Record<string, number> = { players: 120, tournaments: 9, seasons: 4, games: 800 };
const AUDIT_ROW = {
  id: 'a-1',
  actor_name: 'Admin',
  action: 'player.suspend',
  resource_type: 'player',
  resource_id: 'p-9',
  resource_name: 'Mara',
  created_at: '2026-01-01T00:00:00Z',
};

/** Default database: count tables, matches (active vs attention) and the audit log. */
function defaultResolver(call: Call): QueryResult {
  if (call.table === 'matches') {
    const statuses = call.filters.find((f) => f.column === 'status')?.values ?? [];
    if (call.options?.head) {
      return { count: statuses.includes('scheduled') ? 7 : 0 };
    }
    return { data: [attentionRow('m-1', '2026-02-01T00:00:00Z', 'Summer League')], count: 1 };
  }
  if (call.table === 'audit_log') return { data: [AUDIT_ROW] };
  return { count: COUNTS[call.table] ?? 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  resolve = defaultResolver;
  vi.mocked(requireAnyAdmin).mockResolvedValue(SITE_PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE_SCOPE);
});

describe('GET /api/admin/dashboard: guard', () => {
  it('returns 403 for an unauthorised caller before reading anything', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(getAdminScope).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('uses the any-admin guard and derives the scope from the live player', async () => {
    await GET();
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(SITE_PLAYER);
  });
});

describe('GET /api/admin/dashboard: site admin', () => {
  it('returns the site-wide totals, the attention list and the audit trail', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.counts).toEqual({
      players: 120,
      tournaments: 9,
      active_matches: 7,
      seasons: 4,
      games: 800,
    });
    expect(body.data.attention_total).toBe(1);
    expect(body.data.attention_required).toEqual([
      {
        id: 'm-1',
        tournament_id: 't-1',
        tournament_name: 'Group stage',
        season_name: 'Summer League',
        player_1_name: 'Mara',
        player_2_name: 'Nora',
        status: 'disputed',
        created_at: '2026-02-01T00:00:00Z',
      },
    ]);
    expect(body.data.recent_activity).toEqual([AUDIT_ROW]);
    expectNoPrivatePlayerData(body, { allowKeys: ['status'] });
  });

  it('does not restrict any query to tournaments', async () => {
    await GET();
    expect(calls.some((c) => c.filters.some((f) => f.column === 'tournament_id'))).toBe(false);
  });

  it('asks for the real attention total next to the 20-row page', async () => {
    resolve = (call) => {
      if (call.table === 'matches' && !call.options?.head) {
        return { data: [attentionRow('m-1', '2026-02-01T00:00:00Z', null)], count: 57 };
      }
      return defaultResolver(call);
    };
    const body = await (await GET()).json();
    const attention = calls.find((c) => c.table === 'matches' && c.options?.count === 'exact' && !c.options.head);
    expect(attention?.limit).toBe(20);
    expect(body.data.attention_total).toBe(57);
    expect(body.data.attention_required).toHaveLength(1);
    expect(body.data.attention_required[0].season_name).toBeNull();
  });

  it('fails with the safe 500 when a count query errors instead of showing zero', async () => {
    resolve = (call) =>
      call.table === 'players' ? { count: null, error: { message: 'relation "x" leaked detail' } } : defaultResolver(call);
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load dashboard' });
  });

  it('fails with the safe 500 when the audit read errors', async () => {
    resolve = (call) =>
      call.table === 'audit_log' ? { data: null, error: { message: 'boom' } } : defaultResolver(call);
    expect((await GET()).status).toBe(500);
  });
});

describe('GET /api/admin/dashboard: resource admin', () => {
  beforeEach(() => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(RES_PLAYER as never);
    vi.mocked(getAdminScope).mockResolvedValue(RES_SCOPE);
  });

  it('scopes the counts and the attention list and hides the site-wide figures', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.counts).toEqual({
      players: null,
      tournaments: 3,
      active_matches: 7,
      seasons: 1,
      games: null,
    });
    expect(body.data.recent_activity).toBeNull();
    expect(body.data.attention_required).toHaveLength(1);
    expect(body.data.attention_total).toBe(1);
    expectNoPrivatePlayerData(body, { allowKeys: ['status'] });
  });

  it('never reads site-wide tables or the audit log', async () => {
    await GET();
    const tables = new Set(calls.map((c) => c.table));
    expect(tables).toEqual(new Set(['matches']));
  });

  it('filters every match query to the tournaments in scope', async () => {
    await GET();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.filters).toContainEqual({ column: 'tournament_id', values: ['t-1', 't-2', 't-3'] });
    }
  });

  it('chunks a long tournament list and sums the counts across the chunks', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t-${i}`);
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, tournamentIds: ids });
    resolve = (call) => {
      if (call.options?.head) return { count: 2 };
      return { data: [], count: 3 };
    };
    const body = await (await GET()).json();
    const idFilters = calls.flatMap((c) => c.filters.filter((f) => f.column === 'tournament_id'));
    expect(idFilters.every((f) => f.values.length <= 100)).toBe(true);
    expect(idFilters.flatMap((f) => f.values)).toHaveLength(500); // 250 ids in both the count and the list query
    expect(body.data.counts.tournaments).toBe(250);
    expect(body.data.counts.active_matches).toBe(6);
    expect(body.data.attention_total).toBe(9);
  });

  it('merges the newest attention rows across chunks, capped at 20', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `t-${i}`);
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, tournamentIds: ids });
    let n = 0;
    resolve = (call) => {
      if (call.options?.head) return { count: 0 };
      const chunkNo = n++;
      const rows = Array.from({ length: 20 }, (_, i) =>
        attentionRow(`m-${chunkNo}-${i}`, `2026-03-${String(10 + chunkNo * 5 + (i % 5)).padStart(2, '0')}T00:00:00Z`, null)
      );
      return { data: rows, count: 40 };
    };
    const body = await (await GET()).json();
    expect(body.data.attention_required).toHaveLength(20);
    const times = body.data.attention_required.map((r: { created_at: string }) => r.created_at);
    expect(times).toEqual([...times].sort().reverse());
    expect(body.data.attention_total).toBe(80);
  });

  it('returns zeros and empty lists, not an error, when nothing is assigned', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(EMPTY_SCOPE);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        counts: { players: null, tournaments: 0, active_matches: 0, seasons: 0, games: null },
        attention_required: [],
        attention_total: 0,
        recent_activity: null,
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('gives a tournament-only admin zero leagues (the parent season is not theirs)', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, seasonIds: [], tournamentIds: ['t-1'] });
    const body = await (await GET()).json();
    expect(body.data.counts.seasons).toBe(0);
    expect(body.data.counts.tournaments).toBe(1);
  });

  it('fails with the safe 500 when a match read errors', async () => {
    resolve = () => ({ data: null, count: null, error: { message: 'boom' } });
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load dashboard' });
  });
});
