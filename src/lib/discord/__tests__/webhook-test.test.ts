import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { integrationsMessages } from '@/i18n/messages/integrations';
import type { Locale } from '@/i18n/config';
import { DEFAULT_FORMAT_OPTIONS, type DiscordWebhook, type WebhookLanguage } from '@/types/discord';
import { sendWebhookTestMessage } from '../webhook-test';

const STORED_URL = 'https://discord.com/api/webhooks/123/abcdefgh1234';

function makeWebhook(overrides?: Partial<DiscordWebhook>): DiscordWebhook {
  return {
    id: 'wh-1',
    scope_type: 'global',
    scope_id: null,
    webhook_url: STORED_URL,
    label: 'Main feed',
    enabled: true,
    event_filter: [],
    format_options: { ...DEFAULT_FORMAT_OPTIONS },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

const fetchMock = vi.fn();

function postedBody(): {
  embeds: { title: string; description: string; color: number; timestamp: string }[];
  allowed_mentions: unknown;
} {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('sendWebhookTestMessage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts once to the stored URL with a JSON body, no redirects and no mentions', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    const outcome = await sendWebhookTestMessage(makeWebhook(), 'en');

    expect(outcome).toEqual({ ok: true, status: 204 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(STORED_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(postedBody().allowed_mentions).toEqual({ parse: [] });
  });

  it('forces the webhook language and substitutes the label', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await sendWebhookTestMessage(
      makeWebhook({ format_options: { ...DEFAULT_FORMAT_OPTIONS, language: 'de' } }),
      'en',
    );

    const embed = postedBody().embeds[0];
    expect(embed.title).toBe(integrationsMessages.de.discord.testEmbed.title);
    expect(embed.description).toBe(
      integrationsMessages.de.discord.testEmbed.description.replace('{label}', 'Main feed'),
    );
    expect(embed.title).not.toBe(integrationsMessages.en.discord.testEmbed.title);
    expect(embed.color).toBe(0x5865f2);
    expect(Number.isNaN(Date.parse(embed.timestamp))).toBe(false);
  });

  const languageCases: [WebhookLanguage | undefined, Locale][] = [
    ['league', 'en'],
    ['league', 'de'],
    [undefined, 'de'],
    ['en', 'de'],
  ];

  it.each(languageCases)('language %s with locale %s', async (language, locale) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await sendWebhookTestMessage(
      makeWebhook({ format_options: { ...DEFAULT_FORMAT_OPTIONS, language } }),
      locale,
    );

    const expected = language === 'en' || language === 'de' ? language : locale;
    expect(postedBody().embeds[0].title).toBe(integrationsMessages[expected].discord.testEmbed.title);
  });

  it('answers ok for any 2xx', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await sendWebhookTestMessage(makeWebhook(), 'en')).toEqual({ ok: true, status: 200 });
  });

  it.each([404, 401, 429, 500, 302])('answers rejected with Discord status %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await sendWebhookTestMessage(makeWebhook(), 'en')).toEqual({ ok: false, kind: 'rejected', status });
  });

  it('answers unreachable when fetch throws, without logging the URL', async () => {
    fetchMock.mockRejectedValue(new Error(`getaddrinfo ENOTFOUND ${STORED_URL}`));

    expect(await sendWebhookTestMessage(makeWebhook(), 'en')).toEqual({ ok: false, kind: 'unreachable' });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('abcdefgh');
  });

  it.each([
    'https://evil.example/x',
    'http://discord.com/api/webhooks/1/a',
    'https://discord.com.evil.example/api/webhooks/1/a',
    'https://discord.com/api/webhooks/abc/a',
    '',
  ])('answers invalid_url without calling fetch for %j', async (webhook_url) => {
    expect(await sendWebhookTestMessage(makeWebhook({ webhook_url }), 'en')).toEqual({
      ok: false,
      kind: 'invalid_url',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
