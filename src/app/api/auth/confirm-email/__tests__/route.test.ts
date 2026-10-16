import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { verifyOtp } }),
}));

import { POST } from '@/app/api/auth/confirm-email/route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/auth/confirm-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when token_hash is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('confirms the email with verifyOtp type email', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-1' } }, error: null });

    const res = await POST(makeRequest({ token_hash: 'hash-123' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'hash-123' });
  });

  it('returns 400 on an invalid or expired token', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: 'otp_expired', message: 'expired' },
    });

    const res = await POST(makeRequest({ token_hash: 'stale' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('invalid or has expired');
    expect(body.code).toBe('confirm_link_invalid');
  });
});
