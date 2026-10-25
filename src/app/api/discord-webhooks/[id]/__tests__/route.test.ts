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
  getWebhookById: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));

import { PATCH, DELETE } from '@/app/api/discord-webhooks/[id]/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import {
  getWebhookById,
  updateWebhook,
  deleteWebhook,
} from '@/lib/supabase/queries/discord-webhooks';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

const dummyRequest = {} as NextRequest;

const fakeWebhook = {
  id: '4f0d0098-b1cd-4760-83ba-7675b9ba8cf6',
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

describe('PATCH /api/discord-webhooks/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires admin auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await PATCH(makePatchRequest({ enabled: false }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Admin required');
  });

  it('returns 404 when webhook not found', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(null);

    const res = await PATCH(makePatchRequest({ enabled: false }), makeParams('eaea9c92-576d-4342-8e50-21ea0a35023f'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('Webhook not found');
    expect(body.code).toBe('webhook_not_found');
  });

  it('updates webhook and returns updated data', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
    const updated = { ...fakeWebhook, enabled: false };
    vi.mocked(updateWebhook).mockResolvedValue(updated);

    const res = await PATCH(makePatchRequest({ enabled: false }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(false);
    expect(vi.mocked(updateWebhook)).toHaveBeenCalledWith('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6', { enabled: false });
  });

  it('answers webhook_url_hint and no webhook_url, even though the query returns the URL', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
    vi.mocked(updateWebhook).mockResolvedValue({
      ...fakeWebhook,
      webhook_url: 'https://discord.com/api/webhooks/123/abcdefgh1234',
    });

    const res = await PATCH(makePatchRequest({ enabled: true }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    const body = await res.json();

    expect(body.data.webhook_url_hint).toBe('…1234');
    expect('webhook_url' in body.data).toBe(false);
    expect(JSON.stringify(body)).not.toContain('abcdefgh');
  });

  it('still passes a new webhook_url to updateWebhook', async () => {
    const newUrl = 'https://discord.com/api/webhooks/456/zyxwvuts9876';
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
    vi.mocked(updateWebhook).mockResolvedValue({ ...fakeWebhook, webhook_url: newUrl });

    const res = await PATCH(makePatchRequest({ webhook_url: newUrl }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));

    expect(res.status).toBe(200);
    expect(vi.mocked(updateWebhook)).toHaveBeenCalledWith('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6', { webhook_url: newUrl });
    const body = await res.json();
    expect(body.data.webhook_url_hint).toBe('…9876');
    expect(JSON.stringify(body)).not.toContain('zyxwvuts');
  });

  it('passes format_options.language through to the update', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
    vi.mocked(updateWebhook).mockResolvedValue(fakeWebhook);

    const res = await PATCH(
      makePatchRequest({ format_options: { spoiler_results: false, language: 'league' } }),
      makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(updateWebhook)).toHaveBeenCalledWith('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6', {
      format_options: { spoiler_results: false, language: 'league' },
    });
  });

  it('rejects an unknown format_options.language with validation_failed', async () => {
    const res = await PATCH(makePatchRequest({ format_options: { language: 'fr' } }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.params).toEqual({ issues: body.error });
    expect(vi.mocked(updateWebhook)).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getWebhookById).mockRejectedValue(new Error('db fail'));

    const res = await PATCH(makePatchRequest({ enabled: false }), makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to update webhook');
  });
});

describe('DELETE /api/discord-webhooks/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('requires admin auth', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await DELETE(dummyRequest, makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when webhook not found', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(null);

    const res = await DELETE(dummyRequest, makeParams('eaea9c92-576d-4342-8e50-21ea0a35023f'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Webhook not found', code: 'webhook_not_found' });
  });

  it('deletes webhook and returns null data', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
    vi.mocked(deleteWebhook).mockResolvedValue(undefined);

    const res = await DELETE(dummyRequest, makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeNull();
    expect(vi.mocked(deleteWebhook)).toHaveBeenCalledWith('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6');
  });

  it('returns 500 on unexpected error', async () => {
    vi.mocked(getWebhookById).mockRejectedValue(new Error('db fail'));

    const res = await DELETE(dummyRequest, makeParams('4f0d0098-b1cd-4760-83ba-7675b9ba8cf6'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to delete webhook');
  });
});
