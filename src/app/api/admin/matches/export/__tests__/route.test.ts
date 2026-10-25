import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

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

// Real scope predicates, mocked scope read.
vi.mock('@/lib/auth/admin-scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/admin-scope')>()),
  getAdminScope: vi.fn(),
}));

// Real response builder, mocked limiter.
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

vi.mock('@/lib/supabase/queries/matches', () => ({
  listAdminMatchesForExport: vi.fn(),
  listAdminMatchesPage: vi.fn(),
  findPlayerIdsForMatchSearch: vi.fn(),
  listMatchFilterPlayers: vi.fn(),
  listTournamentIdsBySeason: vi.fn(),
}));

import { GET } from '@/app/api/admin/matches/export/route';
import { GET as listGET } from '@/app/api/admin/matches/route';
import { ADMIN_MATCH_EXPORT_CAP, MATCH_EXPORT_BOM, MATCH_EXPORT_COLUMNS } from '@/lib/admin/match-export';
import { requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import type { AdminScope } from '@/lib/auth/admin-scope';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import {
  findPlayerIdsForMatchSearch,
  listAdminMatchesForExport,
  listAdminMatchesPage,
  listMatchFilterPlayers,
  listTournamentIdsBySeason,
} from '@/lib/supabase/queries/matches';

const PLAYER = { playerId: 'p-admin', isAdmin: true, isResourceAdmin: false, name: 'Admin Anna' };
const SEASON = '11111111-1111-4111-8111-111111111111';
const SEASON_OTHER = '99999999-9999-4999-8999-999999999999';
const PHASE_A = '22222222-2222-4222-8222-222222222222';
const PHASE_B = '33333333-3333-4333-8333-333333333333';
const STANDALONE = '44444444-4444-4444-8444-444444444444';
const PLAYER_ID_1 = '55555555-5555-4555-8555-555555555555';
const PLAYER_ID_2 = '66666666-6666-4666-8666-666666666666';
const MATCH_ID = '77777777-7777-4777-8777-777777777777';
const ROUND_ID = '88888888-8888-4888-8888-888888888888';

const SITE_SCOPE: AdminScope = { playerId: 'p-admin', isSiteAdmin: true, seasonIds: null, tournamentIds: null };
const SEASON_ADMIN_SCOPE: AdminScope = {
  playerId: 'p-res',
  isSiteAdmin: false,
  seasonIds: [SEASON],
  tournamentIds: [PHASE_A, PHASE_B],
};

const HEADER_LINE = MATCH_EXPORT_COLUMNS.map((column) => `"${column}"`).join(',');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: MATCH_ID,
    tournament_id: PHASE_A,
    tournament_name: 'Group stage',
    season_id: SEASON,
    season_name: 'Summer League',
    round_name: 'Round 1',
    round_number: 1,
    player_1_id: PLAYER_ID_1,
    player_2_id: PLAYER_ID_2,
    player_1_name: 'Mara',
    player_2_name: 'Nora',
    winner_name: 'Mara',
    status: 'completed',
    best_of: 3,
    scheduled_at: '2026-10-25T10:00:00.000Z',
    date_played: '2026-10-25T11:30:00.000Z',
    games: [],
    ...overrides,
  } as never;
}

function req(search = ''): NextRequest {
  return { url: `http://localhost:3000/api/admin/matches/export${search}` } as unknown as NextRequest;
}

function listReq(search = ''): NextRequest {
  return { url: `http://localhost:3000/api/admin/matches${search}` } as unknown as NextRequest;
}

/** The body decoded with the byte order mark kept (Response.text() would drop it). */
async function rawBody(res: Response): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
}

function exported(rows: unknown[] = [row()], total = rows.length, truncated = false) {
  return { rows, total, truncated } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(PLAYER as never);
  vi.mocked(getAdminScope).mockResolvedValue(SITE_SCOPE);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 19, retryAfterSeconds: 0 });
  vi.mocked(listAdminMatchesForExport).mockResolvedValue(exported());
  vi.mocked(listAdminMatchesPage).mockResolvedValue({ rows: [], total: 0 } as never);
  vi.mocked(listTournamentIdsBySeason).mockResolvedValue([PHASE_A, PHASE_B]);
  vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [PLAYER_ID_1], truncated: false });
  vi.mocked(listMatchFilterPlayers).mockResolvedValue([]);
});

describe('GET /api/admin/matches/export: guard and rate limit', () => {
  it('uses the any-admin guard and reads the scope of the live player', async () => {
    await GET(req());
    expect(requireAnyAdmin).toHaveBeenCalledTimes(1);
    expect(getAdminScope).toHaveBeenCalledWith(PLAYER);
  });

  it('runs the guard before parsing: an unauthenticated caller gets 403, not a 400', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new AuthError('Admin access required', 403, 'forbidden'));
    const res = await GET(req('?page=0'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error: 'Admin access required', code: 'forbidden' });
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
  });

  it('rate limits per player in the export bucket', async () => {
    await GET(req());
    expect(checkRateLimit).toHaveBeenCalledWith('admin-match-export', 'p-admin', { limit: 20, windowSeconds: 3600 });
  });

  it('answers 429 with Retry-After, and reads nothing, when the limit is reached', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 321 });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('321');
    expect((await res.json()).code).toBe('rate_limited');
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/matches/export: scope parity with the list', () => {
  it('403s a tournament_id outside the scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    const res = await GET(req(`?tournament_id=${STANDALONE}`));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Admin access required for this resource',
      code: 'forbidden',
    });
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('403s a season_id the admin has no phase or assignment in', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    vi.mocked(listTournamentIdsBySeason).mockResolvedValue(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    const res = await GET(req(`?season_id=${SEASON_OTHER}`));
    expect(res.status).toBe(403);
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
  });

  it('restricts a resource admin to their tournaments', async () => {
    vi.mocked(getAdminScope).mockResolvedValue(SEASON_ADMIN_SCOPE);
    await GET(req());
    expect(listAdminMatchesForExport).toHaveBeenCalledWith(
      expect.objectContaining({ tournamentIds: [PHASE_A, PHASE_B] }),
      ADMIN_MATCH_EXPORT_CAP
    );
  });

  it('exports a header-only file, reading no match, for a resource admin with an empty scope', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, seasonIds: [], tournamentIds: [] });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await rawBody(res)).toBe(MATCH_EXPORT_BOM + HEADER_LINE);
    expect(res.headers.get('X-Export-Count')).toBe('0');
    expect(res.headers.get('X-Export-Total')).toBe('0');
    expect(res.headers.get('X-Export-Truncated')).toBe('false');
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
  });

  it('exports a header-only file when the player search finds nobody', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [], truncated: false });
    const res = await GET(req('?q=nobody'));
    expect(res.status).toBe(200);
    expect(await rawBody(res)).toBe(MATCH_EXPORT_BOM + HEADER_LINE);
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
  });

  it('asks a resource admin with a very wide scope to narrow it, as the list does', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, tournamentIds: many });
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
  });

  it.each([
    ['no filter', ''],
    ['a league', `?season_id=${SEASON}`],
    ['a phase and a round', `?tournament_id=${PHASE_A}&round_id=${ROUND_ID}`],
    ['standalone tournaments', '?standalone=true'],
    ['statuses and a preset', '?status=disputed,pending_confirmation&preset=overdue'],
    ['a player search', '?q=mara'],
    ['a match id', `?q=${MATCH_ID}`],
    ['both players', `?player_id=${PLAYER_ID_1}&player2_id=${PLAYER_ID_2}`],
    ['a date window', '?date_field=created&date_from=2026-10-24T22:00:00.000Z&date_to=2026-10-25T23:00:00.000Z'],
    ['no date', '?date_field=played&date_none=true'],
    ['content flags', '?hand_edited=true&has_notes=true&replay=has&best_of=3'],
    ['the test and archived toggles', '?include_test=true&include_archived=true&sort=status_priority'],
  ])('passes the same filters as the list does (%s)', async (_label, search) => {
    for (const scope of [SITE_SCOPE, SEASON_ADMIN_SCOPE]) {
      vi.mocked(getAdminScope).mockResolvedValue(scope);
      vi.mocked(listAdminMatchesPage).mockClear();
      vi.mocked(listAdminMatchesForExport).mockClear();

      const listRes = await listGET(listReq(search));
      const exportRes = await GET(req(search));
      expect(listRes.status).toBe(200);
      expect(exportRes.status).toBe(200);

      const { page, pageSize, ...listFilters } = vi.mocked(listAdminMatchesPage).mock.calls[0][0];
      expect(page).toBe(1);
      expect(pageSize).toBe(50);
      expect(vi.mocked(listAdminMatchesForExport).mock.calls[0][0]).toEqual(listFilters);
    }
  });
});

describe('GET /api/admin/matches/export: query', () => {
  it('accepts page and page_size and ignores them', async () => {
    const res = await GET(req('?page=4&page_size=25'));
    expect(res.status).toBe(200);
    const filters = vi.mocked(listAdminMatchesForExport).mock.calls[0][0];
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('pageSize');
  });

  it.each([
    ['unknown parameter', '?limit=500'],
    ['constructor parameter', '?constructor=x'],
    ['repeated parameter', '?status=disputed&status=scheduled'],
    ['unknown status', '?status=bogus'],
    ['non-uuid season_id', '?season_id=abc'],
    ['round_id without tournament_id', `?round_id=${ROUND_ID}`],
    ['date_from after date_to', '?date_from=2026-10-26T00:00:00Z&date_to=2026-10-25T00:00:00Z'],
  ])('400s %s with the shared validation code', async (_label, search) => {
    const res = await GET(req(search));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params.issues).toBe(body.error);
    expect(listAdminMatchesForExport).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes the export cap to the query layer', async () => {
    await GET(req());
    expect(listAdminMatchesForExport).toHaveBeenCalledWith(expect.any(Object), 5000);
  });
});

describe('GET /api/admin/matches/export: response', () => {
  it('answers a CSV attachment that is never cached, with the counts in headers', async () => {
    vi.mocked(listAdminMatchesForExport).mockResolvedValue(exported([row(), row({ id: 'x' })], 2));
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="matches-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get('X-Export-Count')).toBe('2');
    expect(res.headers.get('X-Export-Total')).toBe('2');
    expect(res.headers.get('X-Export-Truncated')).toBe('false');
    expect(res.headers.has('X-Export-Search-Truncated')).toBe(false);
  });

  it('starts the body with the byte order mark, then the header line', async () => {
    const res = await GET(req());
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await rawBody(res);
    expect(text.startsWith(MATCH_EXPORT_BOM)).toBe(true);
    expect(text.slice(1).split('\n')[0]).toBe(HEADER_LINE);
    expect(text).toContain(MATCH_ID);
    expect(text).toContain('Summer League');
  });

  it('reports "N of M" and names the file after it when the cap cut the export', async () => {
    const rows = [row(), row({ id: 'y' })];
    vi.mocked(listAdminMatchesForExport).mockResolvedValue(exported(rows, 7421, true));
    const res = await GET(req());

    expect(res.headers.get('X-Export-Count')).toBe('2');
    expect(res.headers.get('X-Export-Total')).toBe('7421');
    expect(res.headers.get('X-Export-Truncated')).toBe('true');
    expect(res.headers.get('Content-Disposition')).toMatch(/filename="matches-\d{4}-\d{2}-\d{2}-2-of-7421\.csv"/);
  });

  it('flags a player search that was cut at its cap', async () => {
    vi.mocked(findPlayerIdsForMatchSearch).mockResolvedValue({ ids: [PLAYER_ID_1], truncated: true });
    const res = await GET(req('?q=a'));
    expect(res.headers.get('X-Export-Search-Truncated')).toBe('true');
  });

  it('quote-prefixes a player named like a formula', async () => {
    vi.mocked(listAdminMatchesForExport).mockResolvedValue(
      exported([row({ player_1_name: '=HYPERLINK("http://evil.example","x")', player_2_name: '@SUM(A1)', winner_name: null })])
    );
    const text = await rawBody(await GET(req()));

    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(text).toContain(`"'@SUM(A1)"`);
    expect(text).not.toMatch(/(^|,)"=HYPERLINK/m);
  });

  it('answers JSON, not a file, for an error', async () => {
    vi.mocked(listAdminMatchesForExport).mockRejectedValue(new Error('relation "matches" does not exist'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(body).toEqual({ success: false, error: 'Failed to export matches' });
    expect(logAuditEvent).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('GET /api/admin/matches/export: audit', () => {
  it('writes one export event with the counts and the validated filters, without the paging', async () => {
    vi.mocked(listAdminMatchesForExport).mockResolvedValue(exported([row()], 9, true));
    await GET(req(`?status=disputed&tournament_id=${PHASE_A}&page=3&page_size=25`));

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'p-admin',
      actor_name: 'Admin Anna',
      action: 'admin.export',
      resource_type: 'matches',
      resource_id: null,
      metadata: {
        count: 1,
        total: 9,
        truncated: true,
        filters: { status: ['disputed'], tournament_id: PHASE_A },
      },
    });
  });

  it('writes the event for a header-only export too', async () => {
    vi.mocked(getAdminScope).mockResolvedValue({ ...SEASON_ADMIN_SCOPE, seasonIds: [], tournamentIds: [] });
    await GET(req());
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      count: 0,
      total: 0,
      truncated: false,
      filters: {},
    });
  });
});
