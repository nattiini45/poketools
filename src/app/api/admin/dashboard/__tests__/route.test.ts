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
  eqs: Array<{ column: string; value: unknown }>;
  orders: Array<{ column: string; options: unknown }>;
  range: [number, number] | null;
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
      const call: Call = {
        table,
        select: '',
        options: undefined,
        filters: [],
        eqs: [],
        orders: [],
        range: null,
        limit: null,
      };
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
        eq(column: string, value: unknown) {
          call.eqs.push({ column, value });
          return builder;
        },
        order(column: string, options?: unknown) {
          call.orders.push({ column, options });
          return builder;
        },
        range(from: number, to: number) {
          call.range = [from, to];
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
  seasonIds: ['s-live'],
  tournamentIds: ['t-phase', 't-solo'],
};

// ── Fake competitions ─────────────────────────────────────────────────

interface TournamentFixture {
  id: string;
  season_id: string | null;
  archived: boolean;
}
interface SeasonFixture {
  id: string;
  archived: boolean;
  is_test_season: boolean;
}

const baseTournaments: TournamentFixture[] = [
  { id: 't-solo', season_id: null, archived: false },
  { id: 't-phase', season_id: 's-live', archived: false },
  { id: 't-test-phase', season_id: 's-test', archived: false },
  { id: 't-archived-league-phase', season_id: 's-archived', archived: false },
  { id: 't-archived', season_id: null, archived: true },
];
const baseSeasons: SeasonFixture[] = [
  { id: 's-live', archived: false, is_test_season: false },
  { id: 's-test', archived: false, is_test_season: true },
  { id: 's-archived', archived: true, is_test_season: false },
];

let tournaments: TournamentFixture[] = baseTournaments;
let seasons: SeasonFixture[] = baseSeasons;

/** Applies the in / eq / order(id) / range of a call to a fixture table, like the database would. */
function readFixture<T extends object>(rows: T[], call: Call): T[] {
  const field = (row: T, column: string) => (row as Record<string, unknown>)[column];
  let out = rows;
  for (const f of call.filters) out = out.filter((r) => f.values.includes(field(r, f.column)));
  for (const e of call.eqs) out = out.filter((r) => field(r, e.column) === e.value);
  out = [...out].sort((a, b) => String(field(a, 'id')).localeCompare(String(field(b, 'id'))));
  if (call.range) out = out.slice(call.range[0], call.range[1] + 1);
  return out;
}

function attentionRow(
  id: string,
  updatedAt: string,
  over: Partial<{
    status: string;
    notes: string | null;
    seasonName: string | null;
    tournamentId: string;
    joins: boolean;
  }> = {}
) {
  const joins = over.joins ?? true;
  return {
    id,
    tournament_id: over.tournamentId ?? 't-phase',
    status: over.status ?? 'disputed',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: updatedAt,
    notes: over.notes ?? null,
    player_1: joins ? { name: 'Mara' } : null,
    player_2: joins ? { name: 'Nora' } : null,
    tournaments: joins
      ? {
          name: 'Group stage',
          seasons: over.seasonName === null ? null : { name: over.seasonName ?? 'Summer League' },
        }
      : null,
  };
}

const COUNTS: Record<string, number> = { players: 120, games: 800 };
const AUDIT_ROW = {
  id: 'a-1',
  actor_name: 'Admin',
  action: 'player.suspend',
  resource_type: 'player',
  resource_id: 'p-9',
  resource_name: 'Mara',
  created_at: '2026-01-01T00:00:00Z',
};

const statusesOf = (call: Call) => call.filters.find((f) => f.column === 'status')?.values ?? [];

/** Default database: competitions, match counts per status, one attention row and the audit log. */
function defaultResolver(call: Call): QueryResult {
  if (call.table === 'tournaments') return { data: readFixture(tournaments, call) };
  if (call.table === 'seasons') return { data: readFixture(seasons, call) };
  if (call.table === 'matches') {
    const statuses = statusesOf(call);
    if (call.options?.head) {
      if (statuses.includes('scheduled')) return { count: 7 };
      return { count: statuses.includes('disputed') ? 2 : 1 };
    }
    return { data: [attentionRow('m-1', '2026-02-01T00:00:00Z', { notes: 'Both players claim the win' })] };
  }
  if (call.table === 'audit_log') return { data: [AUDIT_ROW] };
  return { count: COUNTS[call.table] ?? 0 };
}

/** Same as the default database, with the attention-row page replaced. */
function withAttentionRows(rows: unknown[]): (call: Call) => QueryResult {
  return (call) =>
    call.table === 'matches' && !call.options?.head ? { data: rows } : defaultResolver(call);
}

const matchCalls = () => calls.filter((c) => c.table === 'matches');
const idFilters = () => matchCalls().flatMap((c) => c.filters.filter((f) => f.column === 'tournament_id'));
const attentionCalls = () => matchCalls().filter((c) => !c.options?.head);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  tournaments = baseTournaments;
  seasons = baseSeasons;
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
  it('returns the live totals, the attention list and the audit trail', async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.counts).toEqual({
      players: 120,
      tournaments: 1, // t-solo only: league phases are counted with their league
      active_matches: 7,
      leagues: 1, // s-live only: not the test league, not the archived one
      games: 800,
    });
    expect(body.data.attention_total).toBe(3);
    expect(body.data.attention_by_status).toEqual({ disputed: 2, pending_confirmation: 1 });
    expect(body.data.attention_required).toEqual([
      {
        id: 'm-1',
        tournament_id: 't-phase',
        tournament_name: 'Group stage',
        season_name: 'Summer League',
        player_1_name: 'Mara',
        player_2_name: 'Nora',
        status: 'disputed',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-02-01T00:00:00Z',
        note: 'Both players claim the win',
      },
    ]);
    expect(body.data.recent_activity).toEqual([AUDIT_ROW]);
    expectNoPrivatePlayerData(body, { allowKeys: ['status'] });
  });

  it('counts only players that are not test accounts and leaves games unfiltered', async () => {
    await GET();
    expect(calls.find((c) => c.table === 'players')?.eqs).toEqual([{ column: 'is_test_account', value: false }]);
    expect(calls.find((c) => c.table === 'games')?.eqs).toEqual([]);
  });

  it('only ever filters matches to eligible tournaments: no archived, test-league or archived-league ones', async () => {
    await GET();
    expect(matchCalls().length).toBeGreaterThan(0);
    const sent = idFilters().flatMap((f) => f.values);
    expect(sent).toContain('t-solo'); // standalone
    expect(sent).toContain('t-phase'); // phase of an active league
    expect(sent).not.toContain('t-archived');
    expect(sent).not.toContain('t-test-phase');
    expect(sent).not.toContain('t-archived-league-phase');
    // every matches query is restricted: nothing is read site-wide any more
    expect(matchCalls().every((c) => c.filters.some((f) => f.column === 'tournament_id'))).toBe(true);
  });

  it('reads only non-archived tournaments and pages the competition reads', async () => {
    await GET();
    const tournamentRead = calls.find((c) => c.table === 'tournaments');
    expect(tournamentRead?.eqs).toContainEqual({ column: 'archived', value: false });
    expect(tournamentRead?.range).toEqual([0, 999]);
  });

  it('asks for the oldest attention rows first, 20 per chunk, without an exact count', async () => {
    await GET();
    const [attention] = attentionCalls();
    expect(attention.orders).toEqual([
      { column: 'updated_at', options: { ascending: true } },
      { column: 'id', options: undefined },
    ]);
    expect(attention.limit).toBe(20);
    expect(attention.options?.count).toBeUndefined();
    expect(attention.select).toContain('updated_at');
    expect(attention.select).toContain('notes');
    expect(attention.filters).toContainEqual({ column: 'status', values: ['disputed', 'pending_confirmation'] });
  });

  it('fills attention_total from the per-status counts, not from the row page', async () => {
    resolve = (call) => {
      if (call.table === 'matches' && call.options?.head) {
        const statuses = statusesOf(call);
        if (statuses.includes('disputed')) return { count: 40 };
        if (statuses.includes('pending_confirmation') && statuses.length === 1) return { count: 17 };
      }
      return defaultResolver(call);
    };
    const body = await (await GET()).json();
    expect(body.data.attention_total).toBe(57);
    expect(body.data.attention_by_status).toEqual({ disputed: 40, pending_confirmation: 17 });
    expect(body.data.attention_required).toHaveLength(1);
  });

  it('returns a null league name for a standalone tournament', async () => {
    resolve = withAttentionRows([
      attentionRow('m-1', '2026-02-01T00:00:00Z', { seasonName: null, tournamentId: 't-solo' }),
    ]);
    const body = await (await GET()).json();
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

  it('fails with the safe 500 when the competition read errors', async () => {
    resolve = (call) =>
      call.table === 'seasons' ? { data: null, error: { message: 'boom' } } : defaultResolver(call);
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load dashboard' });
  });

  it('runs no match query when no tournament is live', async () => {
    tournaments = [{ id: 't-archived', season_id: null, archived: true }];
    const body = await (await GET()).json();
    expect(matchCalls()).toHaveLength(0);
    expect(body.data.counts).toMatchObject({ tournaments: 0, active_matches: 0, leagues: 1 });
    expect(body.data.attention_required).toEqual([]);
    expect(body.data.attention_total).toBe(0);
    expect(body.data.attention_by_status).toEqual({ disputed: 0, pending_confirmation: 0 });
  });
});

describe('GET /api/admin/dashboard: attention rows', () => {
  it('carries a disputed row note, trimmed and cut at 200 characters', async () => {
    resolve = withAttentionRows([attentionRow('m-1', '2026-02-01T00:00:00Z', { notes: `  ${'x'.repeat(260)}  ` })]);
    const body = await (await GET()).json();
    expect(body.data.attention_required[0].note).toBe('x'.repeat(200));
  });

  it('has no note for a pending row or an empty note', async () => {
    resolve = withAttentionRows([
      attentionRow('m-1', '2026-02-01T00:00:00Z', { status: 'pending_confirmation', notes: 'internal remark' }),
      attentionRow('m-2', '2026-02-02T00:00:00Z', { status: 'disputed', notes: '   ' }),
      attentionRow('m-3', '2026-02-03T00:00:00Z', { status: 'disputed', notes: null }),
    ]);
    const body = await (await GET()).json();
    expect(body.data.attention_required.map((r: { note: string | null }) => r.note)).toEqual([null, null, null]);
  });

  it('returns null names for a missing join instead of the string Unknown', async () => {
    resolve = withAttentionRows([attentionRow('m-1', '2026-02-01T00:00:00Z', { joins: false })]);
    const row = (await (await GET()).json()).data.attention_required[0];
    expect(row.tournament_name).toBeNull();
    expect(row.player_1_name).toBeNull();
    expect(row.player_2_name).toBeNull();
    expect(row.season_name).toBeNull();
    expect(JSON.stringify(row)).not.toContain('Unknown');
  });

  it('keeps the globally oldest 20 rows when two chunks are merged', async () => {
    tournaments = Array.from({ length: 120 }, (_, i) => ({
      id: `t-${String(i).padStart(3, '0')}`,
      season_id: null,
      archived: false,
    }));
    resolve = (call) => {
      if (call.table !== 'matches') return defaultResolver(call);
      const first = call.filters.find((f) => f.column === 'tournament_id')?.values[0] === 't-000';
      if (call.options?.head) return { count: first ? 5 : 3 };
      // chunk 1 holds days 10..29 (newer), chunk 2 days 01..20 (older, interleaving with it)
      const start = first ? 10 : 1;
      return {
        data: Array.from({ length: 20 }, (_, i) =>
          attentionRow(`m-${first ? 'a' : 'b'}${i}`, `2026-03-${String(start + i).padStart(2, '0')}T00:00:00Z`)
        ),
      };
    };
    const body = await (await GET()).json();

    expect(attentionCalls()).toHaveLength(2); // 120 ids -> two chunks
    expect(idFilters().every((f) => f.values.length <= 100)).toBe(true);

    const rows = body.data.attention_required as Array<{ id: string; updated_at: string }>;
    expect(rows).toHaveLength(20);
    const times = rows.map((r) => r.updated_at);
    expect(times).toEqual([...times].sort());
    // The oldest 20 of the 40 mix both chunks by age: days 01..09 (chunk b), then days 10..14 of both, then day 15.
    expect(rows[0].id).toBe('m-b0');
    expect(times[19] <= '2026-03-15T00:00:00Z').toBe(true);
    expect(rows.some((r) => r.id === 'm-a19')).toBe(false);
  });

  it('orders merged chunk rows by instant, not by the timestamp text', async () => {
    tournaments = Array.from({ length: 120 }, (_, i) => ({
      id: `t-${String(i).padStart(3, '0')}`,
      season_id: null,
      archived: false,
    }));
    resolve = (call) => {
      if (call.table !== 'matches') return defaultResolver(call);
      const first = call.filters.find((f) => f.column === 'tournament_id')?.values[0] === 't-000';
      if (call.options?.head) return { count: 1 };
      // Postgres prints no fraction when it is zero: ...:00Z sorts after ...:00.500Z as text, yet it is earlier.
      return {
        data: [attentionRow(first ? 'm-half' : 'm-whole', first ? '2026-03-01T00:00:00.500Z' : '2026-03-01T00:00:00Z')],
      };
    };
    const body = await (await GET()).json();

    const ids = (body.data.attention_required as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['m-whole', 'm-half']);
  });

  it('adds attention_by_status and attention_total up across chunks', async () => {
    tournaments = Array.from({ length: 250 }, (_, i) => ({ id: `t-${i}`, season_id: null, archived: false }));
    resolve = (call) => {
      if (call.table === 'matches' && call.options?.head) {
        const statuses = statusesOf(call);
        return { count: statuses.includes('scheduled') ? 2 : statuses.includes('disputed') ? 3 : 4 };
      }
      return call.table === 'matches' ? { data: [] } : defaultResolver(call);
    };
    const body = await (await GET()).json();
    // 250 ids -> 3 chunks per count query
    expect(body.data.attention_by_status).toEqual({ disputed: 9, pending_confirmation: 12 });
    expect(body.data.attention_total).toBe(21);
    expect(body.data.counts.active_matches).toBe(6);
    expect(body.data.counts.tournaments).toBe(250);
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
      tournaments: 1,
      active_matches: 7,
      leagues: 1,
      games: null,
    });
    expect(body.data.recent_activity).toBeNull();
    expect(body.data.attention_required).toHaveLength(1);
    expect(body.data.attention_total).toBe(3);
    expectNoPrivatePlayerData(body, { allowKeys: ['status'] });
  });

  it('never reads site-wide tables or the audit log', async () => {
    await GET();
    expect(new Set(calls.map((c) => c.table))).toEqual(new Set(['matches', 'tournaments', 'seasons']));
  });

  it('filters every match query to the eligible tournaments in scope', async () => {
    await GET();
    expect(matchCalls().length).toBeGreaterThan(0);
    for (const call of matchCalls()) {
      expect(call.filters).toContainEqual({ column: 'tournament_id', values: ['t-phase', 't-solo'] });
    }
  });

  it('drops scoped tournaments of a test league and archived tournaments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({
      ...RES_SCOPE,
      seasonIds: ['s-test'],
      tournamentIds: ['t-test-phase', 't-archived', 't-solo'],
    });
    const body = await (await GET()).json();
    expect(matchCalls().length).toBeGreaterThan(0);
    for (const call of matchCalls()) {
      expect(call.filters).toContainEqual({ column: 'tournament_id', values: ['t-solo'] });
    }
    expect(body.data.counts.leagues).toBe(0);
    expect(body.data.counts.tournaments).toBe(1);
  });

  it('chunks a long tournament list and sums the counts across the chunks', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `t-${i}`);
    tournaments = ids.map((id) => ({ id, season_id: null, archived: false }));
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, seasonIds: [], tournamentIds: ids });
    resolve = (call) => {
      if (call.table === 'matches') return call.options?.head ? { count: 2 } : { data: [] };
      return defaultResolver(call);
    };
    const body = await (await GET()).json();
    expect(idFilters().every((f) => f.values.length <= 100)).toBe(true);
    // 250 ids in each of the four matches queries: active count, two attention counts, attention rows
    expect(idFilters().flatMap((f) => f.values)).toHaveLength(1000);
    expect(body.data.counts.tournaments).toBe(250);
    expect(body.data.counts.active_matches).toBe(6);
    expect(body.data.attention_total).toBe(12);
  });

  it('returns zeros and empty lists, not an error, when nothing is assigned', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, seasonIds: [], tournamentIds: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: {
        counts: { players: null, tournaments: 0, active_matches: 0, leagues: 0, games: null },
        attention_required: [],
        attention_total: 0,
        attention_by_status: { disputed: 0, pending_confirmation: 0 },
        recent_activity: null,
      },
    });
    expect(calls).toHaveLength(0);
  });

  it('gives a tournament-only admin zero leagues (the parent season is not theirs)', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, seasonIds: [], tournamentIds: ['t-solo'] });
    const body = await (await GET()).json();
    expect(body.data.counts.leagues).toBe(0);
    expect(body.data.counts.tournaments).toBe(1);
  });

  it('gives a tournament-only admin under a test league zero attention rows and zero leagues', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...RES_SCOPE, seasonIds: [], tournamentIds: ['t-test-phase'] });
    const body = await (await GET()).json();
    expect(body.data.counts).toEqual({
      players: null,
      tournaments: 0,
      active_matches: 0,
      leagues: 0,
      games: null,
    });
    expect(body.data.attention_required).toEqual([]);
    expect(body.data.attention_total).toBe(0);
    expect(matchCalls()).toHaveLength(0);
  });

  it('gives an admin with only archived assignments zeros and runs no match query', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({
      ...RES_SCOPE,
      seasonIds: ['s-archived'],
      tournamentIds: ['t-archived', 't-archived-league-phase'],
    });
    const body = await (await GET()).json();
    expect(body.data.counts).toEqual({
      players: null,
      tournaments: 0,
      active_matches: 0,
      leagues: 0,
      games: null,
    });
    expect(body.data.attention_required).toEqual([]);
    expect(matchCalls()).toHaveLength(0);
  });

  it('fails with the safe 500 when a match read errors', async () => {
    resolve = (call) =>
      call.table === 'matches' ? { data: null, count: null, error: { message: 'boom' } } : defaultResolver(call);
    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to load dashboard' });
  });
});
