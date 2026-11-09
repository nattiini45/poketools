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
vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-engine', () => ({ getKitPhases: vi.fn() }));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  getSeasonFormatSummary: vi.fn(),
  setSeasonFormatEngine: vi.fn(),
}));

import { revalidateTag } from 'next/cache';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import { FormatStudioError } from '@/lib/format-studio/errors';
import type { SeasonFormatSummary } from '@/lib/format-studio/library-types';
import { getKitPhases } from '@/lib/supabase/queries/format-engine';
import { getSeasonFormatSummary, setSeasonFormatEngine } from '@/lib/supabase/queries/season-formats';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { PUT } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PHASE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';

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

const summary = (engine: SeasonFormatSummary['engine']): SeasonFormatSummary => ({
  season_id: SEASON_ID,
  definition_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  version_no: 1,
  spec_hash: 'a'.repeat(64),
  tunables: {},
  engine,
  frozen_at: '2026-10-05T00:00:00.000Z',
  amendments: [],
});

const season = (overrides: Partial<Season> = {}): Season =>
  ({ id: SEASON_ID, format_type: 'custom', status: 'active', ...overrides }) as Season;
const params = { params: Promise.resolve({ id: SEASON_ID }) };
const put = (body: unknown) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/engine`, { method: 'PUT', body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  vi.mocked(getSeasonById).mockResolvedValue(season());
  vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary('legacy'));
  vi.mocked(setSeasonFormatEngine).mockImplementation(async (_id, _from, engine) => summary(engine));
  vi.mocked(getKitPhases).mockResolvedValue([{ id: PHASE_ID, format_stage_key: 'league', stage_order: 1, stage_spec: null }]);
});

describe('PUT /api/seasons/[id]/format/engine', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await PUT(put({ engine: 'kit' }), params)).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await PUT(put({ engine: 'kit' }), params)).status).toBe(403);
    expect(setSeasonFormatEngine).not.toHaveBeenCalled();
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID);
  });

  it('switches the engine, expires the league reads and records who did it', async () => {
    const response = await PUT(put({ engine: 'shadow' }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data.season_format.engine).toBe('shadow');
    expect(setSeasonFormatEngine).toHaveBeenCalledWith(SEASON_ID, 'legacy', 'shadow');
    expect(revalidateTag).toHaveBeenCalled();
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'season.format.engine', metadata: { from: 'legacy', to: 'shadow' } }),
    );
  });

  it.each([
    ['legacy', 'shadow'],
    ['legacy', 'kit'],
    ['shadow', 'legacy'],
    ['shadow', 'kit'],
    ['kit', 'legacy'],
    ['kit', 'shadow'],
  ] as const)('accepts the switch %s -> %s', async (from, to) => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary(from));
    const response = await PUT(put({ engine: to }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).data.season_format.engine).toBe(to);
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: { from, to } }));
  });

  it('writes nothing when the engine is already the one asked for', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary('kit'));
    const response = await PUT(put({ engine: 'kit' }), params);
    expect(response.status).toBe(200);
    expect(setSeasonFormatEngine).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('expires the league reads even when the phase read after the commit fails, and again on the retry', async () => {
    vi.mocked(getKitPhases).mockRejectedValue(new Error('boom'));
    const switched = await PUT(put({ engine: 'kit' }), params);
    expect(switched.status).toBe(200);
    expect(vi.mocked(revalidateTag).mock.calls.length).toBeGreaterThan(0);

    vi.mocked(revalidateTag).mockClear();
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary('kit'));
    await PUT(put({ engine: 'kit' }), params);
    expect(setSeasonFormatEngine).toHaveBeenCalledTimes(1);
    expect(vi.mocked(revalidateTag).mock.calls.length).toBeGreaterThan(0);
  });

  it('answers 409 format_engine_changed when another admin switched the engine in between, and still expires the reads', async () => {
    vi.mocked(setSeasonFormatEngine).mockRejectedValueOnce(new FormatStudioError('format_engine_changed'));
    const response = await PUT(put({ engine: 'kit' }), params);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('format_engine_changed');
    expect(vi.mocked(revalidateTag).mock.calls.length).toBeGreaterThan(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('expires the league reads when the engine write itself throws', async () => {
    vi.mocked(setSeasonFormatEngine).mockRejectedValueOnce(new Error('timeout'));
    expect((await PUT(put({ engine: 'kit' }), params)).status).toBe(500);
    expect(vi.mocked(revalidateTag).mock.calls.length).toBeGreaterThan(0);
  });

  it('rejects an unknown engine and extra keys', async () => {
    expect((await PUT(put({ engine: 'turbo' }), params)).status).toBe(400);
    expect((await PUT(put({ engine: 'kit', seed: 'x' }), params)).status).toBe(400);
    expect(setSeasonFormatEngine).not.toHaveBeenCalled();
  });

  it('answers 404 format_nothing_attached for a league without a format or of another type', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    const none = await PUT(put({ engine: 'kit' }), params);
    expect(none.status).toBe(404);
    expect((await none.json()).code).toBe('format_nothing_attached');

    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    const other = await PUT(put({ engine: 'kit' }), params);
    expect(other.status).toBe(404);
    expect((await other.json()).code).toBe('format_nothing_attached');
    expect(setSeasonFormatEngine).not.toHaveBeenCalled();
  });

  it('answers 404 season_not_found for a missing league', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    const response = await PUT(put({ engine: 'kit' }), params);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('season_not_found');
  });
});
