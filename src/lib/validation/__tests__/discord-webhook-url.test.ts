import { describe, expect, it } from 'vitest';
import { discordWebhookUrlSchema } from '../schemas';

describe('discordWebhookUrlSchema', () => {
  it.each([
    'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-JKL',
    'https://discord.com/api/webhooks/1/a',
  ])('accepts %s', (url) => {
    expect(discordWebhookUrlSchema.safeParse(url).success).toBe(true);
  });

  it.each([
    'http://discord.com/api/webhooks/1/a',
    'https://discord.com.evil.example/api/webhooks/1/a',
    'https://evil.example/api/webhooks/1/a',
    'https://discord.com/api/webhooks/abc/a',
    'https://discord.com/api/webhooks/1/',
    'https://discord.com/api/webhooks/1/a/b',
    'https://discord.com/api/webhooks/1/a?wait=true',
    'https://discord.com/api/webhooks/1/a#frag',
    'https://discord.com/api/webhooks/1/a b',
    'https://discord.com/api/webhooks/1/..%2f..%2fother',
    'https://user@discord.com/api/webhooks/1/a',
  ])('rejects %s', (url) => {
    expect(discordWebhookUrlSchema.safeParse(url).success).toBe(false);
  });
});