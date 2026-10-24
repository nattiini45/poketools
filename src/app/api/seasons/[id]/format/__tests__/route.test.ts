import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

vi.mock('@/lib/auth/helpers', () => ({
  requireResourceAdmin: vi.fn(),
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
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));
vi.mock('@/lib/format-studio/attach', () => ({
  attachFormatToSeason: vi.fn(),
  detachFormatFromSeason: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormat: vi.fn(),
  getSeasonFormatSummary: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import { attachFormatToSeason, detachFormatFromSeason, type AttachOutcome } from '@/lib/format-studio/attach';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { SeasonFormatSummary } from '@/lib/format-studio/library-types';
import { PRESETS } from '@/lib/format-kit';
import { getSeasonFormat, getSeasonFormatSummary, getSeasonStartSignals } from '@/lib/supabase/queries/season-formats';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { DELETE, GET, POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEFINITION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAGE_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const STAGE_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const STAGE_OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';

const admin: SessionPlayer = {
  playerId: '11111111-1111-4111-8111-111111111111',
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

const summary: SeasonFormatSummary = {
  season_id: SEASON_ID,
  definition_id: DEFINITION_ID,
  version_no: 2,
  spec_hash: 'a'.repeat(64),
  tunables: {},
  engine: 'kit',
  frozen_at: '2026-10-05T00:00:00.000Z',
  amendments: [],
};

const outcome = (overrides: Partial<AttachOutcome> = {}): AttachOutcome => ({
  replaced: false,
  season_format: summary,
  stages: [
    { id: STAGE_A, key: 'groups', bracket_type: 'round_robin', stage_order: 1 },
    { id: STAGE_B, key: 'knockout', bracket_type: 'single_elim', stage_order: 2 },
  ],
  warnings: [{ code: 'groups_not_created', stage: 'groups', params: { count: 4, method: 'serpentine' } }],
  definition: { id: DEFINITION_ID, slug: 'spring-cup' },
  version_no: 2,
  spec_hash: 'a'.repeat(64),
  touched_stage_ids: [STAGE_A, STAGE_B, STAGE_OLD],
  ...overrides,
});

const season = (overrides: Partial<Season> = {}): Season => ({ id: SEASON_ID, format_type: 'custom', status: 'upcoming', ...overrides }) as Season;

const params = (id: string = SEASON_ID) => ({ params: Promise.resolve({ id }) });
const get = (query = '') => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format${query}`);
const post = (body: unknown) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const del = () => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format`, { method: 'DELETE' });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(getSeasonById).mockResolvedValue(season());
  vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'upcoming', phases: [] });
  vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary);
});

describe.each([
  ['GET', () => GET(get(), params())],
  ['POST', () => POST(post({ definition_id: DEFINITION_ID }), params())],
  ['DELETE', () => DELETE(del(), params())],
] as const)('%s /api/seasons/[id]/format: access', (_method, call) => {
  it('answers 401 to an unauthenticated caller', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await call()).status).toBe(401);
    expect(attachFormatToSeason).not.toHaveBeenCalled();
    expect(detachFormatFromSeason).not.toHaveBeenCalled();
  });

  it('answers 403 to an admin of another league', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new AuthError('Admin access required for this resource', 403, 'forbidden'));
    const response = await call();
    expect(response.status).toBe(403);
    expect(attachFormatToSeason).not.toHaveBeenCalled();
    expect(detachFormatFromSeason).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed id', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValue(new UserFacingError('League not found', { status: 404, code: 'INVALID_SEASON_ID' }));
    const response = await call();
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_SEASON_ID');
    expect(attachFormatToSeason).not.toHaveBeenCalled();
  });

  it('checks the league scope with the season resource type and the id of the path', async () => {
    await call();
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
  });
});

describe('GET /api/seasons/[id]/format', () => {
  // The answer carries a `status` key of its own (the format state), which the player-PII scan also watches for.
  const allowStatus = { allowKeys: ['status'] };

  it('reports an attached format without spec or seed', async () => {
    const response = await GET(get(), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: 'attached', can_start: true, started: false, season_format: summary });
    expect(JSON.stringify(body)).not.toContain('"seed"');
    expect(getSeasonFormat).not.toHaveBeenCalled();
    expectNoPrivatePlayerData(body, allowStatus);
  });

  it('reports a custom league without a format: it cannot start', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    const body = await (await GET(get(), params())).json();
    expect(body.data).toEqual({ status: 'unattached', can_start: false, started: false, season_format: null });
  });

  it('reports a league of a legacy type as not custom, can_start true, and reads no format row', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    const body = await (await GET(get(), params())).json();
    expect(body.data).toEqual({ status: 'not_custom', can_start: true, started: false, season_format: null });
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
  });

  it('tells a started league', async () => {
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'upcoming', phases: [{ status: 'active', rounds_total: 0 }] });
    const body = await (await GET(get(), params())).json();
    expect(body.data.started).toBe(true);
  });

  it('adds the frozen spec on ?include=spec, never the seed', async () => {
    const spec = PRESETS[0].definition;
    vi.mocked(getSeasonFormat).mockResolvedValue({ ...summary, spec, seed: 'secret-seed-value' });
    const body = await (await GET(get('?include=spec'), params())).json();
    expect(body.data.spec.schema_version).toBe(1);
    expect(JSON.stringify(body)).not.toContain('secret-seed-value');
    expect(body.data.season_format).toEqual(summary);
  });

  it('does not read the spec for a league without a format', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    const body = await (await GET(get('?include=spec'), params())).json();
    expect(body.data).not.toHaveProperty('spec');
    expect(getSeasonFormat).not.toHaveBeenCalled();
  });

  it('answers 400 for an unknown include value and 404 for a league that does not exist', async () => {
    const bad = await GET(get('?include=seed'), params());
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe('validation_failed');
    vi.mocked(getSeasonById).mockResolvedValue(null);
    const missing = await GET(get(), params());
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe('season_not_found');
  });
});

describe('POST /api/seasons/[id]/format', () => {
  it('answers 201 for a first attach with the stages and the engine gaps, expires the stage ids and audits', async () => {
    vi.mocked(attachFormatToSeason).mockResolvedValue(outcome());
    const response = await POST(post({ definition_id: DEFINITION_ID, version_no: 2 }), params());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      season_format: summary,
      stages: outcome().stages,
      warnings: outcome().warnings,
    });
    expect(attachFormatToSeason).toHaveBeenCalledWith({ actor: admin, seasonId: SEASON_ID, definitionId: DEFINITION_ID, versionNo: 2 });
    expect(checkRateLimit).toHaveBeenCalledWith('format-attach', admin.playerId, { limit: 30, windowSeconds: 3600 });

    const expired = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(expired).toEqual(expect.arrayContaining([`season:${SEASON_ID}`, `tournament:${STAGE_A}`, `tournament:${STAGE_B}`, `tournament:${STAGE_OLD}`]));
    for (const [, profile] of vi.mocked(revalidateTag).mock.calls) expect(profile).toEqual({ expire: 0 });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'season.format.attach',
        actor_id: admin.playerId,
        resource_type: 'season',
        resource_id: SEASON_ID,
        metadata: expect.objectContaining({ definition_id: DEFINITION_ID, version_no: 2, spec_hash: 'a'.repeat(64), stage_count: 2 }),
      }),
    );
    expectNoPrivatePlayerData(body);
  });

  it('answers 200 when the attach replaced an earlier format', async () => {
    vi.mocked(attachFormatToSeason).mockResolvedValue(outcome({ replaced: true }));
    const response = await POST(post({ definition_id: DEFINITION_ID }), params());
    expect(response.status).toBe(200);
    expect(vi.mocked(attachFormatToSeason).mock.calls[0][0].versionNo).toBeUndefined();
  });

  it('does not put the seed or the spec in the answer', async () => {
    vi.mocked(attachFormatToSeason).mockResolvedValue(outcome());
    const text = JSON.stringify(await (await POST(post({ definition_id: DEFINITION_ID }), params())).json());
    expect(text).not.toContain('"seed"');
    expect(text).not.toContain('"spec"');
  });

  it.each([
    ['private definition of another owner', 'format_attach_forbidden', 403],
    ['league that is not custom', 'format_season_not_custom', 409],
    ['league that has started', 'format_season_started', 409],
    ['format without a published version', 'format_not_published', 409],
    ['version that does not compile', 'format_attach_invalid', 422],
    ['league with hand-made phases', 'format_attach_manual_phases', 409],
  ] as const)('passes the refusal for a %s through as %s', async (_label, code, status) => {
    vi.mocked(attachFormatToSeason).mockRejectedValue(new FormatStudioError(code, code === 'format_attach_invalid' ? { first: 'stage_cycle' } : code === 'format_attach_manual_phases' ? { count: 1 } : undefined));
    const response = await POST(post({ definition_id: DEFINITION_ID }), params());
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['no definition', {}],
    ['a definition id that is not a uuid', { definition_id: 'abc' }],
    ['version 0', { definition_id: DEFINITION_ID, version_no: 0 }],
    ['an unknown member', { definition_id: DEFINITION_ID, season_id: SEASON_ID }],
  ])('answers 400 validation_failed for %s', async (_label, body) => {
    const response = await POST(post(body), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('validation_failed');
    expect(attachFormatToSeason).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_json for an empty body', async () => {
    const response = await POST(post(''), params());
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('invalid_json');
    expect(attachFormatToSeason).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and attaches nothing when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 77 });
    const response = await POST(post({ definition_id: DEFINITION_ID }), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('77');
    expect(attachFormatToSeason).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/seasons/[id]/format', () => {
  it('detaches: 200 with the removed ids, expires them and audits', async () => {
    vi.mocked(detachFormatFromSeason).mockResolvedValue({ removed_stage_ids: [STAGE_A, STAGE_B] });
    const response = await DELETE(del(), params());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { removed_stage_ids: [STAGE_A, STAGE_B] } });
    expect(detachFormatFromSeason).toHaveBeenCalledWith(SEASON_ID);
    expect(checkRateLimit).toHaveBeenCalledWith('format-attach', admin.playerId, { limit: 30, windowSeconds: 3600 });
    const expired = vi.mocked(revalidateTag).mock.calls.map(([tag]) => tag);
    expect(expired).toEqual(expect.arrayContaining([`season:${SEASON_ID}`, `tournament:${STAGE_A}`, `tournament:${STAGE_B}`]));
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.format.detach', resource_type: 'season', resource_id: SEASON_ID }),
    );
  });

  it.each([
    ['format_nothing_attached', 404],
    ['format_season_started', 409],
    ['format_detach_blocked', 409],
  ] as const)('passes %s through as %i', async (code, status) => {
    vi.mocked(detachFormatFromSeason).mockRejectedValue(new FormatStudioError(code));
    const response = await DELETE(del(), params());
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(revalidateTag).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After and detaches nothing when the rate limit says no', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 3 });
    const response = await DELETE(del(), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(detachFormatFromSeason).not.toHaveBeenCalled();
  });
});
