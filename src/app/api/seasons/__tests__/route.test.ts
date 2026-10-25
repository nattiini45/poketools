import { beforeEach, describe, expect, it, vi } from 'vitest';

// The route expires public read-cache tags after its write (D37). Outside a
// Next request `revalidateTag` throws, so record the calls instead.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import type { NextRequest } from 'next/server';
import type { SeasonWithDetails } from '@/types/season';

vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  getLiveAccess: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  createSeason: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/resource-admins', () => ({
  addResourceAdmin: vi.fn(),
}));

vi.mock('@/lib/season/format-rules-defaults', () => ({
  initializeEpbFormatRules: vi.fn(),
}));

vi.mock('@/lib/season/point-buy-battle-ruleset', () => ({
  ensurePointBuyBattleRuleset: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/point-buy-lists', () => ({
  getActiveListVersion: vi.fn(),
  bindSeasonToList: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

// The clone path has its own suite (clone-route.test.ts); here it must stay unreached.
vi.mock('@/lib/season/clone', () => ({
  assertCloneAllowed: vi.fn(),
  copyLeagueStructure: vi.fn(),
  createCloneTracker: vi.fn(),
  rollbackClonedLeague: vi.fn(),
}));

import { GET, POST } from '@/app/api/seasons/route';
import { getLiveAccess, requireAnyAdmin, AuthError } from '@/lib/auth/helpers';
import { listSeasons, listArchivedSeasons, createSeason } from '@/lib/supabase/queries/seasons';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { initializeEpbFormatRules } from '@/lib/season/format-rules-defaults';
import { ensurePointBuyBattleRuleset } from '@/lib/season/point-buy-battle-ruleset';
import { getActiveListVersion, bindSeasonToList } from '@/lib/supabase/queries/point-buy-lists';
import { logAuditEvent } from '@/lib/audit/log';
import {
  assertCloneAllowed,
  copyLeagueStructure,
  createCloneTracker,
  rollbackClonedLeague,
} from '@/lib/season/clone';
import { revalidateTag } from 'next/cache';

const mockSeason: SeasonWithDetails = {
  id: 'season-1',
  name: 'Season One',
  description: 'First season',
  format_type: 'singles',
  status: 'active',
  archived: false,
  legacy: false,
  is_test_season: false,
  start_date: '2026-01-01',
  end_date: '2026-06-30',
  ruleset_id: null,
  core_pool: null,
  point_buy_list_id: null,
  language: 'de',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ruleset_name: null,
  participant_count: 0,
  tournament_count: 0,
};

const adminPlayer = {
  playerId: 'admin-1',
  name: 'Admin',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

const resourceAdminPlayer = {
  playerId: 'radmin-1',
  name: 'ResourceAdmin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active' as const,
};

describe('GET /api/seasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns seasons list without auth (public)', async () => {
    vi.mocked(listSeasons).mockResolvedValue([mockSeason]);

    const url = new URL('http://localhost:3000/api/seasons');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([mockSeason]);
    expect(vi.mocked(requireAnyAdmin)).not.toHaveBeenCalled();
  });

  it('asks for the default list: test leagues included', async () => {
    vi.mocked(listSeasons).mockResolvedValue([]);

    const request = { url: 'http://localhost:3000/api/seasons' } as unknown as NextRequest;
    await GET(request);

    expect(listSeasons).toHaveBeenCalledWith();
  });

  it('requires admin for archived seasons', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const url = new URL('http://localhost:3000/api/seasons?archived=true');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('returns archived seasons for admin', async () => {
    const archivedSeason = { ...mockSeason, archived: true };
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(listArchivedSeasons).mockResolvedValue([archivedSeason]);

    const url = new URL('http://localhost:3000/api/seasons?archived=true');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([archivedSeason]);
    expect(vi.mocked(listArchivedSeasons)).toHaveBeenCalledTimes(1);
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(listSeasons).mockRejectedValue(new Error('DB error'));

    const url = new URL('http://localhost:3000/api/seasons');
    const request = { url: url.toString() } as unknown as NextRequest;

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to fetch leagues');
  });
});

describe('GET /api/seasons — test leagues are listed for everyone', () => {
  const testSeason: SeasonWithDetails = { ...mockSeason, id: 'season-test', is_test_season: true };

  beforeEach(() => {
    vi.clearAllMocks();
    // listSeasons() sorts the test leagues after the real ones.
    vi.mocked(listSeasons).mockResolvedValue([mockSeason, testSeason]);
  });

  async function get(url: string) {
    const response = await GET({ url } as unknown as NextRequest);
    return { response, body: await response.json() };
  }

  it.each([
    'http://localhost:3000/api/seasons',
    // The Cast Studio's former opt-in flag no longer changes anything.
    'http://localhost:3000/api/seasons?include_test=1',
  ])('%s returns the test league, flagged, without reading a session', async (url) => {
    const { response, body } = await get(url);

    expect(response.status).toBe(200);
    expect(listSeasons).toHaveBeenCalledWith();
    expect(body.data.map((s: SeasonWithDetails) => [s.id, s.is_test_season])).toEqual([
      ['season-1', false],
      ['season-test', true],
    ]);
    // The same answer for every viewer: no role read, no per-viewer cache header.
    expect(getLiveAccess).not.toHaveBeenCalled();
    expect(requireAnyAdmin).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBeNull();
  });
});

describe('POST /api/seasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 when not admin', async () => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Admin access required', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'New Season', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.error).toContain('name');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it.each(['de', 'en'] as const)('passes the content language %s through to createSeason', async (language) => {
    const created = { ...mockSeason, id: 'season-new', language };
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createSeason).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles', language }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(createSeason).toHaveBeenCalledWith({ name: 'Season One', format_type: 'singles', language });
    expect(body.data.language).toBe(language);
  });

  it('leaves the language out when the body omits it (the column default applies)', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createSeason).mockResolvedValue(mockSeason);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    await POST(request);

    expect(createSeason).toHaveBeenCalledWith({ name: 'Season One', format_type: 'singles' });
  });

  it('rejects an unknown content language with 400 validation_failed before any write', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles', language: 'fr' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.error).toContain('language');
    expect(createSeason).not.toHaveBeenCalled();
  });

  it('creates season and returns 201 (site admin)', async () => {
    const created = { ...mockSeason, id: 'season-new' };
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createSeason).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data).toEqual(created);
    // Site admins should NOT get addResourceAdmin called
    expect(vi.mocked(addResourceAdmin)).not.toHaveBeenCalled();
    // D37: the new league shows in the season list on the next view.
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('season:season-new', { expire: 0 });
  });

  it('auto-assigns resource admin for non-site-admin creators', async () => {
    const created = { ...mockSeason, id: 'season-new' };
    vi.mocked(requireAnyAdmin).mockResolvedValue(resourceAdminPlayer);
    vi.mocked(createSeason).mockResolvedValue(created);
    vi.mocked(addResourceAdmin).mockResolvedValue({
      id: 'ra-1',
      player_id: 'radmin-1',
      resource_type: 'season',
      resource_id: 'season-new',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(addResourceAdmin)).toHaveBeenCalledWith('radmin-1', 'season', 'season-new');
  });

  it('never reaches the clone module without clone_from, and answers without a clone key', async () => {
    const created = { ...mockSeason, id: 'season-new' };
    vi.mocked(requireAnyAdmin).mockResolvedValue(resourceAdminPlayer);
    vi.mocked(createSeason).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual(created);
    expect(body.data).not.toHaveProperty('clone');
    expect(assertCloneAllowed).not.toHaveBeenCalled();
    expect(createCloneTracker).not.toHaveBeenCalled();
    expect(copyLeagueStructure).not.toHaveBeenCalled();
    expect(rollbackClonedLeague).not.toHaveBeenCalled();
  });

  it('passes a creation error through unchanged without clone_from (no rollback)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireAnyAdmin).mockResolvedValue(resourceAdminPlayer);
    vi.mocked(createSeason).mockResolvedValue({ ...mockSeason, id: 'season-new' });
    vi.mocked(addResourceAdmin).mockRejectedValue(new Error('grant failed'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    try {
      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(rollbackClonedLeague).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createSeason).mockRejectedValue(new Error('DB error'));

    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Failed to create league');
  });
});

describe('POST /api/seasons — EPB point-buy list auto-bind', () => {
  const activeVersion = {
    id: 'pblv-1',
  } as unknown as Awaited<ReturnType<typeof getActiveListVersion>>;

  const epbSeason = { ...mockSeason, format_type: 'evolution_point_buy' as const };

  const packRuleset = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Evolution Point Buy',
  } as unknown as Awaited<ReturnType<typeof ensurePointBuyBattleRuleset>>['ruleset'];

  function makeRequest() {
    return {
      json: vi.fn().mockResolvedValue({ name: 'Evo Liga', format_type: 'evolution_point_buy' }),
    } as unknown as NextRequest;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAnyAdmin).mockResolvedValue(adminPlayer);
    vi.mocked(createSeason).mockResolvedValue(epbSeason);
    vi.mocked(initializeEpbFormatRules).mockResolvedValue(undefined);
    vi.mocked(ensurePointBuyBattleRuleset).mockResolvedValue({ ruleset: packRuleset, created: false, bansCleared: false });
  });

  it('binds the active list version and logs an audit event (201)', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue(activeVersion);
    vi.mocked(bindSeasonToList).mockResolvedValue(undefined);

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(vi.mocked(bindSeasonToList)).toHaveBeenCalledWith('season-1', 'pblv-1');
    expect(vi.mocked(logAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.auto_bind_point_buy_list',
        actor_id: 'admin-1',
        resource_type: 'season',
        resource_id: 'season-1',
        metadata: { point_buy_list_id: 'pblv-1' },
      }),
    );
  });

  it('skips binding when no active list version exists (201, unbound)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(getActiveListVersion).mockResolvedValue(null);

    try {
      const response = await POST(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(vi.mocked(bindSeasonToList)).not.toHaveBeenCalled();
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('still returns 201 when the bind fails (best-effort)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getActiveListVersion).mockResolvedValue(activeVersion);
    vi.mocked(bindSeasonToList).mockRejectedValue(new Error('bind failed'));

    try {
      const response = await POST(makeRequest());
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(vi.mocked(logAuditEvent)).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('ensures the pack battle ruleset once and makes it the league default', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await POST(makeRequest());

      expect(response.status).toBe(201);
      expect(ensurePointBuyBattleRuleset).toHaveBeenCalledTimes(1);
      expect(ensurePointBuyBattleRuleset).toHaveBeenCalledWith('admin-1');
      expect(createSeason).toHaveBeenCalledWith({
        name: 'Evo Liga',
        format_type: 'evolution_point_buy',
        ruleset_id: packRuleset.id,
      });
      // Reused row: nothing to audit.
      expect(logAuditEvent).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('audits the ruleset when this league creation inserted it', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue(null);
    vi.mocked(ensurePointBuyBattleRuleset).mockResolvedValue({ ruleset: packRuleset, created: true, bansCleared: false });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await POST(makeRequest());

      expect(response.status).toBe(201);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.auto_create_battle_ruleset',
          actor_id: 'admin-1',
          resource_type: 'ruleset',
          resource_id: packRuleset.id,
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('audits a ban clear on the reused ruleset', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue(null);
    vi.mocked(ensurePointBuyBattleRuleset).mockResolvedValue({ ruleset: packRuleset, created: false, bansCleared: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const response = await POST(makeRequest());

      expect(response.status).toBe(201);
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'season.clear_battle_ruleset_bans',
          actor_id: 'admin-1',
          resource_type: 'ruleset',
          resource_id: packRuleset.id,
        }),
      );
      expect(logAuditEvent).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'season.auto_create_battle_ruleset' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps an explicit ruleset and ensures nothing', async () => {
    vi.mocked(getActiveListVersion).mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const explicit = '33333333-3333-4333-8333-333333333333';
    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Evo Liga', format_type: 'evolution_point_buy', ruleset_id: explicit }),
    } as unknown as NextRequest;

    try {
      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(ensurePointBuyBattleRuleset).not.toHaveBeenCalled();
      expect(createSeason).toHaveBeenCalledWith(expect.objectContaining({ ruleset_id: explicit }));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails the creation, writing no league, when the ruleset cannot be ensured', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(ensurePointBuyBattleRuleset).mockRejectedValue(new Error('insert failed'));

    try {
      const response = await POST(makeRequest());

      expect(response.status).toBe(500);
      expect(createSeason).not.toHaveBeenCalled();
      expect(initializeEpbFormatRules).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('never looks up the active list for non-EPB formats', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({ name: 'Season One', format_type: 'singles' }),
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(vi.mocked(getActiveListVersion)).not.toHaveBeenCalled();
    expect(vi.mocked(bindSeasonToList)).not.toHaveBeenCalled();
    expect(vi.mocked(ensurePointBuyBattleRuleset)).not.toHaveBeenCalled();
  });
});
