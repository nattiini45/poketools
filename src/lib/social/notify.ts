import { resolveSocialIntegrations } from '@/lib/supabase/queries/social-integrations';
import { resolveContentLocale } from '@/i18n/content-locale';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { outboundSocialMessages } from '@/i18n/messages/outbound/social';
import type {
  SocialCredentials,
  SocialEventPayload,
  SocialIntegrationWithSecrets,
} from '@/types/social';
import { decryptJson } from './crypto';
import { formatSocialPost } from './format';
import { publishToProvider } from './providers';

/**
 * Fire-and-forget social fan-out for X / Threads / Bluesky.
 * Never throws; all failures are logged and swallowed.
 */
export function emitSocialEvent(payload: SocialEventPayload): void {
  emitAsync(payload).catch((err) => {
    console.error('[Social] Unhandled error in emitSocialEvent:', err instanceof Error ? err.message : String(err));
  });
}

async function emitAsync(payload: SocialEventPayload): Promise<void> {
  try {
    const integrations = await resolveSocialIntegrations(payload.tournament_id, payload.season_id);
    const matching = integrations.filter((integration) =>
      matchesEventFilter(integration, payload.event_type),
    );

    if (matching.length === 0) return;

    // Posts go out in the league's content language (i18n-core §6.3), read
    // once per event; a failed read falls back to the default language.
    const lang = await resolveContentLocale({
      seasonId: payload.season_id,
      tournamentId: payload.tournament_id,
    });

    await Promise.allSettled(
      matching.map((integration) => publishIntegrationEvent(integration, payload, lang)),
    );
  } catch (err) {
    console.error('[Social] Failed to emit event:', payload.event_type, err instanceof Error ? err.message : String(err));
  }
}

function matchesEventFilter(
  integration: SocialIntegrationWithSecrets,
  eventType: SocialEventPayload['event_type'],
): boolean {
  if (integration.event_filter.length === 0) return true;
  return integration.event_filter.includes(eventType);
}

function parseCredentials(integration: SocialIntegrationWithSecrets): SocialCredentials | null {
  if (!integration.credentials_encrypted) return null;

  try {
    const credentials = decryptJson<SocialCredentials>(integration.credentials_encrypted);
    if (credentials.provider !== integration.provider) {
      console.error(
        `[Social] Credentials provider mismatch for integration ${integration.id}: expected ${integration.provider}, got ${credentials.provider}`,
      );
      return null;
    }
    return credentials;
  } catch (err) {
    console.error(`[Social] Failed to decrypt credentials for integration ${integration.id}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function publishIntegrationEvent(
  integration: SocialIntegrationWithSecrets,
  payload: SocialEventPayload,
  lang: Locale,
): Promise<void> {
  const credentials = parseCredentials(integration);
  if (!credentials) {
    console.error(`[Social] Missing or invalid credentials for integration ${integration.id}`);
    return;
  }

  const text = formatSocialPost(payload, integration.provider, integration.post_options, lang);
  if (!text) return;

  await publishToProvider(integration.provider, credentials, text, payload.imageUrl);
}

/**
 * Publishes an admin-triggered test post. `locale` is the language of the
 * admin who pressed "Test" (the route passes `getRequestLocale(request)`);
 * English when omitted.
 */
export async function sendSocialTestMessage(
  integration: SocialIntegrationWithSecrets,
  locale: Locale = DEFAULT_LOCALE,
): Promise<void> {
  const credentials = parseCredentials(integration);
  if (!credentials) {
    throw new Error('Integration credentials are missing or invalid');
  }

  const t = createTranslator(outboundSocialMessages, locale);
  const testMessage = [
    t('testPost.title'),
    t('testPost.provider', { provider: integration.provider }),
    t('testPost.label', { label: integration.label }),
    t('testPost.time', { time: new Date().toISOString() }),
  ].join('\n');

  await publishToProvider(integration.provider, credentials, testMessage);
}
