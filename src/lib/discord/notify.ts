import { resolveWebhooks } from '@/lib/supabase/queries/discord-webhooks';
import { resolveContentLocale } from '@/i18n/content-locale';
import { DEFAULT_CONTENT_LOCALE, type Locale } from '@/i18n/config';
import { buildEmbed } from './embeds';
import { generateMatchCardImage } from './match-card-image';
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

async function emitAsync(payload: DiscordEventPayload): Promise<void> {
  try {
    const webhooks = await resolveWebhooks(payload.tournament_id, payload.season_id);

    const matching = webhooks
      .filter((w) => matchesFilter(w, payload.event_type))
      .filter((w) => matchesFormatOptions(w, payload));
    if (matching.length === 0) return;

    // The league's content language (i18n-core §6.2), read once per event and
    // only when a webhook follows it. A failed read falls back to the default
    // inside resolveContentLocale, so the embeds still go out.
    const contentLocale = matching.some((w) => followsLeague(w.format_options.language))
      ? await resolveContentLocale({ seasonId: payload.season_id, tournamentId: payload.tournament_id })
      : null;
    const langFor = (w: DiscordWebhook): Locale =>
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
          console.error('[Discord] Failed to generate match card image:', err);
        }
      }
    }

    // Build per-webhook embeds — each webhook may have different format_options and language
    await Promise.allSettled(
      matching.map((w) => {
        const lang = langFor(w);
        const { embed, content } = buildEmbed(payload, w.format_options, lang);
        const attachment = w.format_options.attach_match_card ? attachments.get(lang) : undefined;
        return postToWebhook(w.webhook_url, embed, content, attachment ? [attachment] : undefined);
      })
    );
  } catch (err) {
    console.error('[Discord] Failed to emit event:', payload.event_type, err);
  }
}

function matchesFilter(webhook: DiscordWebhook, eventType: string): boolean {
  // Empty filter = all events
  if (webhook.event_filter.length === 0) return true;
  return webhook.event_filter.includes(eventType as DiscordWebhook['event_filter'][number]);
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

function matchesFormatOptions(webhook: DiscordWebhook, payload: DiscordEventPayload): boolean {
  if (payload.data.kind === 'achievement_unlocked') {
    return webhook.format_options.show_achievements;
  }
  if (payload.data.kind === 'streak_milestone' || payload.data.kind === 'streak_broken') {
    return webhook.format_options.show_streaks;
  }
  if (payload.data.kind === 'rating_milestone') {
    return webhook.format_options.show_ratings;
  }
  return true;
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

async function postToWebhook(
  url: string,
  embed: DiscordEmbed,
  content?: string,
  attachments?: WebhookAttachment[],
): Promise<void> {
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

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.error(
        `[Discord] Webhook multipart POST failed: ${response.status} ${response.statusText}`,
        await response.text().catch(() => '(no body)'),
      );
    }
  } else {
    // Standard JSON payload (no attachments)
    const body: Record<string, unknown> = { embeds: [embed] };
    if (content) body.content = content;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(
        `[Discord] Webhook POST failed: ${response.status} ${response.statusText}`,
        await response.text().catch(() => '(no body)'),
      );
    }
  }
}
