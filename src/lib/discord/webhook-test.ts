import 'server-only';

import type { Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { integrationsMessages } from '@/i18n/messages/integrations';
import { discordWebhookUrlSchema } from '@/lib/validation';
import type { DiscordWebhook } from '@/types/discord';

/** Discord blurple, the colour the test embed has always used. */
const TEST_EMBED_COLOR = 0x5865f2;
/** Give up on Discord after this long (the admin is waiting on the button). */
const TEST_TIMEOUT_MS = 8000;

/** What happened to one test post, without ever carrying the webhook URL. */
export type WebhookTestOutcome =
  | { ok: true; status: number }
  | { ok: false; kind: 'rejected'; status: number }
  | { ok: false; kind: 'unreachable' }
  | { ok: false; kind: 'invalid_url' };

/**
 * Post the fixed test embed to one stored webhook. The URL never leaves the
 * server: it is re-checked against the Discord-only schema (a row that
 * bypassed validation must not turn this into an open request relay), the
 * post follows no redirect, times out, and mentions nobody. The embed speaks
 * the webhook's forced language, else `locale` (the admin's own: a webhook
 * that follows the league has no league in a test).
 */
export async function sendWebhookTestMessage(
  webhook: DiscordWebhook,
  locale: Locale,
): Promise<WebhookTestOutcome> {
  const url = discordWebhookUrlSchema.safeParse(webhook.webhook_url);
  if (!url.success) return { ok: false, kind: 'invalid_url' };

  const forced = webhook.format_options.language;
  const tr = createTranslator(integrationsMessages, forced === 'de' || forced === 'en' ? forced : locale);

  try {
    const res = await fetch(url.data, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title: tr('discord.testEmbed.title'),
            description: tr('discord.testEmbed.description', { label: webhook.label }),
            color: TEST_EMBED_COLOR,
            timestamp: new Date().toISOString(),
          },
        ],
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      redirect: 'manual',
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    console.error('[Discord] Webhook test rejected:', webhook.id, res.status);
    return { ok: false, kind: 'rejected', status: res.status };
  } catch (err) {
    // The error text can echo the request URL, so only its name is logged.
    console.error('[Discord] Webhook test unreachable:', webhook.id, err instanceof Error ? err.name : 'unknown');
    return { ok: false, kind: 'unreachable' };
  }
}
