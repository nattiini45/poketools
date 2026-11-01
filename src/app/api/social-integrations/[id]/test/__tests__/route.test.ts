import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth/helpers', () => ({
  requireAdmin: vi.fn(),
  AuthError: class AuthError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('@/lib/supabase/queries/social-integrations', () => ({
  getSocialIntegrationByIdWithSecrets: vi.fn(),
}));

vi.mock('@/lib/social/notify', () => ({
  sendSocialTestMessage: vi.fn(),
}));

import { POST } from '../route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { getSocialIntegrationByIdWithSecrets } from '@/lib/supabase/queries/social-integrations';
import { sendSocialTestMessage } from '@/lib/social/notify';
import { makeParams } from '@/lib/__tests__/helpers/api-request';
import { BlueskyServiceUrlError } from '@/lib/social/bluesky-service';
import enErrors from '@/i18n/messages/errors/broadcast/en';
import deErrors from '@/i18n/messages/errors/broadcast/de';

// ── Helpers ────────────────────────────────────────────────────────────

function makeEmptyRequest(cookie?: string): Request {
  return new Request('http://localhost/api/social-integrations/int-1/test', {
    method: 'POST',
    headers: cookie ? { cookie } : undefined,
  });
}

// ── Test data ─────────────────────────────────────────────────────────

const mockIntegration = {
  id: '3a1dce58-0105-46e5-802f-db4a05fb85db',
  provider: 'twitter',
  credentials: { api_key: 'key' },
};

describe('POST /api/social-integrations/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when not admin', async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new AuthError('Not authenticated', 401),
    );

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Not authenticated');
  });

  it('returns 404 when integration not found', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(null);

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Integration not found');
    expect(json.code).toBe('social_integration_not_found');
  });

  it('sends test message on happy path', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(mockIntegration as never);
    vi.mocked(sendSocialTestMessage).mockResolvedValue(undefined as never);

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toBeNull();

    expect(getSocialIntegrationByIdWithSecrets).toHaveBeenCalledWith('3a1dce58-0105-46e5-802f-db4a05fb85db');
    // No language cookie: the default UI locale.
    expect(sendSocialTestMessage).toHaveBeenCalledWith(mockIntegration, 'en');
  });

  it('sends the test post in the admin UI language', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(mockIntegration as never);
    vi.mocked(sendSocialTestMessage).mockResolvedValue(undefined as never);

    const res = await POST(makeEmptyRequest('plc_locale=de'), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });

    expect(res.status).toBe(200);
    expect(sendSocialTestMessage).toHaveBeenCalledWith(mockIntegration, 'de');
  });

  it('returns 500 when sendSocialTestMessage throws', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(mockIntegration as never);
    vi.mocked(sendSocialTestMessage).mockRejectedValue(new Error('API rate limit'));

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.success).toBe(false);
    // safeErrorResponse hides internal error details — returns safe fallback
    expect(json.error).toBe('Failed to send test post');
  });

  it('answers a stored Bluesky service_url the provider refuses with a distinct coded 422', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(mockIntegration as never);
    vi.mocked(sendSocialTestMessage).mockRejectedValue(new BlueskyServiceUrlError('host_not_allowed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json).toMatchObject({
      success: false,
      code: 'social_bluesky_service_url_rejected',
      params: { reason: 'host_not_allowed' },
    });
    expect(json.error).not.toBe('Failed to send test post');
    // Logged server-side with the original cause, and never with the stored address.
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('has a German and an English message for the invalid-target code', () => {
    expect(enErrors.social_bluesky_service_url_rejected).toContain('{reason}');
    expect(deErrors.social_bluesky_service_url_rejected).toContain('{reason}');
  });

  it('returns generic fallback message for non-Error exceptions', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(mockIntegration as never);
    vi.mocked(sendSocialTestMessage).mockRejectedValue('unknown failure');

    const res = await POST(makeEmptyRequest(), {
      params: makeParams({ id: '3a1dce58-0105-46e5-802f-db4a05fb85db' }),
    });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to send test post');
  });
});
