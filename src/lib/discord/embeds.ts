import type { DiscordEventPayload, WebhookFormatOptions, GamePokemonStats, RoundRecapPublishedData, RoundForecastPublishedData } from '@/types/discord';
import { DEFAULT_FORMAT_OPTIONS } from '@/types/discord';
import type { Locale } from '@/i18n/config';
import { createTranslator, type Translator } from '@/i18n/core';
import { achievementText } from '@/i18n/content/achievements';
import { translateEngineLabel } from '@/i18n/content/engine-labels';
import { outboundDiscordMessages } from '@/i18n/messages/outbound/discord';
import { localizeSpecies } from '@/lib/pkmn/i18n/names/species';
import { buildDraftEmbed } from './draft-embeds';
import type { DiscordEmbed } from './notify';
import type { DraftPickOrder, DraftPricing } from '@/types/draft';

type DiscordT = Translator<typeof outboundDiscordMessages.en>;

// Discord embed color constants (decimal)
const COLORS = {
  green: 0x57f287,   // success: match confirmed, tournament complete
  blue: 0x5865f2,    // info: round generated, draft pick
  yellow: 0xfee75c,  // warning: match disputed
  red: 0xff0000,     // streak broken
  purple: 0x9b59b6,  // special: season advanced
  orange: 0xe67e22,   // match result submitted (pending confirmation)
  bronze: 0xcd7f32,
  silver: 0xc0c0c0,
  gold: 0xffd700,
} as const;

/** A pool's turn order and pricing as one label in `lang` (the `draft_completed` embed's `{pool}`). */
export function draftPoolFormatLabel(format: { order: DraftPickOrder; pricing: DraftPricing }, lang: Locale): string {
  const t = createTranslator(outboundDiscordMessages, lang);
  return t('draftCompleted.format', {
    order: t(`draftCompleted.order.${format.order}`),
    pricing: t(`draftCompleted.pricing.${format.pricing}`),
  });
}

/** Result from buildEmbed — embed + optional top-level content for @mentions */
export interface BuildEmbedResult {
  embed: DiscordEmbed;
  /** Top-level message content (outside embed). Used for Discord @mentions which only ping from content, not embeds. */
  content?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Wrap text in Discord spoiler tags if enabled */
function spoiler(text: string, enabled: boolean): string {
  return enabled ? `||${text}||` : text;
}

/** Stored round names are English engine labels ("Round 3", "Grand Finals"); admin-typed names pass through. */
function roundLabel(name: string, lang: Locale): string {
  return translateEngineLabel('round', name, lang);
}

/** Render per-game Pokémon KO breakdown for match embeds.
 *  Format: each Pokémon on its own line, KO count or X for fainted.
 *  Example:
 *    Player1:
 *    Rizeros X
 *    Lumispross 1
 */
function renderGameStats(
  gameStats: GamePokemonStats[],
  useSpoilers: boolean,
  t: DiscordT,
  lang: Locale,
): string {
  return gameStats.map((game) => {
    const lines: string[] = gameStats.length > 1
      ? [t('gameHeader', { n: game.game_number })]
      : [];
    for (const player of game.players) {
      if (player.pokemon.length === 0) continue;
      lines.push(`${player.player_name}:`);
      // Sort to match match-card-image ordering: most KOs first, survivors before fainted
      const sorted = [...player.pokemon].sort((a, b) => {
        if (b.kos_dealt !== a.kos_dealt) return b.kos_dealt - a.kos_dealt;
        return a.was_koed === b.was_koed ? 0 : a.was_koed ? 1 : -1;
      });
      for (const p of sorted) {
        // KOs first, (X) suffix if fainted
        const kos = String(p.kos_dealt);
        const stat = p.was_koed ? `${kos} (X)` : kos;
        lines.push(`${localizeSpecies(p.pokemon_name, lang)} ${stat}`);
      }
      lines.push(''); // blank line between players
    }
    // Remove trailing blank line
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const block = lines.join('\n');
    return spoiler(block, useSpoilers);
  }).join('\n\n');
}

function achievementColor(tier: 'bronze' | 'silver' | 'gold' | 'platinum'): number {
  if (tier === 'bronze') return COLORS.bronze;
  if (tier === 'silver') return COLORS.silver;
  return COLORS.gold;
}

// ── Main builder ─────────────────────────────────────────────────────

/**
 * Build a Discord rich embed (+ optional content) from an event payload.
 * Each event type produces a distinct embed layout.
 * Format options control spoilers, Pokémon details, replay links, and draft pings.
 *
 * `lang` is the webhook's language, resolved by `emitAsync` (i18n-core §6.2):
 * the copy comes from `outbound/discord`, round names from
 * `translateEngineLabel`, achievements from `achievementText`, and Pokémon
 * names from the pkmn layer (payloads carry canonical English names).
 * Player, tournament and league names and AI-written report text are shown as
 * stored.
 */
export function buildEmbed(
  payload: DiscordEventPayload,
  options: WebhookFormatOptions | undefined,
  lang: Locale,
): BuildEmbedResult {
  const { data } = payload;
  const opts = options ?? DEFAULT_FORMAT_OPTIONS;
  const t = createTranslator(outboundDiscordMessages, lang);

  switch (data.kind) {
    case 'match_result': {
      // Score line: "Player1 1:2 Player2"
      const scoreLine = spoiler(
        `**${data.player_1_name}** ${data.game_score.replace('-', ':')} **${data.player_2_name}**`,
        opts.spoiler_results,
      );

      let description = `${roundLabel(data.round_name, lang)}\n\n${scoreLine}`;

      if (data.replay_url && opts.show_replay_link) {
        description += `\n[${t('watchReplay')}](${data.replay_url})`;
      }

      if (data.game_stats?.length && opts.show_pokemon_details) {
        description += '\n\n' + renderGameStats(data.game_stats, opts.spoiler_results, t, lang);
      }

      return {
        embed: {
          title: t('matchResult.title', { tournament: data.tournament_name }),
          description,
          color: COLORS.orange,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'match_confirmed': {
      const scoreLine = spoiler(
        `**${data.player_1_name}** ${data.game_score.replace('-', ':')} **${data.player_2_name}**`,
        opts.spoiler_results,
      );

      let description = scoreLine;

      if (data.replay_url && opts.show_replay_link) {
        description += `\n[${t('watchReplay')}](${data.replay_url})`;
      }

      if (data.game_stats?.length && opts.show_pokemon_details) {
        description += '\n\n' + renderGameStats(data.game_stats, opts.spoiler_results, t, lang);
      }

      return {
        embed: {
          title: t('matchConfirmed.title', { tournament: data.tournament_name }),
          description,
          color: COLORS.green,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'match_disputed':
      return {
        embed: {
          title: t('matchDisputed.title', { tournament: data.tournament_name }),
          description: t('matchDisputed.description', {
            disputer: data.disputer_name,
            player1: data.player_1_name,
            player2: data.player_2_name,
          }),
          color: COLORS.yellow,
          timestamp: new Date().toISOString(),
        },
      };

    case 'round_generated': {
      const pairingLines = data.pairings
        .map((p) => t('roundGenerated.pairing', { player1: p.player_1_name, player2: p.player_2_name }))
        .join('\n');
      return {
        embed: {
          title: t('roundGenerated.title', {
            round: roundLabel(data.round_name, lang),
            tournament: data.tournament_name,
          }),
          description: `${t('roundGenerated.description', { count: data.pairings.length })}\n\n${pairingLines}`,
          color: COLORS.blue,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'tournament_status': {
      const active = data.new_status === 'active';
      return {
        embed: {
          title: active
            ? t('tournamentStarted.title', { tournament: data.tournament_name })
            : t('tournamentCompleted.title', { tournament: data.tournament_name }),
          description: active
            ? t('tournamentStarted.description', { tournament: data.tournament_name })
            : t('tournamentCompleted.description', { tournament: data.tournament_name }),
          color: active ? COLORS.blue : COLORS.green,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'season_advanced':
      return {
        embed: {
          title: t('seasonAdvanced.title', { season: data.season_name }),
          description: `${t('seasonAdvanced.description', {
            count: data.advanced_count,
            source: data.source_stage,
            target: data.target_stage,
          })}\n\n${data.summary}`,
          color: COLORS.purple,
          timestamp: new Date().toISOString(),
        },
      };

    case 'draft_pick': {
      // Queue-engine picks carry the line (canonical English); the draft builder localizes it.
      if (data.line) return buildDraftEmbed(payload, opts, lang);
      const result: BuildEmbedResult = {
        embed: {
          title: t('draftPick.title', { season: data.season_name }),
          description: t('draftPick.description', {
            player: data.player_name,
            pokemon: localizeSpecies(data.pokemon_name, lang),
          }),
          color: COLORS.blue,
          fields: [
            { name: t('draftPick.round'), value: String(data.round), inline: true },
            { name: t('draftPick.pickNumber'), value: String(data.pick_number), inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      };

      // @mention the next drafter if enabled and data is available
      if (opts.ping_next_drafter && data.next_picker_discord_id) {
        result.content = `<@${data.next_picker_discord_id}> ${t('draftPick.upNext')}`;
      }
      if (data.next_picker_name) {
        result.embed.footer = { text: t('draftPick.nextPick', { name: data.next_picker_name }) };
      }

      return result;
    }

    case 'draft_completed':
      return {
        embed: {
          title: t('draftCompleted.title', { season: data.season_name }),
          description: t('draftCompleted.description', {
            pool: data.pool_format ? draftPoolFormatLabel(data.pool_format, lang) : data.pool_name,
          }),
          color: COLORS.green,
          timestamp: new Date().toISOString(),
        },
      };

    case 'achievement_unlocked': {
      const text = data.achievement_key
        ? achievementText(
            { key: data.achievement_key, name: data.achievement_name, description: data.achievement_description },
            lang,
          )
        : { name: data.achievement_name, description: data.achievement_description };
      return {
        embed: {
          title: t('achievementUnlocked.title', { tournament: data.tournament_name }),
          description: `${t('achievementUnlocked.description', {
            icon: data.achievement_icon ?? '🏅',
            player: data.player_name,
            achievement: text.name,
          })}\n${text.description}`,
          color: achievementColor(data.achievement_tier),
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'streak_milestone':
      return {
        embed: {
          title: t('streakMilestone.title', { tournament: data.tournament_name }),
          description: t(`streakMilestone.${data.streak_type}`, {
            player: data.player_name,
            count: data.streak_count,
          }),
          color: COLORS.orange,
          timestamp: new Date().toISOString(),
        },
      };

    case 'streak_broken':
      return {
        embed: {
          title: t('streakBroken.title', { tournament: data.tournament_name }),
          description: t('streakBroken.description', {
            breaker: data.breaker_name,
            player: data.broken_player_name,
            count: data.streak_count,
          }),
          color: COLORS.red,
          timestamp: new Date().toISOString(),
        },
      };

    case 'rating_milestone':
      return {
        embed: {
          title: t('ratingMilestone.title', { tournament: data.tournament_name }),
          description: t('ratingMilestone.description', {
            player: data.player_name,
            // A rating reads as a plain integer ("1523"), never digit-grouped.
            rating: data.new_rating.toFixed(0),
            threshold: data.threshold
              ? t(`ratingMilestone.threshold.${data.threshold}`)
              : (data.threshold_name ?? ''),
          }),
          color: COLORS.purple,
          timestamp: new Date().toISOString(),
        },
      };

    case 'round_completed': {
      // Match results — one line per match, spoilered if enabled
      const resultLines = data.match_results.map((m) => {
        const p1 = m.winner_name === m.player_1_name ? `**${m.player_1_name}**` : m.player_1_name;
        const p2 = m.winner_name === m.player_2_name ? `**${m.player_2_name}**` : m.player_2_name;
        return spoiler(`${p1} ${m.score} ${p2}`, opts.spoiler_results);
      });
      const resultsBlock = resultLines.join('\n');

      // Standings table with position change indicators
      const standingsLines = data.standings.map((s) => {
        let indicator: string;
        if (s.position_change === null) {
          indicator = '   ';
        } else if (s.position_change > 0) {
          indicator = `▲${s.position_change}`.padEnd(3);
        } else if (s.position_change < 0) {
          indicator = `▼${Math.abs(s.position_change)}`.padEnd(3);
        } else {
          indicator = '─  ';
        }
        const record = s.draws > 0
          ? `${s.wins}-${s.losses}-${s.draws}`
          : `${s.wins}-${s.losses}`;
        return `${indicator} ${s.position}. ${s.player_name} (${record}) ${t('roundCompleted.points', { points: s.points })}`;
      });

      // Truncate if we'd exceed Discord's 4096-char embed description limit
      const header = `**${t('roundCompleted.results')}**\n${resultsBlock}\n\n**${t('roundCompleted.standings')}**\n`;
      const MAX_LEN = 3900;
      let standingsBlock: string;
      if (header.length + standingsLines.join('\n').length > MAX_LEN) {
        const lines: string[] = [];
        let len = header.length;
        for (const line of standingsLines) {
          if (len + line.length + 1 > MAX_LEN - 40) {
            lines.push(t('roundCompleted.more', { count: standingsLines.length - lines.length }));
            break;
          }
          lines.push(line);
          len += line.length + 1;
        }
        standingsBlock = lines.join('\n');
      } else {
        standingsBlock = standingsLines.join('\n');
      }

      return {
        embed: {
          title: t('roundCompleted.title', {
            round: roundLabel(data.round_name, lang),
            tournament: data.tournament_name,
          }),
          description: `${header}${standingsBlock}`,
          color: COLORS.green,
          timestamp: new Date().toISOString(),
        },
      };
    }

    case 'round_recap_published': {
      // The recap text is AI-written in the league's language (A7); only the chrome is translated here.
      const recapData = data as RoundRecapPublishedData;
      const matchLines = recapData.match_summaries
        .map((ms) => `${ms.players} (${ms.score}): ${ms.one_liner}`)
        .join('\n');

      const spotlightField = recapData.player_spotlight.player_name
        ? `\n\n**${t('roundRecap.playerSpotlight', { player: recapData.player_spotlight.player_name })}**\n${recapData.player_spotlight.reason}`
        : '';

      const description = [
        `*${recapData.headline}*`,
        '',
        `**${t('roundRecap.matchResults')}**`,
        matchLines,
        spotlightField,
        '',
        `**${t('roundRecap.metaTrends')}**\n${recapData.meta_trends}`,
      ].join('\n');

      return {
        embed: {
          title: t('roundRecap.title', {
            round: roundLabel(recapData.round_name, lang),
            tournament: recapData.tournament_name,
          }),
          description: description.slice(0, 4000),
          color: COLORS.purple,
          timestamp: new Date().toISOString(),
          url: recapData.tournament_url,
        },
      };
    }

    case 'round_forecast_published': {
      const forecastData = data as RoundForecastPublishedData;
      const matchupLines = forecastData.matchup_previews
        .map((mp) => `**${mp.players}**\n${mp.storyline}`)
        .join('\n\n');

      const description = [
        `*${forecastData.headline}*`,
        '',
        `**${t('roundForecast.matchupPreviews')}**`,
        matchupLines,
        '',
        `**${t('roundForecast.boldPrediction')}**\n${forecastData.bold_prediction}`,
      ].join('\n');

      return {
        embed: {
          title: t('roundForecast.title', {
            round: roundLabel(forecastData.round_name, lang),
            tournament: forecastData.tournament_name,
          }),
          description: description.slice(0, 4000),
          color: COLORS.blue,
          timestamp: new Date().toISOString(),
          url: forecastData.tournament_url,
        },
      };
    }

    // Draft-tool events.
    case 'draft_turn':
      return buildDraftEmbed(payload, opts, lang);
    case 'draft_turn_reminder':
      return buildDraftEmbed(payload, opts, lang);
    case 'draft_admin_alert':
      return buildDraftEmbed(payload, opts, lang);
    case 'draft_redraft_published':
      return buildDraftEmbed(payload, opts, lang);

    default: {
      // Exhaustive check — if we missed a kind, TypeScript will flag it
      const _exhaustive: never = data;
      return _exhaustive;
    }
  }
}
