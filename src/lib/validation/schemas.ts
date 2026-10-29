/**
 * Shared Zod validation schemas for PokéTools API routes.
 *
 * Every API request body should be validated through these schemas.
 * They are derived from the domain types in `src/types/` and the
 * database enums in `src/types/database.ts`.
 *
 * Usage:
 *   import { parseReplaySchema } from '@/lib/validation';
 *   const result = parseReplaySchema.safeParse(await request.json());
 *   if (!result.success) return NextResponse.json({ success: false, error: result.error.flatten() }, { status: 400 });
 *   const body = result.data;
 */
import { z } from 'zod';
import { LOCALES } from '@/i18n/config';
import { LEGACY_POINTS_MAX } from '@/lib/draft/points-limits';
import { formatPack } from '@/lib/format-pack';
import type { BroadcastMomentType } from '@/types/broadcast';
import {
  MOMENT_DESCRIPTION_MAX_LENGTH,
  MOMENT_MAX_PER_GAME,
  MOMENT_MAX_TURN,
} from '@/lib/broadcast/moment-limits';

// ─── Field length limits ─────────────────────────────────────────────
// Reused across schemas so magic length literals don't drift out of sync
// with the DB column sizes. Domain-specific caps (cooldowns, counts, etc.)
// stay inline where they diverge from these canonical buckets.

export const FIELD_LIMITS = {
  /** Player / team / ruleset names — `name` columns. */
  NAME: 100,
  /** Titles (library titles, post titles). */
  TITLE: 200,
  /** Free-form description / body text. */
  DESCRIPTION: 500,
  /** Medium-form text (notes, wiki content, cast descriptions). */
  MEDIUM_TEXT: 2000,
  /** Long-form text (notes, analysis bodies, custom rules strings). */
  LONG_TEXT: 5000,
  /** External URLs (webhooks, avatars, pastes). */
  URL: 2000,
  /** Short labels / tags. */
  LABEL: 50,
} as const;

// ─── UUID helpers ────────────────────────────────────────────────────
const uuid = z.string().uuid();

// ─── Database Enums ──────────────────────────────────────────────────
// Sourced from Constants.public.Enums in src/types/database.ts

export const bracketTypeSchema = z.enum(['single_elim', 'double_elim', 'round_robin', 'swiss']);
export const tournamentStatusSchema = z.enum(['upcoming', 'active', 'completed']);
export const matchStatusSchema = z.enum(['scheduled', 'in_progress', 'pending_confirmation', 'completed', 'disputed']);
export const roundStatusSchema = z.enum(['pending', 'active', 'completed']);
export const seasonFormatTypeSchema = z.enum(['singles', 'doubles', 'draft', 'evolution_point_buy', 'custom']);
export const seasonStatusSchema = z.enum(['upcoming', 'active', 'completed']);
/** 3D world theme pick for a league season (`seasons.route_theme`). */
export const routeThemeSchema = z.enum(['auto', 'plaza', 'sakura', 'mountain', 'clouds']);
export const teamVisibilitySchema = z.enum(['hidden_until_match', 'always_public']);
export const gameSourceSchema = z.enum(['ps_replay', 'manual', 'champions']);
export const aggregateScopeSchema = z.enum(['tournament', 'league', 'all_time']);
export const draftPoolStatusSchema = z.enum(['pending', 'in_progress', 'complete']);
/** Legacy pool pricing (`draft_pools.draft_type`): snake = no points, budget = fixed costs, auction = bids. */
export const draftTypeSchema = z.enum(['snake', 'auction', 'budget']);
/** Legacy pool turn order (`draft_pools.pick_order`). */
export const draftPickOrderSchema = z.enum(['snake', 'linear', 'free']);
export const teamImportSourceSchema = z.enum(['pokepastes', 'manual', 'ps_text']);

// ─── Domain Enums ────────────────────────────────────────────────────

export const achievementCategorySchema = z.enum(['combat', 'milestone', 'social', 'rare', 'meta']);
export const achievementTierSchema = z.enum(['bronze', 'silver', 'gold', 'platinum']);
export const wikiEntityTypeSchema = z.enum(['pokemon', 'move', 'item', 'ability', 'tera']);
export const wikiScopeTypeSchema = z.enum(['global', 'tournament', 'league']);
export const webhookScopeTypeSchema = z.enum(['season', 'tournament', 'global']);
export const socialProviderSchema = z.enum(['x', 'threads', 'bluesky']);
export const adminResourceTypeSchema = z.enum(['tournament', 'season']);
export const confirmActionSchema = z.enum(['confirm', 'dispute']);
export const poolModeSchema = z.enum(['tier', 'point_buy', 'combined']);
export const teamSizeModeSchema = z.enum(['exact', 'range']);

/**
 * Content language of a league (`seasons.language`, i18n-core §6.1): the
 * language of text produced without a viewer. Same values as `LOCALES`.
 */
export const contentLanguageSchema = z.enum(LOCALES);
/** Per-webhook language: follow the league's content language, or force one. */
export const webhookLanguageSchema = z.enum(['league', ...LOCALES] as const);

/**
 * Draft-tool Discord events: slow-draft turn pings, the
 * blocked-slot admin alert, and the redraft publish notice. Spread into
 * `discordEventTypeSchema` below; each name is also a member of the
 * `DiscordEventType` union (src/types/discord.ts), which the webhook and social
 * routes rely on when they pass the parsed `event_filter` through.
 */
export const DRAFT_DISCORD_EVENT_TYPES = [
  'draft_turn_started',
  'draft_turn_reminder',
  'draft_slot_blocked',
  'draft_redraft_published',
] as const;

export const discordEventTypeSchema = z.enum([
  'match_result_submitted',
  'match_confirmed',
  'match_disputed',
  'round_generated',
  'tournament_started',
  'tournament_completed',
  'season_advanced',
  'draft_pick_made',
  'draft_completed',
  'achievement_unlocked',
  'streak_milestone',
  'streak_broken',
  'rating_milestone',
  'round_completed',
  'round_recap_published',
  'round_forecast_published',
  ...DRAFT_DISCORD_EVENT_TYPES,
]);

// ─── Pokemon Types (18 standard) ─────────────────────────────────────
export const pokemonTypeSchema = z.enum([
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
]);

// ─── Regex Patterns ──────────────────────────────────────────────────
export const discordWebhookUrlSchema = z.string().regex(
  /^https:\/\/discord\.com\/api\/webhooks\/\d+\/.+$/,
  'Must be a valid Discord webhook URL (https://discord.com/api/webhooks/...)',
);

export const discordIdSchema = z.string().trim().regex(
  /^\d{17,20}$/,
  'Must be a valid Discord snowflake ID',
);

// ─── Player Schemas ──────────────────────────────────────────────────

const playerCreateGuestSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  is_guest: z.literal(true),
  ps_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  champions_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
});

const playerCreateRegisteredSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  discord_id: discordIdSchema,
  is_guest: z.literal(false).optional(),
  ps_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  champions_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
});

/** Admin player creation — registered (discord_id) or guest (name-only). */
export const playerCreateSchema = z.union([
  playerCreateGuestSchema,
  playerCreateRegisteredSchema,
]);

export const playerUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.NAME).optional(),
  discord_id: discordIdSchema.optional(),
  ps_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  champions_username: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  is_admin: z.boolean().optional(),
  is_creator: z.boolean().optional(),
});

// ─── Auth (Email/Password) Schemas ───────────────────────────────────

export const emailSchema = z.string().trim().toLowerCase().email('Must be a valid email address').max(255);

// Max 72: bcrypt truncates beyond 72 bytes
export const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(72);

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  display_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const confirmEmailSchema = z.object({
  token_hash: z.string().trim().min(1).max(500),
});

export const resetPasswordSchema = z.object({
  token_hash: z.string().trim().min(1).max(500),
  password: passwordSchema,
});

export const linkEmailSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const adminPlayerImportModeSchema = z.enum(['insert', 'upsert']).default('insert');

export const adminPlayerImportPlayersSchema = z.object({
  players: z.array(playerCreateRegisteredSchema).min(1).max(200),
  mode: adminPlayerImportModeSchema,
});

export const adminPlayerImportCsvSchema = z.object({
  csv: z.string().trim().min(1).max(100000),
  mode: adminPlayerImportModeSchema,
});

export const adminPlayerImportSchema = z.union([
  adminPlayerImportPlayersSchema,
  adminPlayerImportCsvSchema,
]);

export const adminPlayerDisciplineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('suspend'),
    // ISO 8601 with an explicit offset (`Z` or `+02:00`): a timezone-less
    // string would be read in the server's zone, not the admin's.
    suspended_until: z.string().trim().datetime({ offset: true }).refine((value) => {
      return new Date(value) > new Date();
    }, 'suspended_until must be a future date'),
  }),
  z.object({
    type: z.literal('ban'),
    ban_reason: z.string().trim().min(1).max(1000),
  }),
]);

export const adminExportSchema = z.object({
  resource: z.enum(['players', 'tournaments', 'matches', 'seasons', 'games', 'battle_stats']),
  format: z.enum(['csv', 'json']).default('json'),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
});

export const auditLogQuerySchema = z.object({
  action: z.string().trim().min(1).max(120).optional(),
  actor_id: uuid.optional(),
  actor: z.string().trim().min(1).max(120).optional(),
  resource_type: z.string().trim().min(1).max(120).optional(),
  // The audit `resource_id` column is a uuid: a free-text value would raise a Postgres type error.
  resource_id: z.string().trim().pipe(uuid).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).refine((data) => {
  if (!data.from || !data.to) return true;
  return new Date(data.from) <= new Date(data.to);
}, {
  message: 'from must be before to',
  path: ['from'],
});

export const adminMatchRepairSchema = z.object({
  player_1_id: uuid,
  player_2_id: uuid,
}).refine((data) => data.player_1_id !== data.player_2_id, {
  message: 'Players must be distinct',
  path: ['player_2_id'],
});

export const matchProposalCreateSchema = z.object({
  proposed_at: z.string().datetime(),
  message: z.string().trim().max(1000).optional(),
});

// ─── Tournament Schemas ──────────────────────────────────────────────

/**
 * A best-of series length: an odd integer from 1 to 15 (a series needs a
 * winner). The pickers offer the same list (`BEST_OF_VALUES`,
 * src/lib/tournament/best-of.ts).
 */
export const bestOfSchema = z
  .number()
  .int()
  .min(1)
  .max(15)
  .refine((value) => value % 2 === 1, { message: 'best of must be an odd number' });

/**
 * A best-of that may already be stored on a record: any integer from 1 to 15, even
 * values included (earlier versions accepted them). Only for an update that sends the
 * whole stored form back; the route then refuses an even value that is not the stored one
 * (`newEvenBestOfIssues`, src/lib/tournament/best-of.ts).
 */
const storedBestOfSchema = z.number().int().min(1).max(15);

export const tournamentCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  description: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  season_id: uuid.optional().nullable(),
  bracket_type: bracketTypeSchema,
  ruleset_id: uuid,
  best_of_default: bestOfSchema.default(1),
  bo_overrides: z.record(z.string(), bestOfSchema).optional(),
  is_doubles: z.boolean().default(false),
  team_visibility: teamVisibilitySchema.default('hidden_until_match'),
  stage_order: z.number().int().min(0).optional(),
  bracket_reset_enabled: z.boolean().optional(),
});

export const tournamentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  description: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  bracket_type: bracketTypeSchema.optional(),
  ruleset_id: uuid.optional(),
  best_of_default: bestOfSchema.optional(),
  bo_overrides: z.record(z.string(), bestOfSchema).optional(),
  is_doubles: z.boolean().optional(),
  team_visibility: teamVisibilitySchema.optional(),
  status: tournamentStatusSchema.optional(),
  archived: z.boolean().optional(),
  stage_order: z.number().int().min(0).optional(),
  bracket_reset_enabled: z.boolean().optional(),
});

const advancementRuleSchema = z.object({
  type: z.literal('top_n'),
  count: z.number().int().min(1).max(256),
  per_group: z.boolean(),
});

export const phaseCreateSchema = tournamentCreateSchema
  .omit({ season_id: true })
  .extend({
    advancement_rule: advancementRuleSchema.nullable().optional(),
    insert_at: z.number().int().min(1).optional(),
  });

export const phaseUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  description: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  bracket_type: bracketTypeSchema.optional(),
  ruleset_id: uuid.optional(),
  // The phase form sends the stored best-of back on every save; the route refuses an even
  // value unless it is the stored one.
  best_of_default: storedBestOfSchema.optional(),
  bo_overrides: z.record(z.string(), storedBestOfSchema).optional(),
  is_doubles: z.boolean().optional(),
  team_visibility: teamVisibilitySchema.optional(),
  status: tournamentStatusSchema.optional(),
  advancement_rule: advancementRuleSchema.nullable().optional(),
});

export const phaseDeleteSchema = z.object({
  confirm: z.literal(true),
});

export const phaseReorderSchema = z.object({
  phase_ids: z.array(uuid).min(1).max(64),
});

export const syncStandingsSchema = z.object({
  source_phase_id: z.string().uuid().optional(),
  top_n: z.number().int().min(1).max(256).optional(),
  per_group: z.boolean().optional(),
  force: z.boolean().optional(),
});

export const seasonAdvanceSchema = z.object({
  force: z.boolean().optional(),
});

/** Optional destructive confirmation for reset / regenerate paths. */
export const cascadeActionSchema = z.object({
  cascade: z.boolean().optional(),
});

export const phaseParticipantBulkSchema = z.object({
  player_ids: z.array(uuid).min(1).max(256).optional(),
  enroll_all_roster: z.boolean().optional(),
}).refine(
  (data) => data.enroll_all_roster || (data.player_ids && data.player_ids.length > 0),
  { message: 'Provide player_ids or enroll_all_roster' }
);

export const phaseGroupsCreateSchema = z.object({
  group_count: z.number().int().min(2).max(26),
  serpentine: z.boolean().default(true),
});

export const phaseGroupMemberMoveSchema = z.object({
  player_id: uuid,
  from_group_id: uuid,
  to_group_id: uuid,
  seed: z.number().int().min(0).max(256).optional(),
});

/** One group-row handover as the repair check listed it. */
const phaseGroupsRepairMoveSchema = z.object({
  group_id: uuid,
  from_player_id: uuid,
  to_player_id: uuid,
});

/**
 * `dry_run` is required: an empty body must not apply the repair. An apply
 * names the moves the admin reviewed (the check's plan); it writes only when
 * the fresh plan hands over exactly those rows.
 */
export const phaseGroupsRepairSchema = z.discriminatedUnion('dry_run', [
  z.object({ dry_run: z.literal(true) }),
  z.object({
    dry_run: z.literal(false),
    moves: z.array(phaseGroupsRepairMoveSchema).max(256),
  }),
]);

// ─── Season / League Schemas ─────────────────────────────────────────

export const seasonCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  description: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  format_type: seasonFormatTypeSchema,
  ruleset_id: uuid.optional().nullable(),
  start_date: z.iso.date().optional().nullable(),
  end_date: z.iso.date().optional().nullable(),
  route_theme: routeThemeSchema.optional(),
  language: contentLanguageSchema.optional(),
});

/**
 * Optional "start from an existing league" block of `POST /api/seasons`: the
 * source league and what to copy besides its phases. Both flags default to
 * off, so a bare `{ season_id }` copies the phases only.
 */
export const seasonCloneOptionsSchema = z.object({
  season_id: uuid,
  copy_roster: z.boolean().default(false),
  copy_admins: z.boolean().default(false),
});

/**
 * The `POST /api/seasons` body: the create fields plus the optional clone
 * block. `seasonCreateSchema` stays as it is (PATCH and other callers build
 * on it); the extra key is stripped there.
 */
export const seasonCreateRequestSchema = seasonCreateSchema.extend({
  clone_from: seasonCloneOptionsSchema.optional(),
});

export const seasonUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  description: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  format_type: seasonFormatTypeSchema.optional(),
  ruleset_id: uuid.optional().nullable(),
  start_date: z.iso.date().optional().nullable(),
  end_date: z.iso.date().optional().nullable(),
  status: seasonStatusSchema.optional(),
  archived: z.boolean().optional(),
  core_pool: z.array(z.tuple([pokemonTypeSchema, pokemonTypeSchema, pokemonTypeSchema])).max(816).nullable().optional(),
  point_buy_list_id: uuid.optional().nullable(),
  route_theme: routeThemeSchema.optional(),
  language: contentLanguageSchema.optional(),
});

// ─── Match / Game Schemas ────────────────────────────────────────────

/**
 * The one-row-per-Pokémon key of a game's battle stats, per player. The JS
 * twin of the battle_stats unique index key
 * `lower(regexp_replace(pokemon_name, '^[ws]+|[ws]+$', '', 'g'))`, where [ws]
 * is exactly String.prototype.trim's whitespace set
 * (supabase/migrations/20261021100200_battle_stats_pokemon_key_js_trim.sql).
 */
export function battleStatPokemonKey(pokemonName: string): string {
  return pokemonName.trim().toLowerCase();
}

const pokemonStatSchema = z.object({
  pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  was_brought: z.boolean().default(true),
  was_lead: z.boolean().default(false),
  kos_dealt: z.number().int().min(0).max(6).default(0),
  was_koed: z.boolean().default(false),
  moves_used: z.array(z.string().trim().max(FIELD_LIMITS.LABEL)).max(4).default([]),
  turns_active: z.number().int().min(0).default(0),
});

const playerPokemonStatsSchema = z
  .object({
    player_id: uuid,
    pokemon: z.array(pokemonStatSchema).min(1).max(6),
  })
  .superRefine((block, ctx) => {
    // A team brings each Pokémon once; a repeated row would be written (and
    // counted toward evolution progress) once per copy.
    const seen = new Set<string>();
    block.pokemon.forEach((poke, i) => {
      const key = battleStatPokemonKey(poke.pokemon_name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each Pokémon may appear only once per player',
          path: ['pokemon', i, 'pokemon_name'],
        });
      }
      seen.add(key);
    });
  });

/**
 * One game's per-player stat blocks: at most one block per player of the
 * two-player match. The route flattens every row into battle stats, so a
 * repeated block would multiply that player's recorded KOs and progress.
 */
const gamePokemonStatsSchema = z
  .array(playerPokemonStatsSchema)
  .min(1)
  .max(2)
  .superRefine((blocks, ctx) => {
    const seen = new Set<string>();
    blocks.forEach((block, i) => {
      if (seen.has(block.player_id)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each player may have only one stat block',
          path: [i, 'player_id'],
        });
      }
      seen.add(block.player_id);
    });
  });

export const parseReplaySchema = z.object({
  match_id: uuid,
  replay_url: z.string().trim().min(1).max(500),
});

/**
 * The `broadcast_moments.moment_type` CHECK list (baseline migration), which
 * the tracker's `BroadcastMomentType` union mirrors. A drift test pins both.
 */
export const BROADCAST_MOMENT_TYPES = [
  'turning_point',
  'big_ko',
  'misplay',
  'clutch',
  'highlight',
] as const satisfies readonly BroadcastMomentType[];

/**
 * Upper bound on moments marked in one submitted game. The bounds live in
 * `moment-limits` so the tracker UI enforces the same numbers client-side.
 */
export const MANUAL_RESULT_MAX_MOMENTS = MOMENT_MAX_PER_GAME;
/** Upper bound on a moment's turn number (Showdown ends a battle at turn 1000). */
export const MANUAL_RESULT_MAX_TURN = MOMENT_MAX_TURN;

/**
 * A moment marked in the tracker. Only the moment's own fields: `match_id`,
 * `game_id` and `created_by` are server-owned (the route binds them to the
 * recorded match, game and caller) and zod strips them if a client sends them.
 */
export const manualResultMomentSchema = z.object({
  moment_type: z.enum(BROADCAST_MOMENT_TYPES),
  turn_number: z.number().int().min(0).max(MANUAL_RESULT_MAX_TURN).nullable().optional(),
  description: z.string().trim().max(MOMENT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME).nullable().optional(),
  timestamp: z.iso.datetime({ offset: true }).optional(),
});

export const manualResultSchema = z.object({
  match_id: uuid,
  winner_id: uuid,
  pokemon_stats: gamePokemonStatsSchema,
  screenshot_url: z.string().url().max(500).optional(),
  moments: z.array(manualResultMomentSchema).max(MANUAL_RESULT_MAX_MOMENTS).optional(),
});

/** Admin replay-preview: parse a replay (no username gate) for the manual-assign editor. */
export const replayPreviewSchema = z.object({
  replay_url: z.string().trim().min(1).max(500),
});

/**
 * Admin replay-import: record a game from a replay whose sides an organizer
 * assigns by hand (the username gate is skipped). `match_id` comes from the
 * route param. There is no winner or stats field: the route fetches the replay
 * again and records the winner and stats parsed from it. `side_player_ids` are the players of replay side p1
 * and p2; `replay_hash` is the preview's hash, so a replay that changed since
 * the organizer reviewed it is refused (409 `replay_changed_since_preview`).
 */
export const replayImportSchema = z.object({
  replay_url: z.string().trim().min(1).max(500),
  replay_hash: z.string().regex(/^[0-9a-f]{64}$/),
  side_player_ids: z.tuple([uuid, uuid]),
});

/** Short free-text reason an admin or a player gives for an action on a match. */
export const reasonSchema = z.string().trim().min(1).max(FIELD_LIMITS.DESCRIPTION);

export const confirmMatchSchema = z.object({
  action: confirmActionSchema.default('confirm'),
  winner_id: uuid.optional(),
  notes: z.string().trim().max(FIELD_LIMITS.MEDIUM_TEXT).optional(),
  /** Dispute reason; only valid together with action 'dispute'. */
  reason: reasonSchema.optional(),
}).refine((data) => data.reason === undefined || data.action === 'dispute', {
  message: 'reason is only allowed when disputing a match',
  path: ['reason'],
});

const MATCH_SCHEDULE_MIN_MS = Date.UTC(2000, 0, 1);
const MATCH_SCHEDULE_MAX_MS = Date.UTC(2100, 0, 1);

/** Admin schedule change: an ISO instant with an offset, or null to clear it. */
export const matchScheduleSchema = z.object({
  scheduled_at: z.iso.datetime({ offset: true }).nullable(),
}).refine((data) => {
  if (data.scheduled_at === null) return true;
  const ms = Date.parse(data.scheduled_at);
  return Number.isFinite(ms) && ms >= MATCH_SCHEDULE_MIN_MS && ms < MATCH_SCHEDULE_MAX_MS;
}, {
  message: 'scheduled_at must be between 2000-01-01 and 2100-01-01',
  path: ['scheduled_at'],
});

/** Admin reopen of a match to in_progress; the reason is required. */
export const matchReopenSchema = z.object({
  reason: reasonSchema,
});

/** Match reset: cascade flag plus an optional reason (the admin UI requires it). */
export const matchResetSchema = cascadeActionSchema.extend({
  reason: reasonSchema.optional(),
});

/** Optional body of an admin game delete. */
export const gameDeleteSchema = z.object({
  reason: reasonSchema.optional(),
});

/** Paging of the per-match history; query-string values are coerced. */
export const matchHistoryQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).max(1000).default(0),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── Ruleset Schemas ─────────────────────────────────────────────────

const tierKeySchema = z.enum([
  'ZU', 'PU', 'PUBL', 'NU', 'NUBL', 'RU', 'RUBL',
  'UU', 'UUBL', 'OU', 'Uber', 'AG',
]);

const typeQuotasSchema = z.object({
  source: z.enum(['player_core', 'fixed']),
  fixed_types: z.array(pokemonTypeSchema).optional(),
  min_per_type: z.number().int().min(0).max(6),
  allow_multi_count: z.boolean(),
}).refine(
  (q) => q.source !== 'fixed' || (q.fixed_types && q.fixed_types.length > 0),
  { message: 'fixed_types is required when source = "fixed"', path: ['fixed_types'] },
);

const evolutionStageSchema = z.object({
  mode: z.enum(['unrestricted', 'nfe_only_plus_n_fe']),
  fully_evolved_cap: z.number().int().min(0).max(6).optional(),
  fully_evolved_tier_max: tierKeySchema.optional(),
  legendaries_allowed: z.boolean().optional(),
});

export const teamConstraintsSchema = z.object({
  type_quotas: typeQuotasSchema.optional(),
  tera_match: z.enum(['player_core', 'team_types', 'none']).optional(),
  evolution_stage: evolutionStageSchema.optional(),
  eviolite_tier_cap: tierKeySchema.optional(),
}).strict();

export const rulesetCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  base_format: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  is_doubles: z.boolean().default(false),
  clauses: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  banned_pokemon: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  banned_moves: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  banned_items: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  banned_abilities: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  added_pokemon: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).default([]),
  custom_rules_string: z.string().max(FIELD_LIMITS.LONG_TEXT).default(''),
  min_shared_type_pct: z.number().min(0).max(100).default(0),
  team_constraints: teamConstraintsSchema.nullable().default(null),
});

export const rulesetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  base_format: z.string().trim().min(1).max(FIELD_LIMITS.NAME).optional(),
  is_doubles: z.boolean().optional(),
  clauses: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  banned_pokemon: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  banned_moves: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  banned_items: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  banned_abilities: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  added_pokemon: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  custom_rules_string: z.string().max(FIELD_LIMITS.LONG_TEXT).optional(),
  min_shared_type_pct: z.number().min(0).max(100).optional(),
  team_constraints: teamConstraintsSchema.nullable().optional(),
});

// ─── Achievement Schemas ─────────────────────────────────────────────

export const achievementCreateSchema = z.object({
  key: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  description: z.string().trim().min(1).max(1000),
  icon: z.string().trim().max(FIELD_LIMITS.TITLE).nullable().default(null),
  category: achievementCategorySchema,
  tier: achievementTierSchema,
  repeatable: z.boolean().default(false),
  hidden: z.boolean().default(false),
  criteria: z.record(z.string(), z.unknown()),
});

export const achievementUpdateSchema = z.object({
  key: z.string().trim().min(1).max(FIELD_LIMITS.NAME).optional(),
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  description: z.string().trim().min(1).max(1000).optional(),
  icon: z.string().trim().max(FIELD_LIMITS.TITLE).nullable().optional(),
  category: achievementCategorySchema.optional(),
  tier: achievementTierSchema.optional(),
  repeatable: z.boolean().optional(),
  hidden: z.boolean().optional(),
  criteria: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// ─── Discord Webhook Schemas ─────────────────────────────────────────

export const webhookCreateSchema = z.object({
  scope_type: webhookScopeTypeSchema,
  scope_id: uuid.nullable().default(null),
  webhook_url: discordWebhookUrlSchema,
  label: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  event_filter: z.array(discordEventTypeSchema).optional(),
  format_options: z.object({
    spoiler_results: z.boolean().optional(),
    show_pokemon_details: z.boolean().optional(),
    show_replay_link: z.boolean().optional(),
    ping_next_drafter: z.boolean().optional(),
    attach_match_card: z.boolean().optional(),
    show_achievements: z.boolean().optional(),
    show_streaks: z.boolean().optional(),
    show_ratings: z.boolean().optional(),
    language: webhookLanguageSchema.optional(),
  }).optional(),
}).refine(
  (data) => data.scope_type === 'global' || data.scope_id,
  { message: 'scope_id is required when scope_type is not "global"', path: ['scope_id'] },
);

export const webhookUpdateSchema = z.object({
  webhook_url: discordWebhookUrlSchema.optional(),
  label: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  enabled: z.boolean().optional(),
  event_filter: z.array(discordEventTypeSchema).optional(),
  format_options: z.object({
    spoiler_results: z.boolean().optional(),
    show_pokemon_details: z.boolean().optional(),
    show_replay_link: z.boolean().optional(),
    ping_next_drafter: z.boolean().optional(),
    attach_match_card: z.boolean().optional(),
    show_achievements: z.boolean().optional(),
    show_streaks: z.boolean().optional(),
    show_ratings: z.boolean().optional(),
    language: webhookLanguageSchema.optional(),
  }).optional(),
});

// ─── Social Integration Schemas ──────────────────────────────────────

const xCredentialsSchema = z.object({
  provider: z.literal('x'),
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  user_id: z.string().optional(),
  account_label: z.string().max(FIELD_LIMITS.TITLE).optional(),
});

const threadsCredentialsSchema = z.object({
  provider: z.literal('threads'),
  access_token: z.string().min(1),
  user_id: z.string().min(1),
  account_label: z.string().max(FIELD_LIMITS.TITLE).optional(),
});

const blueskyCredentialsSchema = z.object({
  provider: z.literal('bluesky'),
  handle: z.string().min(1),
  app_password: z.string().min(1),
  service_url: z.string().url().optional(),
});

export const socialCredentialsSchema = z.discriminatedUnion('provider', [
  xCredentialsSchema,
  threadsCredentialsSchema,
  blueskyCredentialsSchema,
]);

export const socialIntegrationCreateSchema = z.object({
  provider: socialProviderSchema,
  scope_type: webhookScopeTypeSchema,
  scope_id: uuid.nullable().optional(),
  label: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  event_filter: z.array(discordEventTypeSchema).optional(),
  post_options: z.object({
    include_replay_link: z.boolean().optional(),
    include_hashtags: z.boolean().optional(),
  }).optional(),
  credentials: socialCredentialsSchema.optional(),
}).refine(
  (data) => data.scope_type === 'global' || data.scope_id,
  { message: 'scope_id is required when scope_type is not "global"', path: ['scope_id'] },
);

export const socialIntegrationUpdateSchema = z.object({
  label: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  enabled: z.boolean().optional(),
  event_filter: z.array(discordEventTypeSchema).optional(),
  post_options: z.object({
    include_replay_link: z.boolean().optional(),
    include_hashtags: z.boolean().optional(),
  }).optional(),
  credentials: socialCredentialsSchema.optional(),
  clear_credentials: z.boolean().optional(),
});

// ─── Wiki Schemas ────────────────────────────────────────────────────

export const wikiNoteCreateSchema = z.object({
  entity_type: wikiEntityTypeSchema,
  entity_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  content: z.string().trim().min(1).max(FIELD_LIMITS.MEDIUM_TEXT),
  scope_type: wikiScopeTypeSchema.optional(),
  scope_id: uuid.optional().nullable(),
});

export const wikiNoteUpdateSchema = z.object({
  content: z.string().trim().min(1).max(FIELD_LIMITS.MEDIUM_TEXT),
});

export const wikiNotePatchSchema = z.object({
  content: z.string().trim().min(1).max(FIELD_LIMITS.MEDIUM_TEXT).optional(),
  approved: z.boolean().optional(),
  rejected: z.boolean().optional(),
  rejection_reason: z.string().trim().min(1).max(FIELD_LIMITS.DESCRIPTION).optional(),
});

/**
 * The superadmin's block / unblock request (`PATCH /api/wiki/notes/[id]`). Strict and alone: it cannot be combined
 * with an edit, an approval or a rejection.
 */
export const wikiNoteBlockResubmissionSchema = z.object({
  block_resubmission: z.boolean(),
}).strict();

export const wikiNoteReportSchema = z.object({
  reason: z.enum(['inaccurate', 'spam', 'abusive', 'off_topic', 'other']),
  details: z.string().trim().max(FIELD_LIMITS.DESCRIPTION).optional(),
});

export const wikiModerationNotesQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const wikiReportStatusSchema = z.enum(['open', 'reviewed', 'dismissed']);

export const wikiReportsQuerySchema = z.object({
  status: wikiReportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const wikiReportUpdateSchema = z.object({
  status: wikiReportStatusSchema,
});

export const wikiSearchSchema = z.object({
  q: z.string().trim().min(2).max(200),
  type: wikiEntityTypeSchema.optional(),
});

// ─── Resource Admin Schemas ──────────────────────────────────────────

export const resourceAdminCreateSchema = z.object({
  resource_type: adminResourceTypeSchema,
  resource_id: uuid,
  player_id: uuid,
});

export const resourceAdminDeleteSchema = z.object({
  resource_type: adminResourceTypeSchema,
  resource_id: uuid,
  player_id: uuid,
});

// ─── Season Participant Schemas ──────────────────────────────────────

/**
 * A 3-type core: exactly three distinct standard Pokémon types.
 * Stored sorted alphabetically so set equality is order-independent.
 */
export const coreTripleSchema = z.tuple([pokemonTypeSchema, pokemonTypeSchema, pokemonTypeSchema])
  .refine(
    (t) => t[0] !== t[1] && t[0] !== t[2] && t[1] !== t[2],
    { message: 'A core must contain three distinct types' },
  );

export const corePoolSchema = z.array(coreTripleSchema).max(816);

export const seasonParticipantAddSchema = z.object({
  player_id: uuid,
});

export const seasonParticipantUpdateSchema = z.object({
  player_id: uuid,
  gym_type: pokemonTypeSchema.nullable().optional(),
  core_types: coreTripleSchema.nullable().optional(),
});

export const seasonParticipantRemoveSchema = z.object({
  player_id: uuid,
});

export const seasonParticipantBulkAddSchema = z.object({
  player_ids: z.array(uuid).min(1).max(50),
});

export const seasonParticipantSubstituteSchema = z.object({
  out_player_id: uuid,
  in_player_id: uuid,
  scope: z.union([z.literal('league'), uuid]),
  dry_run: z.boolean().optional().default(false),
});

export const playerClaimSchema = z.object({
  source_player_id: uuid,
});

// ─── Season Core Pool / Assign Schemas ───────────────────────────────

export const seasonCorePoolUpdateSchema = z.object({
  core_pool: corePoolSchema.nullable(),
});

export const seasonAssignCoresSchema = z.object({
  /** When true, re-roll cores even for participants who already have one. */
  force: z.boolean().default(false),
  /** Optional integer seed for deterministic shuffles (tests, replays). */
  seed: z.number().int().optional(),
});

// ─── Tournament Participant Seeds Schema ──────────────────────────────

export const tournamentParticipantSeedsSchema = z.object({
  seeds: z.array(z.object({
    player_id: uuid,
    seed: z.number().int().min(1).nullable(),
    starting_bracket: z.enum(['winners', 'losers']).optional(),
  })).min(1),
});

// ─── Draft Schemas ───────────────────────────────────────────────────

/**
 * A legacy price (entry `point_cost`, pool `default_point_cost`): bounded like a
 * bid (`LEGACY_POINTS_MAX`), so no accepted price is out of reach of an accepted bid.
 */
const legacyPointCost = z.number().int().min(0).max(LEGACY_POINTS_MAX).nullable().optional();

export const draftPoolTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  description: z.string().max(FIELD_LIMITS.MEDIUM_TEXT).optional().nullable(),
  pool_mode: poolModeSchema,
  entries: z.array(z.object({
    pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
    power_tier: z.string().trim().max(10).nullable().optional(),
    point_cost: legacyPointCost,
  })).min(1),
});

export const draftPickSchema = z.object({
  pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  stage3_pokemon: z.string().trim().min(1).max(FIELD_LIMITS.NAME).nullable().optional(),
});

// ─── Team payload shape (every API boundary that takes a team) ───────

/** A whole-number stat investment with both bounds; a stat left out takes `fallback` (a set under construction). */
const statValue = (max: number, fallback: number) => z.number().int().min(0).max(max).default(fallback);

const evSpreadSchema = z.object({
  hp: statValue(252, 0),
  atk: statValue(252, 0),
  def: statValue(252, 0),
  spa: statValue(252, 0),
  spd: statValue(252, 0),
  spe: statValue(252, 0),
});

const ivSpreadSchema = z.object({
  hp: statValue(31, 31),
  atk: statValue(31, 31),
  def: statValue(31, 31),
  spa: statValue(31, 31),
  spd: statValue(31, 31),
  spe: statValue(31, 31),
});

/**
 * One Pokémon set as the app stores it (`PokemonSet`, `src/types/team.ts`), bounded: strings are capped, EVs run 0 to
 * 252 and IVs 0 to 31 per stat (both bounds, so a negative EV cannot make room for a fifth 252), the level is 1 to 100
 * and a set carries at most four moves. Empty strings are the "unset" value of `item`, `ability`, `nature` and `gender`
 * (the editor creates a blank set with them); `moves` may be empty so the live check can report `min_moves` while a
 * set is being built. Unknown keys are dropped, not stored. The team-sum rules (EV total 510) and the dex rules
 * (is that a move) stay with the validator.
 */
export const pokemonSetSchema = z.object({
  name: z.string().max(FIELD_LIMITS.NAME).default(''),
  species: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  gender: z.enum(['', 'M', 'F', 'N']).default(''),
  item: z.string().max(FIELD_LIMITS.NAME).default(''),
  ability: z.string().max(FIELD_LIMITS.NAME).default(''),
  evs: evSpreadSchema,
  ivs: ivSpreadSchema,
  nature: z.string().max(FIELD_LIMITS.LABEL).default(''),
  level: z.number().int().min(1).max(100).default(100),
  moves: z.array(z.string().max(FIELD_LIMITS.NAME)).max(4),
  shiny: z.boolean().optional(),
  happiness: z.number().int().min(0).max(255).optional(),
  tera_type: z.string().max(FIELD_LIMITS.LABEL).optional(),
});

/** A team: one to six sets. */
export const teamPokemonSchema = z.array(pokemonSetSchema).min(1).max(6);

// ─── Team Validation Schema ──────────────────────────────────────────

export const validateTeamSchema = z.object({
  pokemon: teamPokemonSchema,
  ruleset_id: uuid,
  season_id: uuid.optional(),
  // Optional tournament context. When provided, the API resolves the
  // EFFECTIVE ruleset for that tournament (custom league ruleset takes
  // precedence over the base tier ruleset referenced by tournament.ruleset_id).
  // This prevents the base 'Gen 9 RU' ruleset from being used for tournaments
  // of a league that has a dedicated custom ruleset.
  tournament_id: uuid.optional(),
});

// ─── Pagination Query Schema ─────────────────────────────────────────

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Admin Game Edit Schema ──────────────────────────────────────────

export const adminGameEditSchema = z.object({
  winner_id: uuid.optional(),
  battle_stats: z.array(z.object({
    player_id: uuid,
    pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
    was_brought: z.boolean().optional(),
    was_lead: z.boolean().optional(),
    kos_dealt: z.number().int().min(0).max(6).optional(),
    was_koed: z.boolean().optional(),
    moves_used: z.array(z.string().trim().max(FIELD_LIMITS.LABEL)).max(4).optional(),
    turns_active: z.number().int().min(0).optional(),
  })).superRefine((rows, ctx) => {
    // One row per Pokémon per player (the battle_stats unique index on
    // game_id, player_id and battleStatPokemonKey's DB twin). The edit deletes the
    // game's rows before it inserts these, so a repeat must fail here, before
    // anything is written.
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const key = `${row.player_id}|${battleStatPokemonKey(row.pokemon_name)}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Each Pokémon may appear only once per player',
          path: [i, 'pokemon_name'],
        });
      }
      seen.add(key);
    });
  }).optional(),
  // Optimistic concurrency: the game's updated_at as the editor loaded it (409 admin_game_edit_stale when it moved on).
  expected_updated_at: z.iso.datetime({ offset: true }).optional(),
});

// ─── Utility Schemas ─────────────────────────────────────────────────

export const typeAnalysisSchema = z.object({
  species: z.array(z.string().trim().min(1).max(FIELD_LIMITS.NAME)).min(1),
  gen: z.number().int().min(1).max(9).default(9),
});

export const validateSetSchema = z.object({
  species: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  ability: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  moves: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).max(4).optional(),
});

/** Max characters of team text, whether pasted or fetched from pokepast.es. */
export const IMPORT_TEAM_TEXT_MAX = 50_000;

export const importTeamSchema = z.object({
  text: z.string().max(IMPORT_TEAM_TEXT_MAX).optional(),
  url: z.string().url().max(500).optional(),
  ruleset_id: uuid.optional(),
}).refine((data) => data.text || data.url, {
  message: 'Provide either text or url',
});

export const matchPrepSchema = z.object({
  match_id: uuid,
  pokemon: teamPokemonSchema,
  import_source: teamImportSourceSchema.default('manual'),
  player_id: uuid.optional(),
});

export const bootstrapSchema = z.object({
  secret: z.string().min(1).max(512),
});

export const aiMatchAnalysisSchema = z.object({
  match_id: uuid,
  force: z.boolean().default(false),
});

export const aiMatchPrepSchema = z.object({
  match_id: uuid,
  force: z.boolean().default(false),
});

export const aiTournamentReportSchema = z.object({
  tournament_id: uuid,
  round_id: uuid,
  report_type: z.enum(['round_recap', 'round_forecast', 'season_summary', 'meta_report', 'player_profile']),
  force: z.boolean().default(false),
  player_id: uuid.optional(),
});

// ─── AI Agent Schemas (PRD §7) ───────────────────────────────────────

/** The three v1 agent personas (kept in sync with agent/types.ts). */
export const agentPersonaSchema = z.enum(['kale', 'linden_match_prep', 'linden_teambuilding']);

export const agentChatSchema = z.object({
  messages: z.array(z.object({
    // Clients may only send user/assistant turns; the system prompt is
    // server-owned (injected by the orchestrator/personas), never client-supplied.
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).min(1),
  conversation_id: uuid.optional(),
  persona: agentPersonaSchema.default('linden_teambuilding'),
  context: z.object({
    upcoming_match_id: uuid.optional(),
    format: z.string().optional(),
    team_id: uuid.optional(),
    core_pokemon: z.array(z.string()).max(2).optional(),
    ruleset_id: uuid.optional(),
  }).optional(),
});

/** Match-analysis flavour for the agent analyze-match route (PRD §7). */
export const agentAnalysisTypeSchema = z.enum([
  'opponent_scout',
  'post_match',
  'threat_assessment',
]);

export const agentAnalyzeMatchSchema = z.object({
  match_id: uuid,
  analysis_type: agentAnalysisTypeSchema.default('opponent_scout'),
  // post_match persists a structured analysis; `force` regenerates a cached one.
  force: z.boolean().default(false),
});

/** Report flavour for the agent (Kale) tournament-report route (PRD §8). */
export const agentReportTypeSchema = z.enum(['round_recap', 'round_forecast']);

export const agentTournamentReportSchema = z.object({
  tournament_id: uuid,
  round_id: uuid,
  report_type: agentReportTypeSchema.default('round_recap'),
});

export const agentTeamSchema = z.object({
  format: z.string().trim().min(1),
  core_pokemon: z.array(z.string().min(1)).max(2).optional(),
  requested_items: z.record(z.string(), z.string()).optional(),
  requested_moves: z.record(z.string(), z.array(z.string())).optional(),
  team_size: z.number().int().min(1).max(6).default(6),
  // League legality: gate the build on the real custom ruleset + assigned core.
  ruleset_id: uuid.optional(),
  player_core: z.array(z.string().min(1)).length(3).optional(),
});

/**
 * Agent config update (PRD §7 `POST /api/ai/agent/config`). Shape-validates the
 * payload; the route additionally checks every `model_priority` id against the
 * known `AGENT_MODELS` registry before persisting.
 */
export const agentConfigSchema = z.object({
  model_priority: z.array(z.string().trim().min(1)).min(1).optional(),
  default_persona: agentPersonaSchema.optional(),
}).refine((data) => data.model_priority !== undefined || data.default_persona !== undefined, {
  message: 'Provide model_priority and/or default_persona to update',
});

export const draftPoolCreateSchema = z.object({
  season_id: uuid,
  draft_type: draftTypeSchema,
  /**
   * Omitted = derived from draft_type (snake → snake, auction/budget → free), so older clients keep
   * working. The route refuses auction with a non-free order (`draft_auction_order_not_free`).
   */
  pick_order: draftPickOrderSchema.optional(),
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  budget: z.number().int().min(0).max(LEGACY_POINTS_MAX).optional(),
  /** Legacy budget pools: the price of an entry without its own `point_cost` (null/omitted = 0). */
  default_point_cost: legacyPointCost,
  rounds: z.number().int().min(1).max(50).optional(),
  pool_template_id: uuid.optional(),
}).superRefine((body, ctx) => {
  // Only budget pools price entries; elsewhere a default price would still leak into
  // point estimates (the teambuilder folds it in whenever the pool has a budget).
  if (body.default_point_cost != null && body.draft_type !== 'budget') {
    ctx.addIssue({
      code: 'custom',
      path: ['default_point_cost'],
      message: `only budget drafts take a default price (got draft_type ${body.draft_type})`,
    });
    return;
  }
  // A default price above the budget would make every unpriced entry unaffordable.
  if (body.default_point_cost != null && body.budget != null && body.default_point_cost > body.budget) {
    ctx.addIssue({
      code: 'custom',
      path: ['default_point_cost'],
      message: `must not exceed budget (${body.budget})`,
    });
  }
});

export const draftPoolUpdateSchema = z.object({
  status: draftPoolStatusSchema,
});

export const draftTierLimitsSchema = z.object({
  season_id: uuid,
  limits: z.array(z.object({
    power_tier: z.string().trim().min(1).max(10),
    max_picks: z.number().int().min(0),
  })).min(1),
});

export const draftPoolEntryCreateSchema = z.object({
  season_id: uuid,
  pokemon_name: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  power_tier: z.string().trim().max(10).nullable().optional(),
  point_cost: legacyPointCost,
});

export const draftPoolEntryUpdateSchema = z.object({
  power_tier: z.string().trim().max(10).nullable().optional(),
  point_cost: legacyPointCost,
});

export const evolutionCreateSchema = z.object({
  season_id: uuid,
  base_pokemon: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  stage2_kos: z.number().int().min(0).optional(),
  stage3_kos: z.number().int().min(0).optional(),
  power_tier: z.string().trim().max(10).nullable().optional(),
});

export const evolutionUpdateSchema = z.object({
  stage2_kos: z.number().int().min(0).optional(),
  stage3_kos: z.number().int().min(0).optional(),
  power_tier: z.string().trim().max(10).nullable().optional(),
});

export const roundUpdateSchema = z.object({
  status: roundStatusSchema.optional(),
  best_of: bestOfSchema.optional(),
  // ISO 8601 with an explicit offset (`Z` or `+02:00`): a timezone-less string
  // would be read in the server's zone, not the admin's. `null` clears it.
  deadline: z.string().trim().datetime({ offset: true }).nullable().optional(),
}).refine(
  (data) => data.status !== undefined || data.best_of !== undefined || data.deadline !== undefined,
  { message: 'Provide status, best_of and/or deadline to update' },
);

/**
 * Optional JSON body of the three generate routes (generate-round, generate-all-rounds, generate-bracket).
 * `start_round` starts the lowest-numbered round that call created; omitted or false leaves it pending.
 */
export const generateRoundOptionsSchema = z.object({
  start_round: z.boolean().optional(),
}).strict();

export const broadcastMomentSchema = z.object({
  match_id: uuid,
  // The DB CHECK's set (broadcast_moments_moment_type_check), shared with the manual-result moments.
  moment_type: z.enum(BROADCAST_MOMENT_TYPES),
  description: z.string().max(FIELD_LIMITS.DESCRIPTION).optional(),
  timestamp_ms: z.number().int().min(0).optional(),
});

export const broadcastPresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  preset_type: z.enum(['match', 'league', 'draft', 'player']),
  config: z.record(z.string(), z.unknown()),
});

export const broadcastPresetUpdateSchema = z.object({
  name: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const adminImportSetsSchema = z.object({
  generation: z.number().int().min(1).max(9),
});

export const adminImportStatsSchema = z.object({
  format: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
});

// ─── Team Library / Share / Fork Schemas ────────────────────────────

export const teamLibraryPublishSchema = z.object({
  teamId: uuid,
  title: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  description: z.string().max(FIELD_LIMITS.MEDIUM_TEXT).optional(),
  tags: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
});

export const teamLibraryUnpublishSchema = z.object({
  teamId: uuid,
});

export const teamShareCreateSchema = z.object({
  teamId: uuid,
});

export const teamShareDeleteSchema = z.object({
  teamId: uuid,
});

/**
 * A fork always lands as a personal team (no tournament: a fork must not
 * bypass the submission guards of `POST /api/teams`). `shareToken` authorizes
 * forking a team that is shared but not published to the library.
 */
export const teamForkSchema = z
  .object({
    sourceTeamId: uuid,
    shareToken: uuid.optional(),
  })
  .strict();

/** `GET /api/teams/library` query (`search` and `tags`; paging via `parsePagination`). */
export const teamLibraryListQuerySchema = z.object({
  search: z.string().trim().max(FIELD_LIMITS.TITLE).optional(),
  tags: z.array(z.string().trim().min(1).max(FIELD_LIMITS.NAME)).max(20).optional(),
});

export const teamCoachSchema = z.object({
  team: z.array(z.unknown()).min(1).max(6),
  format: z.string().trim().min(1).max(FIELD_LIMITS.NAME),
  generation: z.number().int().min(1).max(9),
});

// ─── Type Exports ────────────────────────────────────────────────────

export type PlayerCreateInput = z.infer<typeof playerCreateSchema>;
export type PlayerUpdateInput = z.infer<typeof playerUpdateSchema>;
export type AdminPlayerImportPlayersInput = z.infer<typeof adminPlayerImportPlayersSchema>;
export type AdminPlayerImportInput = z.infer<typeof adminPlayerImportSchema>;
export type AdminPlayerDisciplineInput = z.infer<typeof adminPlayerDisciplineSchema>;
export type AdminExportInput = z.infer<typeof adminExportSchema>;
export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;
export type AdminMatchRepairInput = z.infer<typeof adminMatchRepairSchema>;
export type MatchProposalCreateInput = z.infer<typeof matchProposalCreateSchema>;
export type TournamentCreateInput = z.infer<typeof tournamentCreateSchema>;
export type TournamentUpdateInput = z.infer<typeof tournamentUpdateSchema>;
export type SeasonCreateInput = z.infer<typeof seasonCreateSchema>;
export type SeasonUpdateInput = z.infer<typeof seasonUpdateSchema>;
export type SeasonCloneOptionsInput = z.infer<typeof seasonCloneOptionsSchema>;
export type SeasonCreateRequestInput = z.infer<typeof seasonCreateRequestSchema>;
export type ParseReplayInput = z.infer<typeof parseReplaySchema>;
export type ManualResultInput = z.infer<typeof manualResultSchema>;
export type ConfirmMatchInput = z.infer<typeof confirmMatchSchema>;
export type MatchScheduleInput = z.infer<typeof matchScheduleSchema>;
export type MatchReopenInput = z.infer<typeof matchReopenSchema>;
export type MatchResetInput = z.infer<typeof matchResetSchema>;
export type GameDeleteInput = z.infer<typeof gameDeleteSchema>;
export type MatchHistoryQueryInput = z.infer<typeof matchHistoryQuerySchema>;
export type RulesetCreateInput = z.infer<typeof rulesetCreateSchema>;
export type RulesetUpdateInput = z.infer<typeof rulesetUpdateSchema>;
export type AchievementCreateInput = z.infer<typeof achievementCreateSchema>;
export type AchievementUpdateInput = z.infer<typeof achievementUpdateSchema>;
export type WebhookCreateInput = z.infer<typeof webhookCreateSchema>;
export type WebhookUpdateInput = z.infer<typeof webhookUpdateSchema>;
export type SocialIntegrationCreateInput = z.infer<typeof socialIntegrationCreateSchema>;
export type SocialIntegrationUpdateInput = z.infer<typeof socialIntegrationUpdateSchema>;
export type WikiNoteCreateInput = z.infer<typeof wikiNoteCreateSchema>;
export type WikiNoteUpdateInput = z.infer<typeof wikiNoteUpdateSchema>;
export type WikiSearchInput = z.infer<typeof wikiSearchSchema>;
export type WikiNoteReportInput = z.infer<typeof wikiNoteReportSchema>;
export type WikiModerationNotesQueryInput = z.infer<typeof wikiModerationNotesQuerySchema>;
export type WikiReportsQueryInput = z.infer<typeof wikiReportsQuerySchema>;
export type WikiReportUpdateInput = z.infer<typeof wikiReportUpdateSchema>;
export type ResourceAdminCreateInput = z.infer<typeof resourceAdminCreateSchema>;
export type DraftPoolTemplateCreateInput = z.infer<typeof draftPoolTemplateCreateSchema>;
export type DraftPickInput = z.infer<typeof draftPickSchema>;
export type AdminGameEditInput = z.infer<typeof adminGameEditSchema>;
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>;
export type WikiNotePatchInput = z.infer<typeof wikiNotePatchSchema>;
export type WikiNoteBlockResubmissionInput = z.infer<typeof wikiNoteBlockResubmissionSchema>;
export type TournamentParticipantSeedsInput = z.infer<typeof tournamentParticipantSeedsSchema>;
export type TypeAnalysisInput = z.infer<typeof typeAnalysisSchema>;
export type ValidateSetInput = z.infer<typeof validateSetSchema>;
export type ImportTeamInput = z.infer<typeof importTeamSchema>;
export type MatchPrepInput = z.infer<typeof matchPrepSchema>;
export type BootstrapInput = z.infer<typeof bootstrapSchema>;
export type AiMatchAnalysisInput = z.infer<typeof aiMatchAnalysisSchema>;
export type AiMatchPrepInput = z.infer<typeof aiMatchPrepSchema>;
export type AiTournamentReportInput = z.infer<typeof aiTournamentReportSchema>;
export type AgentPersonaInput = z.infer<typeof agentPersonaSchema>;
export type AgentChatInput = z.infer<typeof agentChatSchema>;
export type AgentAnalysisType = z.infer<typeof agentAnalysisTypeSchema>;
export type AgentAnalyzeMatchInput = z.infer<typeof agentAnalyzeMatchSchema>;
export type AgentReportType = z.infer<typeof agentReportTypeSchema>;
export type AgentTournamentReportInput = z.infer<typeof agentTournamentReportSchema>;
export type AgentTeamInput = z.infer<typeof agentTeamSchema>;
export type AgentConfigInput = z.infer<typeof agentConfigSchema>;
export type DraftPoolCreateInput = z.infer<typeof draftPoolCreateSchema>;
export type DraftPoolUpdateInput = z.infer<typeof draftPoolUpdateSchema>;
export type DraftTierLimitsInput = z.infer<typeof draftTierLimitsSchema>;
export type DraftPoolEntryCreateInput = z.infer<typeof draftPoolEntryCreateSchema>;
export type DraftPoolEntryUpdateInput = z.infer<typeof draftPoolEntryUpdateSchema>;
export type EvolutionCreateInput = z.infer<typeof evolutionCreateSchema>;
export type EvolutionUpdateInput = z.infer<typeof evolutionUpdateSchema>;
export type RoundUpdateInput = z.infer<typeof roundUpdateSchema>;
export type GenerateRoundOptionsInput = z.infer<typeof generateRoundOptionsSchema>;
export type BroadcastMomentInput = z.infer<typeof broadcastMomentSchema>;
export type BroadcastPresetCreateInput = z.infer<typeof broadcastPresetCreateSchema>;
export type BroadcastPresetUpdateInput = z.infer<typeof broadcastPresetUpdateSchema>;
export type AdminImportSetsInput = z.infer<typeof adminImportSetsSchema>;
export type AdminImportStatsInput = z.infer<typeof adminImportStatsSchema>;

// ─── Avatar Schemas ──────────────────────────────────────────────────

export const avatarGenerateSchema = z.object({
  choices: z.record(z.string(), z.string()),
});

export const avatarTransformSchema = z.object({
  image: z.string().min(1),
  consentAccepted: z.literal(true),
  consentVersion: z.string().min(1),
});

export const avatarUploadSchema = z.object({
  showdown_sprite: z.string().optional(),
  sprite_url: z.string().optional(),
  gallery_id: uuid.optional(),
  image: z.string().optional(),
  config: z.unknown().optional(),
}).refine(
  (data) => (data.showdown_sprite && data.sprite_url) || data.gallery_id || (data.image && data.config !== undefined),
  { message: 'Must provide showdown_sprite+sprite_url, gallery_id, or image+config' },
);

// ─── Cast Session Schemas ────────────────────────────────────────────

const castSessionModeSchema = z.enum(['cast', 'solo', 'replaycast']);

export const castSessionCreateSchema = z.object({
  name: z.string().trim().max(FIELD_LIMITS.TITLE).optional(),
  mode: castSessionModeSchema.optional(),
  match_id: uuid.nullable().optional(),
  tournament_id: uuid.nullable().optional(),
  season_id: uuid.nullable().optional(),
  player1_id: uuid.nullable().optional(),
  player1_name: z.string().trim().max(FIELD_LIMITS.NAME).nullable().optional(),
  player1_avatar_url: z.string().trim().max(500).nullable().optional(),
  player2_id: uuid.nullable().optional(),
  player2_name: z.string().trim().max(FIELD_LIMITS.NAME).nullable().optional(),
  player2_avatar_url: z.string().trim().max(500).nullable().optional(),
  format: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  generation: z.number().int().min(1).max(9).optional(),
});

export const castSessionUpdateSchema = z.object({
  name: z.string().trim().max(FIELD_LIMITS.TITLE).optional(),
  mode: castSessionModeSchema.optional(),
  status: z.enum(['draft', 'live', 'archived']).optional(),
  match_id: uuid.nullable().optional(),
  tournament_id: uuid.nullable().optional(),
  season_id: uuid.nullable().optional(),
  player1_id: uuid.nullable().optional(),
  player1_name: z.string().trim().max(FIELD_LIMITS.NAME).nullable().optional(),
  player1_avatar_url: z.string().trim().max(500).nullable().optional(),
  player2_id: uuid.nullable().optional(),
  player2_name: z.string().trim().max(FIELD_LIMITS.NAME).nullable().optional(),
  player2_avatar_url: z.string().trim().max(500).nullable().optional(),
  player1_team: z.unknown().optional(),
  player2_team: z.unknown().optional(),
  tracker_state: z.unknown().nullable().optional(),
  overlay_config: z.unknown().optional(),
  caster_notes: z.unknown().optional(),
  format: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  generation: z.number().int().min(1).max(9).optional(),
});

export const castSessionPopulateSchema = z.object({
  match_id: uuid,
});

// ─── Team Schemas ────────────────────────────────────────────────────

export const teamCreateSchema = z.object({
  tournament_id: uuid.nullable().optional(),
  season_id: uuid.nullable().optional(),
  pokemon: teamPokemonSchema,
  import_source: teamImportSourceSchema.optional(),
  name: z.string().trim().max(80).optional(),
});

export const teamUpdateSchema = z.object({
  pokemon: teamPokemonSchema,
  import_source: teamImportSourceSchema,
  name: z.string().trim().max(80).optional(),
});

// ─── Manual Round Schema ─────────────────────────────────────────────

export const manualRoundSchema = z.object({
  name: z.string().trim().max(FIELD_LIMITS.NAME).optional(),
  best_of: bestOfSchema.optional(),
  pairings: z.array(z.object({
    player_1_id: uuid,
    player_2_id: uuid,
  })).min(1, 'At least one pairing is required'),
});

// ─── Seed Rulesets Schema ────────────────────────────────────────────

export const seedRulesetsSchema = z.object({
  secret: z.string().optional(),
});

// ─── Storyline Schemas ─────────────────────────────────────────────

export const storylineInsertSchema = z.object({
  season_id: uuid,
  title: z.string().trim().min(1).max(FIELD_LIMITS.TITLE),
  body: z.string().trim().min(1).max(10000),
  tags: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  featured: z.boolean().optional(),
});

export const storylineUpdateSchema = z.object({
  title: z.string().trim().min(1).max(FIELD_LIMITS.TITLE).optional(),
  body: z.string().trim().min(1).max(10000).optional(),
  tags: z.array(z.string().trim().max(FIELD_LIMITS.NAME)).optional(),
  featured: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'At least one field must be provided for update',
});

// ─── Social Image Upload Schema ──────────────────────────────────────

export const socialImageSchema = z.object({
  image: z.string().min(1),
});

// ─── Type Exports (continued) ────────────────────────────────────────

export type TeamConstraintsInput = z.infer<typeof teamConstraintsSchema>;
export type CoreTripleInput = z.infer<typeof coreTripleSchema>;
export type CorePoolInput = z.infer<typeof corePoolSchema>;
export type SeasonCorePoolUpdateInput = z.infer<typeof seasonCorePoolUpdateSchema>;
export type SeasonAssignCoresInput = z.infer<typeof seasonAssignCoresSchema>;

export type AvatarGenerateInput = z.infer<typeof avatarGenerateSchema>;
export type AvatarTransformInput = z.infer<typeof avatarTransformSchema>;
export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;
export type CastSessionCreateInput = z.infer<typeof castSessionCreateSchema>;
export type CastSessionUpdateInput = z.infer<typeof castSessionUpdateSchema>;
export type CastSessionPopulateInput = z.infer<typeof castSessionPopulateSchema>;
export type TeamCreateInput = z.infer<typeof teamCreateSchema>;
export type TeamUpdateInput = z.infer<typeof teamUpdateSchema>;
export type ManualRoundInput = z.infer<typeof manualRoundSchema>;
export type SeedRulesetsInput = z.infer<typeof seedRulesetsSchema>;
export type StorylineInsertInput = z.infer<typeof storylineInsertSchema>;
export type StorylineUpdateInput = z.infer<typeof storylineUpdateSchema>;
export type SocialImageInput = z.infer<typeof socialImageSchema>;
export type TeamLibraryPublishInput = z.infer<typeof teamLibraryPublishSchema>;
export type TeamLibraryUnpublishInput = z.infer<typeof teamLibraryUnpublishSchema>;
export type TeamShareCreateInput = z.infer<typeof teamShareCreateSchema>;
export type TeamShareDeleteInput = z.infer<typeof teamShareDeleteSchema>;
export type TeamForkInput = z.infer<typeof teamForkSchema>;
export type TeamCoachInput = z.infer<typeof teamCoachSchema>;

// ─── Evolution Point Buy Schemas ────────────────────────────────

export const pointBuyListCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  version: z.number().int().positive().optional(),
  source: z.string().max(500).optional().nullable(),
});

export const pointBuySpecialRulesSchema = z.object({
  scatterbug: z.boolean().optional(),
  no_cocoon_rule: z.boolean().optional(),
  cosmog: z.boolean().optional(),
  no_redraft: z.boolean().optional(),
});

export const pointBuyListEntrySchema = z.object({
  line_number: z.number().int().positive(),
  base_pokemon: z.string().trim().min(1).max(100),
  stage2_pokemon: z.string().trim().min(1).max(100),
  stage3_pokemon: z.string().trim().max(100).optional().nullable(),
  price: z.number().int().positive(),
  kills_to_stage2: z.number().int().min(0),
  additional_kills_to_stage3: z.number().int().min(0).optional().nullable(),
  price_group: z.enum(['premium', 'hoch', 'mittel', 'guenstig', 'budget']),
  early_rating: z.number().int().min(0).max(10).optional().nullable(),
  mid_rating: z.number().int().min(0).max(10).optional().nullable(),
  late_rating: z.number().int().min(0).max(10).optional().nullable(),
  rationale: z.string().max(2000).optional().nullable(),
  historical_data: z.string().max(2000).optional().nullable(),
  special_rules: pointBuySpecialRulesSchema.optional().nullable(),
  special_rules_text: z.string().max(4000).optional().nullable(),
  sources: z.string().max(4000).optional().nullable(),
  legacy_tier: z.string().max(50).optional().nullable(),
});

export const pointBuyBulkEntriesSchema = z.object({
  entries: z.array(pointBuyListEntrySchema).min(1).max(200),
});

export const formatRulesSchema = z.object({
  banned_moves: z.array(z.string().max(100)).optional(),
  banned_items: z.array(z.string().max(100)).optional(),
  // Each stage accepts exactly the active format pack's value (`epb.teraByStage`).
  tera_rules: z.object({
    stage1: z.literal(formatPack.epb.teraByStage.stage1),
    stage2: z.literal(formatPack.epb.teraByStage.stage2),
    stage3: z.literal(formatPack.epb.teraByStage.stage3),
  }).optional(),
  tiebreaker_order: z.array(z.enum([
    'match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match',
  ])).optional(),
  draft_budget: z.number().int().positive().max(999).optional(),
  draft_picks: z.number().int().positive().max(20).optional(),
  draft_token_ratio: z.number().int().positive().max(10).optional(),
  draft_token_max: z.number().int().min(0).max(5).optional(),
  draft_token_max_per_line: z.number().int().min(0).max(3).optional(),
  redraft_phase_open: z.boolean().optional(),
});

export const redraftPhaseSchema = z.object({
  open: z.boolean(),
});

export const progressCorrectionSchema = z.object({
  tracker_id: uuid,
  source: z.enum(['real_kill', 'draft_token', 'kill_token', 'cosmo_point']),
  amount: z.number().int().min(-100).max(100),
  note: z.string().max(500).optional(),
});

export const teamRoleImportSchema = z.object({
  roles: z.array(z.object({
    species_form: z.string().trim().min(1).max(100),
    stage: z.number().int().min(1).max(3).optional().nullable(),
    category: z.enum([
      'hazard_setting', 'hazard_removal', 'healing_cleric', 'momentum',
      'item_removal', 'status', 'priority', 'disruption',
    ]),
    move_name: z.string().trim().min(1).max(100),
    source: z.string().max(200).optional().nullable(),
  })).min(1).max(500),
});

export const pointBuyXlsxImportOptionsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  version: z.number().int().positive(),
  season_id: z.string().uuid().optional(),
  dry_run: z.boolean().optional(),
});

// ─── Helper: Format Zod errors into a flat string ────────────────────

export function formatZodErrors(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
  return issues.join('; ');
}
