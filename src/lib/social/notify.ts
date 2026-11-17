import { notificationFilterType } from '@/lib/discord/matchers';
import { resolvePhaseSocialIntegrations } from '@/lib/supabase/queries/phase-social-integrations';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import type { PhaseSocialEventPayload } from '@/types/phase-events';
import type { PhaseSocialIntegrationWithSecrets } from '@/types/phase-integrations';
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
import { OutboundHttpError } from '@/lib/outbound-fetch';
import { decryptJson } from './crypto';
import { formatSocialPost, formatPhaseSocialPost } from './format';
import { matchesEventFilter } from './matchers';
import { BlueskyServiceUrlError } from './bluesky-service';
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

export function emitPhaseSocialEvent(payload: PhaseSocialEventPayload): void {
  void emitPhaseAsync(payload).catch((err: unknown) => {
    console.error('[Social] Failed to emit phase event:', payload.event_type, classifyPublishFailure(err));
  });
}

async function emitPhaseAsync(payload: PhaseSocialEventPayload): Promise<void> {
  const phase = await getPhaseById(payload.owner.phase_id);
  if (!phase) {
    console.error('[Social] Phase notification owner not found:', payload.owner.phase_id);
    return;
  }
  if (phase.season_id !== payload.owner.season_id) {
    console.error('[Social] Phase notification league ownership mismatch:', phase.id);
    return;
  }
  const integrations = await resolvePhaseSocialIntegrations(phase.id);
  await deliverSocialEvent(payload, integrations, { seasonId: phase.season_id });
}

async function emitAsync(payload: SocialEventPayload): Promise<void> {
  try {
    const integrations = await resolveSocialIntegrations(payload.tournament_id, payload.season_id);
    await deliverSocialEvent(payload, integrations, { seasonId: payload.season_id, tournamentId: payload.tournament_id });
  } catch (err) {
    console.error('[Social] Failed to emit event:', payload.event_type, err instanceof Error ? err.message : String(err));
  }
}

async function deliverSocialEvent(
  payload: SocialEventPayload | PhaseSocialEventPayload,
  integrations: Array<SocialIntegrationWithSecrets | PhaseSocialIntegrationWithSecrets>,
  contentRef: Parameters<typeof resolveContentLocale>[0],
): Promise<void> {
  const filterEvent = notificationFilterType(payload.event_type);
  const matching = integrations.filter((integration) =>
    matchesEventFilter(integration, filterEvent),
  );

  if (matching.length === 0) return;

  // Posts go out in the league's content language (i18n-core §6.3), read
  // once per event; a failed read falls back to the default language.
  const lang = await resolveContentLocale(contentRef);

  const results = await Promise.allSettled(
    matching.map((integration) => publishIntegrationEvent(integration, payload, lang)),
  );
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') return;
    const integration = matching[index];
    console.error(
      `[Social] Post failed: integration=${integration.id} provider=${integration.provider} event=${payload.event_type} failure=${classifyPublishFailure(result.reason)}`,
    );
  });
}

/**
 * A log-safe label for a rejected post. Only errors whose message this code
 * builds from non-secret parts (a refused Bluesky target, a provider's HTTP
 * status) contribute it; anything else, such as a network error that can name
 * the host or carry request text, is reduced to its class name.
 */
function classifyPublishFailure(err: unknown): string {
  if (err instanceof BlueskyServiceUrlError) return `invalid_target (${err.reason})`;
  if (err instanceof OutboundHttpError) return `http_error (${err.message})`;
  return err instanceof Error ? err.name : 'unknown';
}

function parseCredentials(integration: SocialIntegrationWithSecrets | PhaseSocialIntegrationWithSecrets): SocialCredentials | null {
  if (!integration.credentials_encrypted) return null;

  try {
    const credentials = decryptJson<SocialCredentials>(integration.credentials_encrypted);
    if (credentials.provider !== integration.provider) {
      console.error(
        `[Social] Credentials provider mismatch for integration ${integration.id}: expected ${integration.provider}`,
      );
      return null;
    }
    return credentials;
  } catch (err) {
    console.error(`[Social] Failed to decrypt credentials for integration ${integration.id}:`, err instanceof Error ? err.name : 'unknown');
    return null;
  }
}

async function publishIntegrationEvent(
  integration: SocialIntegrationWithSecrets | PhaseSocialIntegrationWithSecrets,
  payload: SocialEventPayload | PhaseSocialEventPayload,
  lang: Locale,
): Promise<void> {
  const credentials = parseCredentials(integration);
  if (!credentials) {
    console.error(`[Social] Missing or invalid credentials for integration ${integration.id}`);
    return;
  }

  const text = 'owner' in payload
    ? formatPhaseSocialPost(payload, integration.provider, integration.post_options, lang)
    : formatSocialPost(payload, integration.provider, integration.post_options, lang);
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
