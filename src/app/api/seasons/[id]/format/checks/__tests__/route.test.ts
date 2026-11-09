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
vi.mock('@/lib/format-engine/runtime/load', () => ({ loadFreshKitContext: vi.fn() }));
vi.mock('@/lib/format-engine/runtime/views-server', () => ({ loadChecksPage: vi.fn() }));

import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { loadFreshKitContext, type KitContext } from '@/lib/format-engine/runtime/load';
import { loadChecksPage } from '@/lib/format-engine/runtime/views-server';
import type { ChecksPage } from '@/lib/format-engine/runtime/view-types';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { GET } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const admin: SessionPlayer = {
  playerId: ADMIN_ID,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};

const CTX = { seasonId: SEASON_ID } as KitContext;
const PAGE: ChecksPage = {
  checks: [
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
      source: 'team_audit',
      rule_id: 'team_rules',
      rule_label: null,
      subject: { codes: ['kit_count_max'], round: 2 },
      state: 'open',
      note: null,
      opened_at: '2026-11-05T10:00:00.000Z',
      resolved_at: null,
      resolved_by: null,
    },
  ],
  total: 1,
};

const params = { params: Promise.resolve({ id: SEASON_ID.toUpperCase() }) };
const get = (query = '') => new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/checks${query}`);
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(loadFreshKitContext).mockResolvedValue(CTX);
  vi.mocked(loadChecksPage).mockResolvedValue(PAGE);
});

describe('GET /api/seasons/[id]/format/checks', () => {
  it('answers 401 and 403 before reading anything: a non-admin gets no subject', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await GET(get(), params)).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    const forbidden = await GET(get(), params);
    expect(forbidden.status).toBe(403);
    expect(JSON.stringify(await forbidden.json())).not.toContain('kit_count_max');
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID.toUpperCase());
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(loadChecksPage).not.toHaveBeenCalled();
  });

  it('tells the loader whether the reader is a site admin: a league admin is not, so the planned team stays hidden', async () => {
    await GET(get(), params);
    expect(vi.mocked(loadChecksPage).mock.calls[0][5]).toBe(false);
    vi.mocked(requireResourceAdmin).mockResolvedValueOnce({ ...admin, isAdmin: true });
    await GET(get(), params);
    expect(vi.mocked(loadChecksPage).mock.calls[1][5]).toBe(true);
  });

  it('lists the open checks of the normalised league by default and is never cached', async () => {
    const response = await GET(get(), params);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(loadFreshKitContext).toHaveBeenCalledWith(SEASON_ID);
    expect(loadChecksPage).toHaveBeenCalledWith(SEASON_ID, CTX, 'open', { limit: 50, offset: 0 }, ADMIN_ID, false);
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual(PAGE);
    // The members are `state`, never `status` (a private player column name).
    expect(text).not.toContain('"status"');
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('applies the status filter, the limit and the offset, and works without a kit format', async () => {
    vi.mocked(loadFreshKitContext).mockResolvedValue(null);
    await GET(get('?status=rejected&limit=10&offset=30'), params);
    expect(loadChecksPage).toHaveBeenCalledWith(SEASON_ID, null, 'rejected', { limit: 10, offset: 30 }, ADMIN_ID, false);
    await GET(get('?status=all'), params);
    expect(loadChecksPage).toHaveBeenLastCalledWith(SEASON_ID, null, 'all', { limit: 50, offset: 0 }, ADMIN_ID, false);
  });

  it('rejects an unknown status and out-of-range paging with 400', async () => {
    for (const query of ['?status=pending', '?status=OPEN', '?limit=0', '?limit=101', '?offset=-5', '?offset=x']) {
      const response = await GET(get(query), params);
      expect(response.status, query).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(loadChecksPage).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After before loading anything', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 12 });
    const response = await GET(get(), params);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(checkRateLimit).toHaveBeenCalledWith('format-runtime-admin-read', ADMIN_ID, expect.objectContaining({ limit: 60, windowSeconds: 60 }));
    expect(loadChecksPage).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(loadChecksPage).mockRejectedValueOnce(new Error('relation "format_checks" is locked'));
    const response = await GET(get(), params);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to load the checks');
    expect(JSON.stringify(body)).not.toContain('locked');
  });
});
