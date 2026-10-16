import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const resetPasswordForEmail = vi.fn();

vi.mock('@/lib/supabase/auth-client', () => ({
  createAuthClient: () => ({ auth: { resetPasswordForEmail } }),
}));

import { POST } from '@/app/api/auth/forgot-password/route';

function makeRequest(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe('POST /api/auth/forgot-password', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('answers an invalid email with validation_failed and the issues as its param', async () => {
    const res = await POST(makeRequest({ email: 'not-an-email' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('returns the generic success even when GoTrue fails (no enumeration)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetPasswordForEmail.mockResolvedValue({ error: { code: 'user_not_found', message: 'nope' } });

    const res = await POST(makeRequest({ email: 'ash@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('answers an unexpected failure with the password_reset_email_failed fallback code', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetPasswordForEmail.mockRejectedValue(new Error('network down'));

    const res = await POST(makeRequest({ email: 'ash@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      error: 'Failed to send password reset email',
      code: 'password_reset_email_failed',
    });
  });
});
