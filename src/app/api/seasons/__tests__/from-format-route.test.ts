import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

// The new-competition wizard path of POST /api/seasons (`from_format`). The wizard library has its own suites
// (src/lib/format-studio/__tests__/create-league.test.ts, and create-league.local.test.ts on the local stack); here it is
// mocked, so these tests pin the route: guard, rate limits, validation, cache expiry, audit and the error passthrough.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/auth/helpers', () => ({
  requireAnyAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));
vi.mock('@/lib/utils/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/rate-limit')>()),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/ruleset-studio/pin-change', () => ({
  assertRulesetChangeAllowed: vi.fn(),
  assertRulesetUsableForCreate: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({
  listSeasons: vi.fn(),
  listArchivedSeasons: vi.fn(),
  listSeasonsByIds: vi.fn(),
  createSeason: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ addResourceAdmin: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/create-league', () => ({ createLeagueFromFormat: vi.fn() }));

import { revalidatePath, revalidateTag } from 'next/cache';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { assertRulesetUsableForCreate } from '@/lib/ruleset-studio/pin-change';
import { createSeason } from '@/lib/supabase/queries/seasons';
import { addResourceAdmin } from '@/lib/supabase/queries/resource-admins';
import { logAuditEvent } from '@/lib/audit/log';
import { createLeagueFromFormat, type CreatedLeague } from '@/lib/format-studio/create-league';
import { FormatStudioError } from '@/lib/format-studio/errors';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { POST } from '../route';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const SEASON = '22222222-2222-4222-8222-222222222222';
const DEFINITION = '33333333-3333-4333-8333-333333333333';
const STAGE = '44444444-4444-4444-8444-444444444444';
const RULESET = '55555555-5555-4555-8555-555555555555';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ADMIN,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

const season: Season = {
  id: SEASON,
  name: 'Winter Wichtelcup',
  description: '',
  format_type: 'custom',
  status: 'upcoming',
  archived: false,
  legacy: false,
  is_test_season: false,
  start_date: null,
  end_date: null,
  ruleset_id: null,
  core_pool: null,
  point_buy_list_id: null,
  route_theme: 'auto',
  language: 'de',
  created_at: '2026-11-09T00:00:00.000Z',
  updated_at: '2026-11-09T00:00:00.000Z',
} as Season;

const created = (overrides: Partial<CreatedLeague> = {}): CreatedLeague => ({
  season,
  season_id: SEASON,
  format: { definition_id: DEFINITION, version_no: 1 },
  preset_id: 'wichtelcup',
  stages: [{ id: STAGE, key: 'cup', bracket_type: 'swiss', stage_order: 1 }],
  warnings: [],
  stage_ids: [STAGE],
  ruleset_ids: [RULESET],
  ...overrides,
});

const request = (body: unknown) => ({ json: vi.fn().mockResolvedValue(body) }) as unknown as NextRequest;

const fromPreset = { name: 'Winter Wichtelcup', format_type: 'custom', from_format: { preset_id: 'wichtelcup' } };
const fromVersion = { name: 'Winter Wichtelcup', format_type: 'custom', from_format: { definition_id: DEFINITION, version_no: 2 } };

const allowed = { allowed: true, remaining: 19, retryAfterSeconds: 0 };
const limited = { allowed: false, remaining: 0, retryAfterSeconds: 120 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(player());
  vi.mocked(checkRateLimit).mockResolvedValue(allowed);
  vi.mocked(assertRulesetUsableForCreate).mockResolvedValue(undefined);
  vi.mocked(createLeagueFromFormat).mockResolvedValue(created());
});

describe('POST /api/seasons with from_format: guard and rate limits', () => {
  it.each([
    [401, 'Authentication required'],
    [403, 'Admin access required'],
  ])('answers %i from the guard and writes nothing', async (status, message) => {
    vi.mocked(requireAnyAdmin).mockRejectedValue(new (AuthError as unknown as new (m: string, s: number) => Error)(message, status));
    const response = await POST(request(fromPreset));
    expect(response.status).toBe(status);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
  });

  it('counts every league creation in the season-create bucket, 20 per hour per admin', async () => {
    await POST(request(fromVersion));
    expect(checkRateLimit).toHaveBeenCalledWith('season-create', ADMIN, { limit: 20, windowSeconds: 3600 });
  });

  it.each([
    ['from an example', fromPreset],
    ['from a stored format', fromVersion],
    ['without a format', { name: 'Plain', format_type: 'singles' }],
  ])('answers 429 over the season-create limit %s and writes nothing', async (_label, body) => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(limited);
    const response = await POST(request(body));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('120');
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
    expect(createSeason).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('also counts an example in the format-create bucket (it forks a format) and answers 429 over it', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(allowed).mockResolvedValueOnce(limited);
    const response = await POST(request(fromPreset));
    expect(response.status).toBe(429);
    expect(checkRateLimit).toHaveBeenLastCalledWith('format-create', ADMIN, { limit: 20, windowSeconds: 3600 });
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
  });

  it('does not count a stored format in the format-create bucket', async () => {
    await POST(request(fromVersion));
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/seasons with from_format: validation', () => {
  it.each([
    ['an unknown example', { ...fromPreset, from_format: { preset_id: 'no-such-example' } }, 'from_format'],
    ['an unknown rule preset', { ...fromPreset, from_format: { preset_id: 'wichtelcup', ruleset_preset_id: 'gen0nothing' } }, 'from_format'],
    ['a malformed definition id', { ...fromVersion, from_format: { definition_id: 'abc' } }, 'from_format'],
    ['version 0', { ...fromVersion, from_format: { definition_id: DEFINITION, version_no: 0 } }, 'from_format'],
    ['a fractional version', { ...fromVersion, from_format: { definition_id: DEFINITION, version_no: 1.5 } }, 'from_format'],
    ['both sources at once', { ...fromVersion, from_format: { definition_id: DEFINITION, preset_id: 'wichtelcup' } }, 'from_format'],
    ['an unknown key', { ...fromPreset, from_format: { preset_id: 'wichtelcup', extra: true } }, 'from_format'],
    ['a legacy format type', { ...fromPreset, format_type: 'singles' }, 'format_type'],
    ['a clone block beside it', { ...fromPreset, clone_from: { season_id: SEASON } }, 'from_format'],
    ['a missing name', { format_type: 'custom', from_format: { preset_id: 'wichtelcup' } }, 'name'],
  ])('answers 400 validation_failed for %s and writes nothing', async (_label, body, path) => {
    const response = await POST(request(body));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.code).toBe('validation_failed');
    expect(json.error).toContain(path);
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
    expect(createSeason).not.toHaveBeenCalled();
  });

  it('answers 400 for an end date before the start date', async () => {
    const response = await POST(request({ ...fromPreset, start_date: '2026-12-01', end_date: '2026-11-01' }));
    expect(response.status).toBe(400);
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
  });

  it('refuses a default ruleset the admin may not use before any write', async () => {
    vi.mocked(assertRulesetUsableForCreate).mockRejectedValue(new RulesetStudioError('ruleset_not_found'));
    const response = await POST(request({ ...fromVersion, ruleset_id: RULESET }));
    expect(response.status).toBe(404);
    expect(assertRulesetUsableForCreate).toHaveBeenCalledWith(player(), RULESET);
    expect(createLeagueFromFormat).not.toHaveBeenCalled();
  });
});

describe('POST /api/seasons with from_format: success', () => {
  it('creates a league from an example in one call and answers 201 with the league, format and stages', async () => {
    const response = await POST(request({ ...fromPreset, from_format: { preset_id: 'wichtelcup', ruleset_preset_id: 'gen9ou' }, language: 'en' }));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createLeagueFromFormat).toHaveBeenCalledWith({
      actor: player(),
      season: { name: 'Winter Wichtelcup', format_type: 'custom', language: 'en' },
      fromFormat: { preset_id: 'wichtelcup', ruleset_preset_id: 'gen9ou' },
    });
    expect(json).toEqual({
      success: true,
      data: {
        season,
        format: { definition_id: DEFINITION, version_no: 1 },
        stages: [{ id: STAGE, key: 'cup', bracket_type: 'swiss', stage_order: 1 }],
        warnings: [],
      },
    });
    // `status` is the league's own status; no player row is serialized.
    expectNoPrivatePlayerData(json, { allowKeys: ['status'] });
    // No second write path runs: the plain create and the creator grant happen inside the one transaction.
    expect(createSeason).not.toHaveBeenCalled();
    expect(addResourceAdmin).not.toHaveBeenCalled();
  });

  it('expires the league list, the new league and its stages, the format library and the ruleset list', async () => {
    await POST(request(fromPreset));
    expect(revalidateTag).toHaveBeenCalledWith('seasons', { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`season:${SEASON}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith(`tournament:${STAGE}`, { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/rulesets');
  });

  it('logs one audit event with the definition, version, example and stage count', async () => {
    await POST(request(fromPreset));
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: ADMIN,
      actor_name: 'League Admin',
      action: 'season.create_from_format',
      resource_type: 'season',
      resource_id: SEASON,
      resource_name: 'Winter Wichtelcup',
      metadata: { definition_id: DEFINITION, version_no: 1, preset_id: 'wichtelcup', stage_count: 1 },
    });
  });

  it('attaches a stored version without touching the format library or the ruleset list when it creates no ruleset', async () => {
    vi.mocked(createLeagueFromFormat).mockResolvedValue(created({ preset_id: null, ruleset_ids: [], format: { definition_id: DEFINITION, version_no: 2 } }));
    const response = await POST(request({ ...fromVersion, ruleset_id: RULESET }));
    expect(response.status).toBe(201);
    expect(createLeagueFromFormat).toHaveBeenCalledWith({
      actor: player(),
      season: { name: 'Winter Wichtelcup', format_type: 'custom', ruleset_id: RULESET },
      fromFormat: { definition_id: DEFINITION, version_no: 2 },
    });
    expect(revalidateTag).not.toHaveBeenCalledWith('format-library', { expire: 0 });
    expect(revalidatePath).not.toHaveBeenCalledWith('/admin/rulesets');
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      definition_id: DEFINITION,
      version_no: 2,
      preset_id: null,
      stage_count: 1,
    });
  });
});

describe('POST /api/seasons with from_format: errors', () => {
  it.each([
    [new FormatStudioError('format_preset_not_found'), 404],
    [new FormatStudioError('format_not_found'), 404],
    [new FormatStudioError('format_attach_forbidden'), 403],
    [new FormatStudioError('format_attach_ruleset_forbidden'), 403],
    [new FormatStudioError('format_not_published'), 409],
    [new FormatStudioError('format_attach_invalid', { first: 'stage_cycle' }), 422],
    [new FormatStudioError('format_attach_ruleset_required', { count: 2 }), 409],
    [new FormatStudioError('format_slug_taken'), 409],
    [new UserFacingError('The league could not be created from this format. Nothing was created. Try again.', { code: 'season_format_create_failed', status: 500 }), 500],
  ])('passes %s through with its code and status, and expires and logs nothing', async (error, status) => {
    vi.mocked(createLeagueFromFormat).mockRejectedValue(error);
    const response = await POST(request(fromPreset));
    const json = await response.json();
    expect(response.status).toBe(status);
    expect(json.code).toBe(error.code);
    expect(json.error).toBe(error.message);
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers a generic 500 for an unexpected failure without leaking its message', async () => {
    vi.mocked(createLeagueFromFormat).mockRejectedValue(new Error('connection reset by peer at 10.0.0.1'));
    const response = await POST(request(fromPreset));
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBe('Failed to create league');
    expect(JSON.stringify(json)).not.toContain('10.0.0.1');
  });
});
