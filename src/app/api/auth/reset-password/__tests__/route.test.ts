import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { verifyOtp, updateUserById } = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  updateUserById: vi.fn(),
}));

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { verifyOtp } }),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { admin: { updateUserById } } },
}));

import { POST } from '@/app/api/auth/reset-password/route';

function makeRequest(body: Record<string, unknown>): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/auth/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 on short password', async () => {
    const res = await POST(makeRequest({ token_hash: 'hash', password: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('returns 400 when the recovery token is invalid', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { code: 'otp_expired', message: 'expired' },
    });

    const res = await POST(makeRequest({ token_hash: 'stale', password: 'newpassword1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('reset_link_invalid');
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('verifies the recovery token and updates the password for the right user', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-7' } }, error: null });
    updateUserById.mockResolvedValue({ data: {}, error: null });

    const res = await POST(makeRequest({ token_hash: 'hash-123', password: 'newpassword1' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash-123' });
    expect(updateUserById).toHaveBeenCalledWith('auth-7', { password: 'newpassword1' });
  });

  it('answers a failed password update with the password_reset_failed fallback code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    verifyOtp.mockResolvedValue({ data: { user: { id: 'auth-7' } }, error: null });
    updateUserById.mockResolvedValue({ data: {}, error: new Error('weak password detail') });

    const res = await POST(makeRequest({ token_hash: 'hash-123', password: 'newpassword1' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: 'Password reset failed', code: 'password_reset_failed' });
  });
});
