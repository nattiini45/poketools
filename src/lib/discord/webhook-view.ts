import type { DiscordWebhook, DiscordWebhookView } from '@/types/discord';

/** Characters of the URL's tail shown as the hint. */
const HINT_LENGTH = 4;
/** A URL shorter than this is not a real webhook URL; its hint would give away too much. */
const MIN_HINT_SOURCE_LENGTH = 8;

/**
 * The masked form of a webhook URL: an ellipsis and the last four characters,
 * enough to tell two webhooks apart without disclosing the secret token. A URL
 * too short to hide anything yields an empty hint.
 */
export function webhookUrlHint(url: string): string {
  if (url.length < MIN_HINT_SOURCE_LENGTH) return '';
  return `…${url.slice(-HINT_LENGTH)}`;
}

/**
 * The shape the admin API sends to the browser. The webhook URL is a secret
 * (anyone holding it can post to the channel), so it is write-only: the
 * routes accept it on create and update and answer with the hint only.
 * Server-side dispatch keeps reading the full `DiscordWebhook`.
 */
export function toWebhookView(webhook: DiscordWebhook): DiscordWebhookView {
  const { webhook_url: url, ...rest } = webhook;
  return { ...rest, webhook_url_hint: webhookUrlHint(url) };
}
