import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/api/error-response', () => ({
  safeErrorResponse: vi.fn((_err: unknown, fallback: string) => NextResponse.json({ success: false, error: fallback }, { status: 500 })),
}));

vi.mock('@/lib/supabase/queries/players', () => ({
  clearExpiredSuspensions: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock('@/lib/utils/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/crypto')>();
  return {
    ...actual,
    secretsEqual: vi.fn(actual.secretsEqual),
    timingSafeCompare: vi.fn(actual.timingSafeCompare),
  };
});

import { GET, POST } from '@/app/api/cron/expire-suspensions/route';
import { clearExpiredSuspensions } from '@/lib/supabase/queries/players';
import { logAuditEvent } from '@/lib/audit/log';
import { safeErrorResponse } from '@/lib/api/error-response';
import { secretsEqual, timingSafeCompare } from '@/lib/utils/crypto';

const originalCronSecret = process.env.CRON_SECRET;

function request(secret = 'secret', method = 'POST') {
  return new Request('http://localhost/api/cron/expire-suspensions', {
    method,
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('/api/cron/expire-suspensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secret';
    vi.mocked(clearExpiredSuspensions).mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it('returns cron_not_configured and logs when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.code).toBe('cron_not_configured');
    expect(errorSpy).toHaveBeenCalledWith('[cron/expire-suspensions] CRON_SECRET not configured');
    expect(clearExpiredSuspensions).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('rejects a wrong secret', async () => {
    const res = await POST(request('wrong'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.code).toBe('cron_unauthorized');
    expect(clearExpiredSuspensions).not.toHaveBeenCalled();
  });

  it('rejects a token of a different length than the secret', async () => {
    const res = await POST(request('a-much-longer-token-than-the-configured-secret'));

    expect(res.status).toBe(401);
    expect(clearExpiredSuspensions).not.toHaveBeenCalled();
  });

  it('compares the token with the length-independent secretsEqual', async () => {
    await POST(request('secret'));

    expect(secretsEqual).toHaveBeenCalledWith('secret', 'secret');
    expect(timingSafeCompare).not.toHaveBeenCalled();
  });

  it('rejects a missing Authorization header', async () => {
    const res = await POST(new Request('http://localhost/api/cron/expire-suspensions', { method: 'POST' }));

    expect(res.status).toBe(401);
    expect(clearExpiredSuspensions).not.toHaveBeenCalled();
  });

  it('lifts expired suspensions as of now and writes one system audit event each', async () => {
    vi.mocked(clearExpiredSuspensions).mockResolvedValue([
      { id: 'player-1', name: 'Ash' },
      { id: 'player-2', name: 'Misty' },
    ]);
    const before = Date.now();

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, data: { lifted: 2 } });
    const nowIso = vi.mocked(clearExpiredSuspensions).mock.calls[0][0];
    expect(new Date(nowIso).getTime()).toBeGreaterThanOrEqual(before);
    expect(logAuditEvent).toHaveBeenCalledTimes(2);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: null,
      actor_name: 'System',
      action: 'player.suspension_expired',
      resource_type: 'player',
      resource_id: 'player-1',
      resource_name: 'Ash',
    });
  });

  it('reports zero and writes no audit events when nothing expired', async () => {
    const res = await POST(request());
    const body = await res.json();

    expect(body).toEqual({ success: true, data: { lifted: 0 } });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('serves the Vercel Cron GET invocation', async () => {
    const res = await GET(request('secret', 'GET'));

    expect(res.status).toBe(200);
    expect(clearExpiredSuspensions).toHaveBeenCalledTimes(1);
  });

  it('returns a safe error when the query fails', async () => {
    const failure = new Error('db down');
    vi.mocked(clearExpiredSuspensions).mockRejectedValue(failure);

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(safeErrorResponse).toHaveBeenCalledWith(failure, 'Failed to expire suspensions');
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
