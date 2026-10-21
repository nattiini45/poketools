/**
 * Discord embeds of the draft tool (B-CRON, draft-backend §11.3).
 *
 * Payloads are language-neutral; `lang` is the webhook's language, resolved by
 * `emitAsync` (i18n-core §6.2). Copy comes from `draft/discord` (chrome of the
 * line-aware pick reuses `outbound/discord`), line labels from
 * `localizeLineLabel`, player and league names are shown as stored.
 *
 * A live draft's turn start names the pick time in minutes (`timer_seconds`);
 * slow drafts (turn start and reminders) show the deadline. Deadlines render twice: as Discord timestamp tokens (`<t:…:F>` and
 * `<t:…:R>`, which every reader's client shows in their own zone and
 * language) and as one league-zone line for readers outside Discord's
 * renderer (previews, bridges).
 */
import type {
  DiscordEventData,
  DiscordEventPayload,
  DraftAdminAlertData,
  DraftPickData,
  DraftRedraftPublishedData,
  DraftTurnData,
  DraftTurnReminderData,
  WebhookFormatOptions,
} from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import { LEAGUE_TIME_ZONE, type Locale } from '@/i18n/config';
import { createTranslator } from '@/i18n/core';
import { createFormatter } from '@/i18n/format';
import { draftDiscordMessages } from '@/i18n/messages/draft/discord';
import { outboundDiscordMessages } from '@/i18n/messages/outbound/discord';
import { localizeLineLabel } from '@/lib/pkmn/i18n/names/species';
import type { BuildEmbedResult } from './embeds';

const COLORS = {
  blue: 0x5865f2, // turn started, pick
  yellow: 0xfee75c, // reminder
  red: 0xed4245, // admin alert
  purple: 0x9b59b6, // redraft reveal
} as const;

/** Discord's embed description limit is 4096; keep a margin. */
const MAX_DESCRIPTION = 4000;

/** The event data shapes `buildDraftEmbed` renders. */
export type DraftEmbedData =
  | DraftTurnData
  | DraftTurnReminderData
  | DraftAdminAlertData
  | DraftRedraftPublishedData
  | (DraftPickData & { line: NonNullable<DraftPickData['line']> });

/** True for the data shapes `buildDraftEmbed` renders (a `draft_pick` only when it carries `line`). */
export function isDraftEmbedData(data: DiscordEventData): data is DraftEmbedData {
  switch (data.kind) {
    case 'draft_turn':
    case 'draft_turn_reminder':
    case 'draft_admin_alert':
    case 'draft_redraft_published':
      return true;
    case 'draft_pick':
      return data.line !== undefined;
    default:
      return false;
  }
}

/** `<t:unix:F>` / `<t:unix:R>`; null for an unparseable instant. */
export function discordTimestamps(iso: string): { full: string; relative: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const unix = Math.floor(ms / 1000);
  return { full: `<t:${unix}:F>`, relative: `<t:${unix}:R>` };
}

function deadlineLines(iso: string, lang: Locale): string[] {
  const stamps = discordTimestamps(iso);
  if (!stamps) return [];
  const t = createTranslator(draftDiscordMessages, lang);
  const format = createFormatter({ locale: lang, timeZone: LEAGUE_TIME_ZONE });
  return [
    t('deadline.line', { discordTime: stamps.full, relative: stamps.relative }),
    t('deadline.league', {
      time: format.instant(iso, 'weekdayDateTime'),
      zone: format.zoneLabel(new Date(iso)),
    }),
  ];
}

/**
 * A live draft's turn start names the pick time (the slot's `timer_seconds`) instead of a deadline date: the
 * clock is minutes long. Whole minutes read as minutes; anything else (a 90 s timer) as seconds, so the
 * number is never rounded into a wrong promise.
 */
function pickTimeLine(timerSeconds: number, lang: Locale): string[] {
  if (!Number.isFinite(timerSeconds) || timerSeconds <= 0) return [];
  const t = createTranslator(draftDiscordMessages, lang);
  const seconds = Math.round(timerSeconds);
  return seconds % 60 === 0
    ? [t('pickTime.minutes', { count: seconds / 60 })]
    : [t('pickTime.seconds', { count: seconds })];
}

function turnFields(data: DraftTurnData | DraftTurnReminderData, lang: Locale) {
  const t = createTranslator(draftDiscordMessages, lang);
  const fields = [
    { name: t('slot.round'), value: String(data.round), inline: true },
    { name: t('slot.pick'), value: String(data.pick_number), inline: true },
  ];
  if (data.is_makeup) fields.push({ name: t('slot.makeup'), value: '✓', inline: true });
  return fields;
}

/**
 * Build the embed (+ optional @mention content) of a draft-tool event.
 * `embeds.ts#buildEmbed` delegates here for the four draft events and for a
 * `draft_pick` that carries `line`. Throws for any other event (a caller bug).
 */
export function buildDraftEmbed(
  payload: DiscordEventPayload,
  options: WebhookFormatOptions | undefined,
  lang: Locale,
): BuildEmbedResult {
  const { data } = payload;
  if (!isDraftEmbedData(data)) {
    throw new Error(`buildDraftEmbed: not a draft embed (${data.kind})`);
  }
  const opts = options ?? DEFAULT_FORMAT_OPTIONS;
  const t = createTranslator(draftDiscordMessages, lang);
  const timestamp = new Date().toISOString();

  switch (data.kind) {
    case 'draft_turn': {
      // Live: the pick time in minutes; slow: the deadline (Discord timestamps + league time).
      const when =
        data.mode === 'live' ? pickTimeLine(data.timer_seconds, lang) : deadlineLines(data.deadline_at, lang);
      const description = [t('turnStarted.body', { player: data.player_name }), '', ...when];
      return {
        embed: {
          title: t('turnStarted.title', { season: data.season_name }),
          description: description.join('\n'),
          color: COLORS.blue,
          fields: turnFields(data, lang),
          timestamp,
        },
        // The product decision asks for the ping; webhooks opt out through `event_filter`.
        ...(data.player_discord_id ? { content: `<@${data.player_discord_id}>` } : {}),
      };
    }

    case 'draft_turn_reminder': {
      const description = [t('turnReminder.body', { player: data.player_name }), '', ...deadlineLines(data.deadline_at, lang)];
      return {
        embed: {
          title: t('turnReminder.title', { threshold: t(`threshold.${data.threshold}`), season: data.season_name }),
          description: description.join('\n'),
          color: COLORS.yellow,
          fields: turnFields(data, lang),
          timestamp,
        },
        ...(data.player_discord_id ? { content: `<@${data.player_discord_id}>` } : {}),
      };
    }

    case 'draft_admin_alert':
      // Never pings: the alert is for the league's admins, not the player.
      return {
        embed: {
          title: t('adminAlert.title', { season: data.season_name }),
          description:
            data.alert_kind === 'blocked'
              ? t('adminAlert.blocked', { player: data.player_name })
              : t('adminAlert.inplaceTimeout', { player: data.player_name }),
          color: COLORS.red,
          timestamp,
        },
      };

    case 'draft_redraft_published': {
      const lines = data.drops.map((d) =>
        t('redraft.dropLine', {
          player: d.player_name,
          line: localizeLineLabel(d.base, d.stage3, lang),
          count: d.transferred_real_kills,
        }),
      );
      const description = lines.length > 0 ? lines.join('\n') : t('redraft.none');
      return {
        embed: {
          title: t('redraft.title', { season: data.season_name }),
          description: description.slice(0, MAX_DESCRIPTION),
          color: COLORS.purple,
          timestamp,
        },
      };
    }

    case 'draft_pick': {
      // Same layout as the legacy pick embed (`outbound/discord` chrome), with the localized line label.
      const o = createTranslator(outboundDiscordMessages, lang);
      const result: BuildEmbedResult = {
        embed: {
          title: o('draftPick.title', { season: data.season_name }),
          description: t('pick.lineDescription', {
            player: data.player_name,
            line: localizeLineLabel(data.line.base, data.line.stage3, lang),
          }),
          color: COLORS.blue,
          fields: [
            { name: o('draftPick.round'), value: String(data.round), inline: true },
            { name: o('draftPick.pickNumber'), value: String(data.pick_number), inline: true },
          ],
          timestamp,
        },
      };
      if (opts.ping_next_drafter && data.next_picker_discord_id) {
        result.content = `<@${data.next_picker_discord_id}> ${o('draftPick.upNext')}`;
      }
      if (data.next_picker_name) {
        result.embed.footer = { text: o('draftPick.nextPick', { name: data.next_picker_name }) };
      }
      return result;
    }

    default: {
      const _exhaustive: never = data;
      return _exhaustive;
    }
  }
}
