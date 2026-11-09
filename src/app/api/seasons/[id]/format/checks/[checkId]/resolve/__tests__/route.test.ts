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
vi.mock('@/lib/format-engine/runtime/checks-server', () => ({ resolveCheck: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-runtime-reads', () => ({ getFormatCheck: vi.fn() }));

import { logAuditEvent } from '@/lib/audit/log';
import { AuthError, requireResourceAdmin } from '@/lib/auth/helpers';
import { resolveCheck } from '@/lib/format-engine/runtime/checks-server';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { getFormatCheck } from '@/lib/supabase/queries/format-runtime-reads';
import { checkRateLimit } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import { POST } from '../route';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const CHECK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';

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

const check = (over: Record<string, unknown> = {}) =>
  ({
    id: CHECK_ID,
    season_id: SEASON_ID,
    dedupe_key: 'team_audit:m1:0:p1',
    source: 'team_audit',
    rule_id: 'team_rules',
    subject: { codes: ['kit_count_max'] },
    status: 'open',
    note: null,
    opened_at: '2026-11-05T10:00:00.000Z',
    resolved_at: null,
    resolved_by: null,
    ...over,
  }) as never;

const params = (checkId = CHECK_ID) => ({ params: Promise.resolve({ id: SEASON_ID.toUpperCase(), checkId }) });
const post = (body: unknown, raw?: string) =>
  new NextRequest(`http://localhost/api/seasons/${SEASON_ID}/format/checks/${CHECK_ID}/resolve`, {
    method: 'POST',
    body: raw ?? JSON.stringify(body),
  });
const ALLOWED = { allowed: true, remaining: 10, retryAfterSeconds: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireResourceAdmin).mockResolvedValue(admin);
  vi.mocked(checkRateLimit).mockResolvedValue(ALLOWED);
  vi.mocked(getFormatCheck).mockResolvedValue(check());
  vi.mocked(resolveCheck).mockResolvedValue(true);
});

describe('POST /api/seasons/[id]/format/checks/[checkId]/resolve', () => {
  it('answers 401 and 403 before reading anything', async () => {
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Not authenticated', 401, 'unauthenticated'));
    expect((await POST(post({ verdict: 'confirmed' }), params())).status).toBe(401);
    vi.mocked(requireResourceAdmin).mockRejectedValueOnce(new AuthError('Admin access required', 403, 'forbidden'));
    expect((await POST(post({ verdict: 'confirmed' }), params())).status).toBe(403);
    expect(requireResourceAdmin).toHaveBeenCalledWith('season', SEASON_ID.toUpperCase());
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getFormatCheck).not.toHaveBeenCalled();
    expect(resolveCheck).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_CHECK_ID for a malformed id, before the limiter and any read', async () => {
    const response = await POST(post({ verdict: 'confirmed' }), params('nope'));
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('INVALID_CHECK_ID');
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getFormatCheck).not.toHaveBeenCalled();
  });

  it('confirms an open check of this league and answers state, not status', async () => {
    const response = await POST(post({ verdict: 'confirmed', note: 'Seen the replay' }), params(CHECK_ID.toUpperCase()));
    expect(response.status).toBe(200);
    expect(getFormatCheck).toHaveBeenCalledWith(SEASON_ID, CHECK_ID);
    expect(resolveCheck).toHaveBeenCalledWith({ seasonId: SEASON_ID, checkId: CHECK_ID, status: 'confirmed', adminId: ADMIN_ID, note: 'Seen the replay' });
    const text = await response.text();
    expect(JSON.parse(text).data).toEqual({ check_id: CHECK_ID, state: 'confirmed' });
    expect(text).not.toContain('"status"');
    expectNoPrivatePlayerData(JSON.parse(text));
  });

  it('rejects a check, and stores a blank or missing note as null', async () => {
    const rejected = await POST(post({ verdict: 'rejected', note: '   ' }), params());
    expect((await rejected.json()).data.state).toBe('rejected');
    expect(resolveCheck).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'rejected', note: null }));
    await POST(post({ verdict: 'rejected' }), params());
    expect(resolveCheck).toHaveBeenLastCalledWith(expect.objectContaining({ note: null }));
  });

  it('audits the resolution with the source and rule of the check, never the subject or the note', async () => {
    await POST(post({ verdict: 'confirmed', note: 'secret note text' }), params());
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'season.format.check.resolve',
      actor_id: ADMIN_ID,
      actor_name: 'League Admin',
      resource_type: 'season',
      resource_id: SEASON_ID,
      metadata: { check_id: CHECK_ID, verdict: 'confirmed', source: 'team_audit', rule_id: 'team_rules' },
    });
    expect(JSON.stringify(entry)).not.toContain('kit_count_max');
    expect(JSON.stringify(entry)).not.toContain('secret note text');
  });

  it('answers 404 format_check_not_found for an unknown check or one of another league (the read is season-scoped)', async () => {
    vi.mocked(getFormatCheck).mockResolvedValueOnce(null);
    const response = await POST(post({ verdict: 'confirmed' }), params());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('format_check_not_found');
    expect(resolveCheck).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 409 format_check_not_open for a resolved check and for a lost race', async () => {
    vi.mocked(getFormatCheck).mockResolvedValueOnce(check({ status: 'confirmed' }));
    const resolved = await POST(post({ verdict: 'rejected' }), params());
    expect(resolved.status).toBe(409);
    expect((await resolved.json()).code).toBe('format_check_not_open');
    expect(resolveCheck).not.toHaveBeenCalled();

    vi.mocked(resolveCheck).mockResolvedValueOnce(false);
    const raced = await POST(post({ verdict: 'rejected' }), params());
    expect(raced.status).toBe(409);
    expect((await raced.json()).code).toBe('format_check_not_open');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects a malformed body with 400 (verdict, not status) and resolves nothing', async () => {
    for (const bad of [{}, { verdict: 'open' }, { status: 'confirmed' }, { verdict: 'confirmed', note: 'x'.repeat(501) }, { verdict: 'confirmed', extra: 1 }]) {
      const response = await POST(post(bad), params());
      expect(response.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
      expect((await response.json()).code).toBe('validation_failed');
    }
    expect(resolveCheck).not.toHaveBeenCalled();
  });

  it('answers 413 for a body over 8 KiB', async () => {
    const response = await POST(post({ verdict: 'confirmed', padding: 'x'.repeat(9 * 1024) }), params());
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe('format_request_too_large');
  });

  it('answers 429 with Retry-After and resolves nothing', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 45 });
    const response = await POST(post({ verdict: 'confirmed' }), params());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('45');
    expect(checkRateLimit).toHaveBeenCalledWith('format-check-resolve', ADMIN_ID, expect.objectContaining({ limit: 120, windowSeconds: 3600 }));
    expect(getFormatCheck).not.toHaveBeenCalled();
    expect(resolveCheck).not.toHaveBeenCalled();
  });

  it('hides an unexpected failure behind the static message', async () => {
    vi.mocked(resolveCheck).mockRejectedValueOnce(new Error('permission denied for function format_check_resolve'));
    const response = await POST(post({ verdict: 'confirmed' }), params());
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Failed to resolve the check');
    expect(JSON.stringify(body)).not.toContain('permission');
  });
});
