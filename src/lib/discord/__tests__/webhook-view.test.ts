import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT_OPTIONS, type DiscordWebhook } from '@/types/discord';
import { toWebhookView, webhookUrlHint } from '../webhook-view';

const TOKEN = 'xxxxxxxx1234';
const URL_FULL = `https://discord.com/api/webhooks/123/${TOKEN}`;

function makeWebhook(overrides?: Partial<DiscordWebhook>): DiscordWebhook {
  return {
    id: 'wh-1',
    scope_type: 'global',
    scope_id: null,
    webhook_url: URL_FULL,
    label: 'Main feed',
    enabled: true,
    event_filter: ['match_confirmed'],
    format_options: { ...DEFAULT_FORMAT_OPTIONS },
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('webhookUrlHint', () => {
  it('is an ellipsis and the last four characters', () => {
    expect(webhookUrlHint(URL_FULL)).toBe('…1234');
  });

  it('is empty for a URL shorter than 8 characters', () => {
    expect(webhookUrlHint('abc')).toBe('');
    expect(webhookUrlHint('1234567')).toBe('');
    expect(webhookUrlHint('')).toBe('');
  });

  it('shows the hint from 8 characters on', () => {
    expect(webhookUrlHint('12345678')).toBe('…5678');
  });
});

describe('toWebhookView', () => {
  it('drops webhook_url and adds the hint', () => {
    const view = toWebhookView(makeWebhook());
    expect('webhook_url' in view).toBe(false);
    expect(view.webhook_url_hint).toBe('…1234');
  });

  it('never serializes the token or the URL', () => {
    const text = JSON.stringify(toWebhookView(makeWebhook()));
    expect(text).not.toContain('xxxxxxxx');
    expect(text).not.toContain('discord.com');
  });

  it('keeps every other field', () => {
    const webhook = makeWebhook({ scope_type: 'season', scope_id: 's-1', enabled: false });
    const { webhook_url: _url, ...rest } = webhook;
    expect(toWebhookView(webhook)).toEqual({ ...rest, webhook_url_hint: '…1234' });
  });
});
