import { describe, expect, it, vi } from 'vitest';
import { requestWebhookTest } from '../webhook-test-client';

describe('requestWebhookTest', () => {
  it('posts to the server route with no body and returns the parsed answer', async () => {
    const answer = { success: true, data: { status: 204 } };
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => answer });

    const result = await requestWebhookTest('w1', fetchMock as unknown as typeof fetch);

    expect(result).toEqual(answer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/discord-webhooks/w1/test');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('discord.com');
  });

  it('passes an API failure through unchanged', async () => {
    const answer = {
      success: false,
      error: 'Discord rejected the test message (HTTP 404)',
      code: 'discord_webhook_test_rejected',
      params: { status: 404 },
    };
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => answer });

    expect(await requestWebhookTest('w1', fetchMock as unknown as typeof fetch)).toEqual(answer);
  });
});
