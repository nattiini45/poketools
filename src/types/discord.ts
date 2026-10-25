// ── Discord Webhook Notification Types ──────────────────────────────
import type { Locale } from '@/i18n/config';
import type { AchievementTier } from './achievement';
import type { DraftPickOrder, DraftPricing } from './draft';

export type WebhookScopeType = 'season' | 'tournament' | 'global';

/**
 * The language a webhook posts in (i18n-core §6.2): `'league'` follows the
 * league's content language (`seasons.language`, resolved per event by
 * `emitAsync`); `'de'` / `'en'` force one. Stored inside `format_options`.
 */
export type WebhookLanguage = 'league' | Locale;

// ── Format options (per-webhook message customization) ─────────────

export interface WebhookFormatOptions {
  /**
   * Embed language; `'league'` (or absent, as in rows stored before the
   * option existed) follows the league's content language.
   */
  language?: WebhookLanguage;
  /** Wrap match results (winner, score, KOs) in Discord ||spoiler|| tags */
  spoiler_results: boolean;
  /** Include per-game Pokémon KO breakdown in match result embeds */
  show_pokemon_details: boolean;
  /** Include replay link in match result embeds */
  show_replay_link: boolean;
  /** @mention the next drafter when a draft pick is made */
  ping_next_drafter: boolean;
  /** Attach a spoiler-tagged PNG match highlight card on confirmed results */
  attach_match_card: boolean;
  /** Show achievement unlock notifications */
  show_achievements: boolean;
  /** Show streak milestone/broken notifications */
  show_streaks: boolean;
  /** Show rating milestone notifications */
  show_ratings: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: WebhookFormatOptions = {
  language: 'league',
  spoiler_results: true,
  show_pokemon_details: true,
  show_replay_link: true,
  ping_next_drafter: false,
  attach_match_card: true,
  show_achievements: true,
  show_streaks: true,
  show_ratings: true,
};

// ── Webhook entity ─────────────────────────────────────────────────

export interface DiscordWebhook {
  id: string;
  scope_type: WebhookScopeType;
  scope_id: string | null;
  webhook_url: string;
  label: string;
  enabled: boolean;
  event_filter: DiscordEventType[];
  format_options: WebhookFormatOptions;
  created_at: string;
  updated_at: string;
}

/**
 * A webhook as the admin API returns it: the secret URL is write-only, so the
 * response carries a masked hint instead (`webhookUrlHint`).
 */
export type DiscordWebhookView = Omit<DiscordWebhook, 'webhook_url'> & { webhook_url_hint: string };

export type DiscordEventType =
  | 'match_result_submitted'
  | 'match_confirmed'
  | 'match_disputed'
  | 'round_generated'
  | 'tournament_started'
  | 'tournament_completed'
  | 'season_advanced'
  | 'draft_pick_made'
  | 'draft_completed'
  | 'achievement_unlocked'
  | 'streak_milestone'
  | 'streak_broken'
  | 'rating_milestone'
  | 'round_completed'
  | 'round_recap_published'
  | 'round_forecast_published'
  // Draft-tool events. T17 adds the names so the
  // manager UIs can offer them as filters; B-CRON appends their data shapes
  // to `DiscordEventData` and their `case` lines to `buildEmbed`.
  | 'draft_turn_started'
  | 'draft_turn_reminder'
  | 'draft_slot_blocked'
  | 'draft_redraft_published';

/**
 * Payload passed to emitDiscordEvent().
 * Each event carries a tournament_id (for webhook resolution) plus
 * event-specific data used to build the Discord embed.
 */
export interface DiscordEventPayload {
  event_type: DiscordEventType;
  tournament_id: string;
  season_id: string | null;
  data: DiscordEventData;
}

// ── Per-event data shapes ──────────────────────────────────────────

export type DiscordEventData =
  | MatchResultData
  | MatchConfirmedData
  | MatchDisputedData
  | RoundGeneratedData
  | TournamentStatusData
  | SeasonAdvancedData
  | DraftPickData
  | DraftCompletedData
  | AchievementUnlockedData
  | StreakMilestoneData
  | StreakBrokenData
  | RatingMilestoneData
  | RoundCompletedData
  | RoundRecapPublishedData
  | RoundForecastPublishedData
  | DraftTurnData
  | DraftTurnReminderData
  | DraftAdminAlertData
  | DraftRedraftPublishedData;

/** Per-game Pokémon stats passed through to Discord embeds */
export interface GamePokemonStats {
  game_number: number;
  winner_id: string | null;
  players: {
    player_id: string;
    player_name: string;
    pokemon: {
      pokemon_name: string;
      kos_dealt: number;
      was_koed: boolean;
    }[];
  }[];
}

export interface MatchResultData {
  kind: 'match_result';
  player_1_name: string;
  player_2_name: string;
  winner_name: string;
  game_score: string;       // e.g. "2-1"
  replay_url?: string;
  tournament_name: string;
  round_name: string;
  game_stats?: GamePokemonStats[];
}

export interface MatchConfirmedData {
  kind: 'match_confirmed';
  player_1_name: string;
  player_2_name: string;
  player_1_avatar_url?: string | null;
  player_2_avatar_url?: string | null;
  winner_name: string;
  game_score: string;
  replay_url?: string;
  tournament_name: string;
  format?: string;
  game_stats?: GamePokemonStats[];
}

export interface MatchDisputedData {
  kind: 'match_disputed';
  player_1_name: string;
  player_2_name: string;
  disputer_name: string;
  tournament_name: string;
}

export interface RoundGeneratedData {
  kind: 'round_generated';
  tournament_name: string;
  round_name: string;
  pairings: Array<{ player_1_name: string; player_2_name: string }>;
}

export interface TournamentStatusData {
  kind: 'tournament_status';
  tournament_name: string;
  new_status: 'active' | 'completed';
}

export interface SeasonAdvancedData {
  kind: 'season_advanced';
  season_name: string;
  source_stage: string;
  target_stage: string;
  advanced_count: number;
  summary: string;
}

export interface DraftPickData {
  kind: 'draft_pick';
  player_name: string;
  pokemon_name: string;
  pick_number: number;
  round: number;
  season_name: string;
  /** Name of the next player to pick (if draft is not complete) */
  next_picker_name?: string;
  /** Discord user ID of the next picker (for @mention pings) */
  next_picker_discord_id?: string;
  /**
   * Queue-engine picks: the picked line as canonical English names. When
   * set, the embed shows the localized line label
   * (`buildDraftEmbed`) instead of `pokemon_name`.
   */
  line?: { base: string; stage3: string | null };
}

export interface DraftCompletedData {
  kind: 'draft_completed';
  season_name: string;
  /** English fallback name; the embed shows `pool_format` in the webhook's language when set. */
  pool_name: string;
  /** The pool's turn order and pricing (`poolFormat`, `src/lib/draft/pool-format.ts`). */
  pool_format?: { order: DraftPickOrder; pricing: DraftPricing };
}

export interface AchievementUnlockedData {
  kind: 'achievement_unlocked';
  /**
   * `achievement_definitions.key`: when set, the embed shows the catalog text
   * in the webhook's language (`achievementText`); otherwise the DB name and
   * description below.
   */
  achievement_key?: string;
  player_name: string;
  achievement_name: string;
  achievement_tier: AchievementTier;
  achievement_icon: string | null;
  achievement_description: string;
  tournament_name: string;
}

export interface StreakMilestoneData {
  kind: 'streak_milestone';
  player_name: string;
  streak_type: 'win' | 'ko' | 'flawless';
  streak_count: number;
  tournament_name: string;
}

export interface StreakBrokenData {
  kind: 'streak_broken';
  breaker_name: string;
  broken_player_name: string;
  streak_count: number;
  tournament_name: string;
}

/** Rating thresholds that fire a `rating_milestone` event (1600/1700/1800/1900). */
export type RatingMilestoneThreshold = 'rising_star' | 'ace_trainer' | 'elite_four' | 'champion_tier';

export interface RatingMilestoneData {
  kind: 'rating_milestone';
  player_name: string;
  new_rating: number;
  /**
   * Threshold key, translated at render (`ratingMilestone.threshold.*` in
   * outbound/discord). Absent on payloads queued before the key existed.
   */
  threshold?: RatingMilestoneThreshold;
  /** Legacy English threshold name; read only when `threshold` is absent. */
  threshold_name?: string;
  tournament_name: string;
}

export interface RoundCompletedData {
  kind: 'round_completed';
  tournament_name: string;
  round_name: string;
  round_number: number;
  /** One entry per completed match in this round */
  match_results: Array<{
    player_1_name: string;
    player_2_name: string;
    /** Game wins, e.g. "2:1" */
    score: string;
    winner_name: string | null;
  }>;
  /** Current standings after this round completes */
  standings: Array<{
    position: number;
    player_name: string;
    wins: number;
    losses: number;
    draws: number;
    points: number;
    /** Position change since previous round: positive = moved up, negative = moved down, 0 = unchanged, null = first round */
    position_change: number | null;
  }>;
}

// ── Draft-tool event data ─────────────────────────────────────────
// Language-neutral: no locale, no pre-rendered labels. Pokémon names travel as
// canonical English; `buildDraftEmbed` localizes them per webhook.

/** `draft_turn_started`: a live- or slow-draft slot became active (sent once per activation). */
export interface DraftTurnData {
  kind: 'draft_turn';
  season_name: string;
  player_name: string;
  /** Pinged in the message content when present. */
  player_discord_id?: string;
  /** ISO instant the pick clock runs out. */
  deadline_at: string;
  timer_seconds: number;
  mode: 'live' | 'slow';
  round: number;
  pick_number: number;
  is_makeup: boolean;
}

/** `draft_turn_reminder`: the slot crossed the 8 h / 4 h / 1 h mark before its deadline. */
export interface DraftTurnReminderData extends Omit<DraftTurnData, 'kind'> {
  kind: 'draft_turn_reminder';
  threshold: '8h' | '4h' | '1h';
}

/** `draft_slot_blocked`: a slot needs an admin (blocked budget, or an in-place timeout). Never pings. */
export interface DraftAdminAlertData {
  kind: 'draft_admin_alert';
  season_name: string;
  player_name: string;
  alert_kind: 'blocked' | 'inplace_timeout';
}

/** `draft_redraft_published`: the secret redraft drops were revealed. */
export interface DraftRedraftPublishedData {
  kind: 'draft_redraft_published';
  season_name: string;
  drops: { player_name: string; base: string; stage3: string | null; transferred_real_kills: number }[];
}

// ── AI Reporter event data ─────────────────────────────────────────

export interface RoundRecapPublishedData {
  kind: 'round_recap_published';
  tournament_name: string;
  round_name: string;
  headline: string;
  match_summaries: { players: string; score: string; one_liner: string }[];
  meta_trends: string;
  player_spotlight: { player_name: string; reason: string };
  tournament_url: string;
}

export interface RoundForecastPublishedData {
  kind: 'round_forecast_published';
  tournament_name: string;
  round_name: string;
  headline: string;
  matchup_previews: { players: string; storyline: string }[];
  bold_prediction: string;
  tournament_url: string;
}

// ── Webhook input types for CRUD ───────────────────────────────────

export interface CreateWebhookInput {
  scope_type: WebhookScopeType;
  scope_id: string | null;
  webhook_url: string;
  label: string;
  event_filter?: DiscordEventType[];
  format_options?: Partial<WebhookFormatOptions>;
}

export interface UpdateWebhookInput {
  webhook_url?: string;
  label?: string;
  enabled?: boolean;
  event_filter?: DiscordEventType[];
  format_options?: Partial<WebhookFormatOptions>;
}
