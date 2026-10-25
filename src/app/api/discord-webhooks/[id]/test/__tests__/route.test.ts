import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordWebhook } from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';

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
}));

vi.mock('@/lib/discord/webhook-test', () => ({
  sendWebhookTestMessage: vi.fn(),
}));

vi.mock('@/lib/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(),
  rateLimitedResponse: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({
  logAuditEvent: vi.fn(),
}));

import { POST } from '@/app/api/discord-webhooks/[id]/test/route';
import { requireAdmin, AuthError } from '@/lib/auth/helpers';
import { getWebhookById } from '@/lib/supabase/queries/discord-webhooks';
import { sendWebhookTestMessage } from '@/lib/discord/webhook-test';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import { NextResponse } from 'next/server';

const ID = '4f0d0098-b1cd-4760-83ba-7675b9ba8cf6';
const TOKEN = 'xxxxxxxx1234';
const URL_FULL = `https://discord.com/api/webhooks/123/${TOKEN}`;

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

const fakeWebhook: DiscordWebhook = {
  id: ID,
  scope_type: 'global',
  scope_id: null,
  webhook_url: URL_FULL,
  label: 'Main feed',
  enabled: false,
  event_filter: [],
  format_options: { ...DEFAULT_FORMAT_OPTIONS },
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000/api/discord-webhooks/${ID}/test`, { method: 'POST', headers });
}

describe('POST /api/discord-webhooks/[id]/test', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin as never);
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
    vi.mocked(getWebhookById).mockResolvedValue(fakeWebhook);
  });

  it('refuses a non-admin with the auth status and reads nothing', async () => {
    const err = new (AuthError as unknown as new (msg: string, code: number) => Error & { statusCode: number })(
      'Admin access required',
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(err);

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(getWebhookById).not.toHaveBeenCalled();
    expect(sendWebhookTestMessage).not.toHaveBeenCalled();
  });

  it('answers 404 INVALID_WEBHOOK_ID for a malformed id before any query', async () => {
    const res = await POST(makeRequest(), makeParams('not-a-uuid'));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('INVALID_WEBHOOK_ID');
    expect(getWebhookById).not.toHaveBeenCalled();
    expect(sendWebhookTestMessage).not.toHaveBeenCalled();
  });

  it('rate limits per admin in the discord-webhook-test bucket', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: true, status: 204 });

    await POST(makeRequest(), makeParams(ID));

    expect(checkRateLimit).toHaveBeenCalledWith('discord-webhook-test', 'p-1', {
      limit: 10,
      windowSeconds: 60,
    });
  });

  it('answers 429 when the rate limit is exhausted, before the database read', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    vi.mocked(rateLimitedResponse).mockReturnValue(
      NextResponse.json({ success: false, error: 'Rate limit exceeded', code: 'rate_limited' } as const, { status: 429 }),
    );

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(429);
    expect(rateLimitedResponse).toHaveBeenCalledWith(42);
    expect(getWebhookById).not.toHaveBeenCalled();
    expect(sendWebhookTestMessage).not.toHaveBeenCalled();
  });

  it('answers 404 webhook_not_found for an unknown id', async () => {
    vi.mocked(getWebhookById).mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('webhook_not_found');
    expect(sendWebhookTestMessage).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('answers 200 with the status and audits the attempt; a disabled webhook can be tested', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: true, status: 204 });

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { status: 204 } });
    expect(getWebhookById).toHaveBeenCalledWith(ID);
    expect(logAuditEvent).toHaveBeenCalledWith({
      actor_id: 'p-1',
      actor_name: 'Admin User',
      action: 'discord_webhook.test',
      resource_type: 'discord_webhook',
      resource_id: ID,
      resource_name: 'Main feed',
      metadata: { ok: true, status: 204 },
    });
  });

  it('hands the webhook and the request locale to the sender', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: true, status: 204 });

    await POST(makeRequest({ cookie: 'plc_locale=de' }), makeParams(ID));

    expect(sendWebhookTestMessage).toHaveBeenCalledTimes(1);
    const [webhook, locale] = vi.mocked(sendWebhookTestMessage).mock.calls[0];
    expect(webhook).toBe(fakeWebhook);
    expect(['de', 'en']).toContain(locale);
  });

  it('answers 502 discord_webhook_test_rejected with the status param', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: false, kind: 'rejected', status: 404 });

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Discord rejected the test message (HTTP 404)',
      code: 'discord_webhook_test_rejected',
      params: { status: 404 },
    });
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({
      ok: false,
      kind: 'rejected',
      status: 404,
    });
  });

  it('answers 502 discord_webhook_test_unreachable', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: false, kind: 'unreachable' });

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('discord_webhook_test_unreachable');
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({ ok: false, kind: 'unreachable' });
  });

  it('answers 422 discord_webhook_url_invalid for a stored URL that fails validation', async () => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue({ ok: false, kind: 'invalid_url' });

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('discord_webhook_url_invalid');
    expect(vi.mocked(logAuditEvent).mock.calls[0][0].metadata).toEqual({ ok: false, kind: 'invalid_url' });
  });

  it.each([
    ['success', { ok: true, status: 204 }],
    ['rejected', { ok: false, kind: 'rejected', status: 401 }],
    ['unreachable', { ok: false, kind: 'unreachable' }],
    ['invalid_url', { ok: false, kind: 'invalid_url' }],
  ] as const)('never puts the webhook URL or its token in the %s response or audit', async (_name, outcome) => {
    vi.mocked(sendWebhookTestMessage).mockResolvedValue(outcome);

    const res = await POST(makeRequest(), makeParams(ID));
    const text = JSON.stringify(await res.json()) + JSON.stringify(vi.mocked(logAuditEvent).mock.calls);

    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('discord.com');
  });

  it('sends an unexpected throw through safeErrorResponse', async () => {
    vi.mocked(sendWebhookTestMessage).mockRejectedValue(new Error(`boom ${URL_FULL}`));

    const res = await POST(makeRequest(), makeParams(ID));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to send test message');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
