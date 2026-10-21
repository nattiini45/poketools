import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { SocialIntegration } from '@/types/social';

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
  listAllSocialIntegrations: vi.fn(),
  createSocialIntegration: vi.fn(),
}));

vi.mock('@/lib/social/crypto', () => ({
  encryptJson: vi.fn(),
}));

vi.mock('@/lib/social/validation', () => ({
  checkCredentials: vi.fn().mockReturnValue(null),
  toCredentialHint: vi.fn().mockReturnValue('@poketools'),
}));

import { GET, POST } from '@/app/api/social-integrations/route';
import { requireAdmin } from '@/lib/auth/helpers';
import {
  createSocialIntegration,
  listAllSocialIntegrations,
} from '@/lib/supabase/queries/social-integrations';
import { encryptJson } from '@/lib/social/crypto';
import { checkCredentials } from '@/lib/social/validation';

describe('social-integrations route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns social integration list for admins', async () => {
    const rows: SocialIntegration[] = [
      {
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
      },
    ];
    vi.mocked(listAllSocialIntegrations).mockResolvedValue(rows);

    const response = await GET();
    const payload = await response.json() as { success: boolean; data: SocialIntegration[] };

    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(rows);
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledTimes(1);
  });

  it('POST validates provider and rejects unsupported values', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'invalid_provider',
        scope_type: 'global',
        scope_id: null,
        label: 'Invalid',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('provider');
    expect((payload as { code?: string }).code).toBe('validation_failed');
    expect(vi.mocked(requireAdmin)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSocialIntegration)).not.toHaveBeenCalled();
  });

  it('POST creates integration with encrypted credentials', async () => {
    vi.mocked(encryptJson).mockReturnValue('encrypted');
    const created: SocialIntegration = {
      id: 'integration-1',
      provider: 'threads',
      scope_type: 'season',
      scope_id: '00000000-0000-4000-8000-000000000001',
      label: 'Threads Stage Feed',
      enabled: true,
      event_filter: ['round_generated'],
      post_options: {
        include_replay_link: true,
        include_hashtags: true,
      },
      credential_hint: '@poketools',
      has_credentials: true,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(createSocialIntegration).mockResolvedValue(created);

    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'threads',
        scope_type: 'season',
        scope_id: '00000000-0000-4000-8000-000000000001',
        label: 'Threads Stage Feed',
        event_filter: ['round_generated'],
        post_options: { include_hashtags: true },
        credentials: {
          provider: 'threads',
          access_token: 'access-token',
          user_id: '12345',
          account_label: '@poketools',
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; data: SocialIntegration };

    expect(response.status).toBe(201);
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual(created);
    expect(vi.mocked(encryptJson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSocialIntegration)).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'threads',
        credential_hint: '@poketools',
        credentials_encrypted: 'encrypted',
      }),
    );
  });

  it('GET returns auth error when not admin', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );

    const response = await GET();
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Forbidden');
  });

  it('GET returns 500 on unexpected error', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(listAllSocialIntegrations).mockRejectedValue(new Error('DB failure'));

    const response = await GET();
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe('Failed to fetch social integrations');
  });

  it('POST validates scope_type', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'invalid',
        label: 'Test',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('scope_type');
  });

  it('POST requires scope_id for non-global integrations', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'season',
        // Missing scope_id
        label: 'Test',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('scope_id is required');
  });

  it('POST requires label', async () => {
    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'global',
        label: '',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain('label');
  });

  it('POST returns auth error on admin check failure', async () => {
    const { AuthError } = await import('@/lib/auth/helpers');
    vi.mocked(requireAdmin).mockRejectedValue(
      new (AuthError as unknown as new (m: string, s: number) => Error)('Forbidden', 403),
    );

    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'global',
        label: 'Test',
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('POST returns 500 for encryption key errors', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(encryptJson).mockImplementation(() => {
      throw new Error('SOCIAL_INTEGRATION_ENCRYPTION_KEY is not configured');
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'global',
        label: 'Test Feed',
        credentials: {
          provider: 'x',
          access_token: 'token',
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; error?: string };

    expect(response.status).toBe(500);
    // safeErrorResponse hides internal error details — returns safe fallback
    expect(payload.error).toBe('Failed to create social integration');
  });

  it('POST returns 400 social_credentials_field_required for missing credential fields', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);
    vi.mocked(checkCredentials).mockReturnValueOnce({
      message: 'X credentials require access_token',
      provider: 'X',
      field: 'access_token',
    });

    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'global',
        label: 'Test Feed',
        credentials: {
          provider: 'x',
          access_token: 'token',
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as {
      success: boolean;
      error?: string;
      code?: string;
      params?: Record<string, string>;
    };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('social_credentials_field_required');
    expect(payload.params).toEqual({ provider: 'X', field: 'access_token' });
    expect(payload.error).toBe('X credentials require access_token');
    expect(vi.mocked(encryptJson)).not.toHaveBeenCalled();
    expect(vi.mocked(createSocialIntegration)).not.toHaveBeenCalled();
  });

  it('POST returns 400 social_credentials_provider_mismatch when credential provider differs', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined as never);

    const request = {
      json: vi.fn().mockResolvedValue({
        provider: 'x',
        scope_type: 'global',
        label: 'Test Feed',
        credentials: {
          provider: 'bluesky',
          handle: 'example.bsky.social',
          app_password: 'pw',
        },
      }),
    } as unknown as NextRequest;

    const response = await POST(request);
    const payload = await response.json() as { success: boolean; code?: string };

    expect(response.status).toBe(400);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('social_credentials_provider_mismatch');
    expect(vi.mocked(createSocialIntegration)).not.toHaveBeenCalled();
  });
});
