import { resolvePhaseWebhooks } from '@/lib/supabase/queries/phase-discord-webhooks';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';
import type { PhaseDiscordWebhook } from '@/types/phase-integrations';
import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { DISCORD_TIMEOUT_MS, outboundFetch } from '@/lib/outbound-fetch';
import { discordWebhookUrlSchema } from '@/lib/validation';
import { resolveContentLocale } from '@/i18n/content-locale';
import { DEFAULT_CONTENT_LOCALE, type Locale } from '@/i18n/config';
import { buildEmbed, buildNotificationEmbed } from './embeds';
import { generateMatchCardImage } from './match-card-image';
import { matchesFilter, matchesFormatOptions, notificationFilterType } from './matchers';
import type { DiscordEventPayload, DiscordWebhook, WebhookLanguage } from '@/types/discord';

/**
 * Fire-and-forget: resolve matching webhooks and POST a rich embed to each.
 *
 * **CRITICAL:** This function never throws. Notification failures must not
 * break the main write path. Errors are logged and swallowed.
 *
 * Call pattern (mirrors revalidateMatchPages):
 *   await revalidateMatchPages(tournamentId);
 *   void emitDiscordEvent({ ... });   // fire-and-forget, no await
 */
export function emitDiscordEvent(payload: DiscordEventPayload): void {
  // Run entirely in the background — do not block the API response
  emitAsync(payload).catch((err) => {
    console.error('[Discord] Unhandled error in emitDiscordEvent:', err);
  });
}

// ── Attachment type ─────────────────────────────────────────────────

interface WebhookAttachment {
  filename: string;
  buffer: Buffer;
  contentType: string;
}

// ── Core emit logic ─────────────────────────────────────────────────

export function emitPhaseDiscordEvent(payload: PhaseDiscordEventPayload): void {
  void emitPhaseAsync(payload).catch((err: unknown) => {
    console.error('[Discord] Failed to emit phase event:', payload.event_type, err instanceof Error ? err.name : 'unknown');
  });
}

async function emitPhaseAsync(payload: PhaseDiscordEventPayload): Promise<void> {
  const phase = await getPhaseById(payload.owner.phase_id);
  if (!phase) {
    console.error('[Discord] Phase notification owner not found:', payload.owner.phase_id);
    return;
  }
  if (phase.season_id !== payload.owner.season_id) {
    console.error('[Discord] Phase notification league ownership mismatch:', phase.id);
    return;
  }
  const webhooks = await resolvePhaseWebhooks(phase.id);
  await deliverDiscordEvent(payload, webhooks, { seasonId: phase.season_id });
}

async function emitAsync(payload: DiscordEventPayload): Promise<void> {
  try {
    const webhooks = await resolveWebhooks(payload.tournament_id, payload.season_id);

    await deliverDiscordEvent(payload, webhooks, { seasonId: payload.season_id, tournamentId: payload.tournament_id });
  } catch (err) {
    console.error('[Discord] Failed to emit event:', payload.event_type, err);
  }
}

async function deliverDiscordEvent(
  payload: DiscordEventPayload | PhaseDiscordEventPayload,
  webhooks: Array<DiscordWebhook | PhaseDiscordWebhook>,
  contentRef: Parameters<typeof resolveContentLocale>[0],
): Promise<void> {
  const filterEvent = notificationFilterType(payload.event_type);
  const matching = webhooks
    .filter((w) => matchesFilter(w, filterEvent))
    .filter((w) => matchesFormatOptions(w, payload));
  if (matching.length === 0) return;

  // The league's content language (i18n-core §6.2), read once per event and
  // only when a webhook follows it. A failed read falls back to the default
  // inside resolveContentLocale, so the embeds still go out.
  const contentLocale = matching.some((w) => followsLeague(w.format_options.language))
    ? await resolveContentLocale(contentRef)
    : null;
  const langFor = (w: DiscordWebhook | PhaseDiscordWebhook): Locale =>
    webhookLanguage(w.format_options.language, contentLocale);

  // Generate match card image for confirmed matches (spoiler attachment),
  // once per language that a webhook wanting the card posts in.
  const attachments = new Map<Locale, WebhookAttachment>();
  const matchData = payload.data.kind === 'match_confirmed' ? payload.data : null;
  if (matchData) {
    const cardLangs = new Set(matching.filter((w) => w.format_options.attach_match_card).map(langFor));
    for (const lang of cardLangs) {
      try {
        const imageBuffer = await generateMatchCardImage(matchData, lang);
        attachments.set(lang, {
          filename: 'SPOILER_match-highlight.png',
          buffer: imageBuffer,
          contentType: 'image/png',
        });
      } catch (err) {
        // Image generation failure should not prevent the text embed from sending
        console.error('[Discord] Failed to generate match card image:', 'owner' in payload
          ? err instanceof Error ? err.name : 'unknown'
          : err);
      }
    }
  }

  // Build per-webhook embeds — each webhook may have different format_options and language
  await Promise.allSettled(
    matching.map((w) => {
      const lang = langFor(w);
      const { embed, content } = 'owner' in payload
        ? buildNotificationEmbed(payload, w.format_options, lang)
        : buildEmbed(payload, w.format_options, lang);
      const attachment = w.format_options.attach_match_card ? attachments.get(lang) : undefined;
      return postToWebhook(w, embed, content, attachment ? [attachment] : undefined);
    })
  );
}

function followsLeague(language: WebhookLanguage | undefined): boolean {
  return language === undefined || language === 'league';
}

/**
 * The language one webhook posts in: its forced language, or the league's
 * content language when it follows the league (`'league'` or unset).
 */
export function webhookLanguage(language: WebhookLanguage | undefined, contentLocale: Locale | null): Locale {
  if (language === 'de' || language === 'en') return language;
  return contentLocale ?? DEFAULT_CONTENT_LOCALE;
}

// ── Discord API ─────────────────────────────────────────────────────

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  timestamp?: string;
  url?: string;
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * POST one embed to one stored webhook. The stored URL is re-checked against
 * the Discord-only schema first (a row that bypassed write-time validation
 * must not turn this into a request relay), the post follows no redirect and
 * times out. Logs name the webhook id and the failure class, never the URL:
 * it embeds the webhook token, and a fetch error can echo it.
 */
async function postToWebhook(
  webhook: Pick<DiscordWebhook, 'id' | 'webhook_url'>,
  embed: DiscordEmbed,
  content?: string,
  attachments?: WebhookAttachment[],
): Promise<void> {
  const url = discordWebhookUrlSchema.safeParse(webhook.webhook_url);
  if (!url.success) {
    console.error('[Discord] Stored webhook URL is not a Discord webhook URL, skipping:', webhook.id);
    return;
  }

  let init: Omit<RequestInit, 'redirect' | 'signal'>;
  let kind: string;
  if (attachments && attachments.length > 0) {
    // Multipart form-data upload for file attachments
    // Discord requires payload_json + files[n] fields
    const formData = new FormData();
    formData.append(
      'payload_json',
      JSON.stringify({
        embeds: [embed],
        ...(content ? { content } : {}),
      }),
    );
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      formData.append(
        `files[${i}]`,
        new Blob([new Uint8Array(a.buffer)], { type: a.contentType }),
        a.filename,
      );
    }
    init = { method: 'POST', body: formData };
    kind = 'multipart POST';
  } else {
    // Standard JSON payload (no attachments)
    const body: Record<string, unknown> = { embeds: [embed] };
    if (content) body.content = content;
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    kind = 'POST';
  }

  try {
    const response = await outboundFetch(url.data, init, DISCORD_TIMEOUT_MS);
    if (!response.ok) {
      // The body is Discord's text and can echo the webhook URL, so only the status is logged.
      await response.body?.cancel().catch(() => undefined);
      console.error(`[Discord] Webhook ${kind} failed:`, webhook.id, response.status);
    }
  } catch (err) {
    console.error(`[Discord] Webhook ${kind} unreachable:`, webhook.id, err instanceof Error ? err.name : 'unknown');
  }
}
