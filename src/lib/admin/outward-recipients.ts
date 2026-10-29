import 'server-only';
/**
 * `previewRecipients`: which Discord webhooks and social integrations an event of a tournament would reach, as MASKED names
 * and counts only. The assistant's Go-live cards list them ("posts to: Discord #league-announcements, ...") and fingerprint
 * the set, so an approval is refused when the channels changed between the card and the click.
 *
 * It resolves the candidates with the same queries the senders use (`resolveWebhooks`, `resolveSocialIntegrations`) and
 * decides with the senders' own matchers (`matchesFilter`, `matchesFormatOptions`, `matchesEventFilter`), so the preview and
 * the post cannot drift apart. What leaves this module is a row id (not a secret), the admin-typed label and the provider:
 * never a webhook URL, never a credential. A label that looks like a URL is replaced by the URL's masked hint.
 */
import { matchesFilter, matchesFormatOptions } from '@/lib/discord/matchers';
import { webhookUrlHint } from '@/lib/discord/webhook-view';
import { matchesEventFilter } from '@/lib/social/matchers';
import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { resolveSocialIntegrations } from '@/lib/supabase/queries/social-integrations';
import type { DiscordEventType } from '@/types/discord';

/** The payload kind each event travels with (only the achievement, streak and rating kinds are filtered by format options). */
const KIND_OF_EVENT: Readonly<Partial<Record<DiscordEventType, string>>> = {
  round_generated: 'round_generated',
  tournament_started: 'tournament_status',
  tournament_completed: 'tournament_status',
  achievement_unlocked: 'achievement_unlocked',
  streak_milestone: 'streak_milestone',
  streak_broken: 'streak_broken',
  rating_milestone: 'rating_milestone',
};

export interface RecipientGroup {
  /** Row ids of the matching channels, sorted: what a precondition fingerprints. */
  readonly ids: readonly string[];
  /** Masked display names, sorted. */
  readonly names: readonly string[];
}

export interface RecipientPreview {
  readonly discord: RecipientGroup;
  readonly social: RecipientGroup;
}

const URLISH = /https?:\/\/|discord(?:app)?\.com\/api\/webhooks/i;
const MAX_NAME = 60;

const clip = (value: string): string => (value.length > MAX_NAME ? `${value.slice(0, MAX_NAME - 1)}…` : value);
const byName = <T extends { name: string; id: string }>(a: T, b: T): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/**
 * The channels `eventType` of the tournament (and its league, when it has one) would reach right now. Global channels count
 * too, as in the sender.
 */
export async function previewRecipients(input: { eventType: DiscordEventType; tournamentId: string; seasonId: string | null }): Promise<RecipientPreview> {
  const { eventType, tournamentId, seasonId } = input;
  const kind = KIND_OF_EVENT[eventType] ?? eventType;
  const [webhooks, integrations] = await Promise.all([resolveWebhooks(tournamentId, seasonId), resolveSocialIntegrations(tournamentId, seasonId)]);

  const discord = webhooks
    .filter((webhook) => matchesFilter(webhook, eventType) && matchesFormatOptions(webhook, { data: { kind } }))
    .map((webhook) => ({
      id: webhook.id,
      // The label is typed by an admin; one that is (or contains) the webhook URL itself is shown as the URL's hint.
      name: clip(`Discord ${URLISH.test(webhook.label) ? webhookUrlHint(webhook.webhook_url) || '…' : webhook.label}`),
    }))
    .sort(byName);

  const social = integrations
    .filter((integration) => matchesEventFilter(integration, eventType))
    .map((integration) => ({
      id: integration.id,
      // Only the provider and the label leave here; the encrypted credentials stay in the row.
      name: clip(`${integration.provider} ${URLISH.test(integration.label) ? '…' : integration.label}`),
    }))
    .sort(byName);

  return {
    discord: { ids: discord.map((entry) => entry.id).sort(), names: discord.map((entry) => entry.name) },
    social: { ids: social.map((entry) => entry.id).sort(), names: social.map((entry) => entry.name) },
  };
}
