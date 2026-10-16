import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SocialIntegration, SocialIntegrationWithSecrets } from '@/types/social';

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
  getSocialIntegrationById: vi.fn(),
  updateSocialIntegration: vi.fn(),
  deleteSocialIntegration: vi.fn(),
  getSocialIntegrationByIdWithSecrets: vi.fn(),
}));

vi.mock('@/lib/social/crypto', () => ({
  encryptJson: vi.fn(),
}));

vi.mock('@/lib/social/validation', () => ({
  checkCredentials: vi.fn().mockReturnValue(null),
  toCredentialHint: vi.fn().mockReturnValue('@poketools'),
}));

vi.mock('@/lib/social/notify', () => ({
  sendSocialTestMessage: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/social-integrations/[id]/route';
import { POST as POST_TEST } from '@/app/api/social-integrations/[id]/test/route';
import {
  deleteSocialIntegration,
  getSocialIntegrationById,
  getSocialIntegrationByIdWithSecrets,
  updateSocialIntegration,
} from '@/lib/supabase/queries/social-integrations';
import { encryptJson } from '@/lib/social/crypto';
import { checkCredentials, toCredentialHint } from '@/lib/social/validation';
import { sendSocialTestMessage } from '@/lib/social/notify';

function baseIntegration(): SocialIntegration {
  return {
    id: 'integration-1',
    provider: 'x',
    scope_type: 'global',
    scope_id: null,
    label: 'Main X Feed',
    enabled: true,
    event_filter: [],
    post_options: {
      include_replay_link: true,
      include_hashtags: false,
    },
    credential_hint: '@poketools',
    has_credentials: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('social-integrations/[id] route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PATCH returns 404 for missing integration', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(null);

    const request = {
      json: vi.fn().mockResolvedValue({ enabled: false }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'missing' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('not found');
    expect((payload as { code?: string }).code).toBe('social_integration_not_found');
  });

  it('PATCH validates provider mismatch in credentials', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());

    const request = {
      json: vi.fn().mockResolvedValue({
        credentials: {
          provider: 'threads',
          access_token: 'token',
          user_id: '123',
        },
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('must match integration provider');
    expect((payload as { code?: string }).code).toBe('social_credentials_provider_mismatch');
    expect(vi.mocked(updateSocialIntegration)).not.toHaveBeenCalled();
  });

  it('PATCH returns social_credentials_field_required for a missing credential field', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(checkCredentials).mockReturnValueOnce({
      message: 'X credentials require access_token',
      provider: 'X',
      field: 'access_token',
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        credentials: { provider: 'x', access_token: 'token' },
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      success: false,
      error: 'X credentials require access_token',
      code: 'social_credentials_field_required',
      params: { provider: 'X', field: 'access_token' },
    });
    expect(vi.mocked(updateSocialIntegration)).not.toHaveBeenCalled();
  });

  it('PATCH updates integration fields successfully', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(updateSocialIntegration).mockResolvedValue({
      ...baseIntegration(),
      enabled: false,
      label: 'Muted Feed',
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        enabled: false,
        label: 'Muted Feed',
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; data: SocialIntegration };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.data.enabled).toBe(false);
    expect(payload.data.label).toBe('Muted Feed');
  });

  it('PATCH encrypts credentials when provided', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(encryptJson).mockReturnValue('encrypted');
    vi.mocked(toCredentialHint).mockReturnValue('@new');
    vi.mocked(updateSocialIntegration).mockResolvedValue(baseIntegration());

    const request = {
      json: vi.fn().mockResolvedValue({
        credentials: {
          provider: 'x',
          access_token: 'new-token',
          account_label: '@new',
        },
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(encryptJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateSocialIntegration)).toHaveBeenCalledWith(
      'integration-1',
      expect.objectContaining({
        credentials_encrypted: 'encrypted',
        credential_hint: '@new',
      }),
    );
  });

  it('DELETE removes integration', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(deleteSocialIntegration).mockResolvedValue();

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(deleteSocialIntegration)).toHaveBeenCalledWith('integration-1');
  });

  it('PATCH returns 400 when clear_credentials and credentials both provided', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());

    const request = {
      json: vi.fn().mockResolvedValue({
        credentials: { provider: 'x', access_token: 'token' },
        clear_credentials: true,
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('either credentials or clear_credentials');
    expect((payload as { code?: string }).code).toBe('social_credentials_conflict');
  });

  it('PATCH clears credentials when clear_credentials is true', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(updateSocialIntegration).mockResolvedValue({
      ...baseIntegration(),
      credential_hint: null,
      has_credentials: false,
    });

    const request = {
      json: vi.fn().mockResolvedValue({ clear_credentials: true }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(updateSocialIntegration)).toHaveBeenCalledWith(
      'integration-1',
      expect.objectContaining({
        credentials_encrypted: null,
        credential_hint: null,
      }),
    );
  });

  it('PATCH returns 500 for encryption key errors', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(baseIntegration());
    vi.mocked(encryptJson).mockImplementation(() => {
      throw new Error('SOCIAL_INTEGRATION_ENCRYPTION_KEY is not configured');
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        credentials: { provider: 'x', access_token: 'new-token' },
      }),
    } as unknown as NextRequest;

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(500);
    // safeErrorResponse hides internal error details — returns safe fallback
    expect(payload.error).toBe('Failed to update social integration');
  });

  it('DELETE returns 404 when integration not found', async () => {
    vi.mocked(getSocialIntegrationById).mockResolvedValue(null);

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'missing' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain('not found');
    expect((payload as { code?: string }).code).toBe('social_integration_not_found');
  });

  it('DELETE returns 500 on unexpected error', async () => {
    vi.mocked(getSocialIntegrationById).mockRejectedValue(new Error('DB failure'));

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Failed to delete social integration');
  });

  it('DELETE returns auth error when not admin', async () => {
    const { AuthError, requireAdmin: reqAdmin } = await import('@/lib/auth/helpers');
    vi.mocked(reqAdmin).mockRejectedValueOnce(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );

    const response = await DELETE({} as NextRequest, {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });
});

describe('social-integrations/[id]/test route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST sends provider test message', async () => {
    const integration: SocialIntegrationWithSecrets = {
      ...baseIntegration(),
      credentials_encrypted: 'encrypted',
    };
    vi.mocked(getSocialIntegrationByIdWithSecrets).mockResolvedValue(integration);

    const response = await POST_TEST(new Request('http://localhost/api/social-integrations/integration-1/test', { method: 'POST' }), {
      params: Promise.resolve({ id: 'integration-1' }),
    });
    const payload = await response.json() as { success: boolean };

    expect(response.status).toBe(200);
    expect(payload.success).toBe(true);
    expect(vi.mocked(sendSocialTestMessage)).toHaveBeenCalledWith(integration, 'en');
  });
});

