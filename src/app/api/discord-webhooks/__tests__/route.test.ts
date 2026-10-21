import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { DiscordEventType } from '@/types/discord';

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

vi.mock('@/lib/supabase/queries/discord-webhooks', () => ({
  listAllWebhooks: vi.fn(),
  getWebhooksByScope: vi.fn(),
  createWebhook: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { GET, POST } from '@/app/api/discord-webhooks/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  listAllWebhooks,
  getWebhooksByScope,
  createWebhook,
} from '@/lib/supabase/queries/discord-webhooks';

const mockAdmin = {
  playerId: 'p-1',
  name: 'Admin User',
  isAdmin: true,
  isResourceAdmin: false,
  isCreator: false,
  psUsername: 'admin',
  championsUsername: null,
  avatarUrl: null,
};

function makeGetRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/discord-webhooks');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return { url: url.toString(), nextUrl: url } as unknown as NextRequest;
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const fakeWebhook = {
  id: 'wh-1',
  scope_type: 'global' as const,
  scope_id: null,
  webhook_url: 'https://discord.com/api/webhooks/123/abc',
  label: 'Test Hook',
  enabled: true,
  event_filter: [] as DiscordEventType[],
  format_options: { spoiler_results: true, show_pokemon_details: true, show_replay_link: true, ping_next_drafter: false, attach_match_card: true, show_achievements: true, show_streaks: true, show_ratings: true },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('GET /api/discord-webhooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: auth passes
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
  });

  it('requires admin auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Admin required');
  });

  it('lists all webhooks when no scope_type', async () => {
    vi.mocked(listAllWebhooks).mockResolvedValue([fakeWebhook]);

    const res = await GET(makeGetRequest());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([fakeWebhook]);
    expect(vi.mocked(listAllWebhooks)).toHaveBeenCalledTimes(1);
  });

  it('filters by scope when scope_type is provided', async () => {
    vi.mocked(getWebhooksByScope).mockResolvedValue([fakeWebhook]);

    const res = await GET(makeGetRequest({ scope_type: 'season', scope_id: 's1' }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(vi.mocked(getWebhooksByScope)).toHaveBeenCalledWith('season', 's1');
  });

  it('rejects invalid scope_type', async () => {
    const res = await GET(makeGetRequest({ scope_type: 'invalid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(vi.mocked(getWebhooksByScope)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(listAllWebhooks).mockRejectedValue(new Error('db down'));

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch webhooks');
  });
});

describe('POST /api/discord-webhooks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: auth passes
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
  });

  it('requires admin auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await POST(makePostRequest({ scope_type: 'global' as const, label: 'X', webhook_url: 'https://discord.com/api/webhooks/1/abc' }));
    expect(res.status).toBe(403);
  });

  it('rejects invalid scope_type', async () => {
    const res = await POST(
      makePostRequest({ scope_type: 'invalid', label: 'X', webhook_url: 'https://discord.com/api/webhooks/1/abc' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('scope_type');
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
  });

  it('requires scope_id for non-global webhooks', async () => {
    const res = await POST(
      makePostRequest({ scope_type: 'season' as const, label: 'X', webhook_url: 'https://discord.com/api/webhooks/1/abc' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('scope_id is required');
  });

  it('validates Discord webhook URL format', async () => {
    const res = await POST(
      makePostRequest({ scope_type: 'global' as const, label: 'X', webhook_url: 'https://evil.com/hook' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('valid Discord webhook URL');
  });

  it('requires label', async () => {
    const res = await POST(
      makePostRequest({ scope_type: 'global' as const, webhook_url: 'https://discord.com/api/webhooks/1/abc' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('label');
  });

  it('creates webhook and returns 201', async () => {
    vi.mocked(createWebhook).mockResolvedValue(fakeWebhook);

    const res = await POST(
      makePostRequest({
        scope_type: 'global' as const,
        label: 'Test Hook',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(fakeWebhook);
  });

  it.each(['league', 'de', 'en'] as const)('passes format_options.language %s through to createWebhook', async (language) => {
    vi.mocked(createWebhook).mockResolvedValue(fakeWebhook);

    const res = await POST(
      makePostRequest({
        scope_type: 'global' as const,
        label: 'Test Hook',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
        format_options: { language },
      }),
    );
    expect(res.status).toBe(201);
    expect(vi.mocked(createWebhook)).toHaveBeenCalledWith(
      expect.objectContaining({ format_options: { language } }),
    );
  });

  it('rejects an unknown format_options.language with validation_failed', async () => {
    const res = await POST(
      makePostRequest({
        scope_type: 'global' as const,
        label: 'Test Hook',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
        format_options: { language: 'fr' },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.error).toContain('language');
    expect(vi.mocked(createWebhook)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(createWebhook).mockRejectedValue(new Error('insert failed'));

    const res = await POST(
      makePostRequest({
        scope_type: 'global' as const,
        label: 'Test Hook',
        webhook_url: 'https://discord.com/api/webhooks/123/abc',
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to create webhook');
  });
});