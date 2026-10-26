import { cache } from 'react';
import { supabase } from '../client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { toDraftRuleError } from '@/lib/draft/rpc-errors';
import { mapFormatDbError } from '@/lib/format-studio/errors';
import { DEFAULT_CONTENT_LOCALE, isLocale } from '@/i18n/config';
import {
  CoreNotInPoolError,
  CoreTypesConflictError,
  isTripleInPool,
  normalizeTriple,
} from '@/lib/season/core-assignment';
import type { Json, Tables } from '@/types/database';
import type { PlayerStatus } from '@/types/player';
import type {
  Season,
  SeasonWithDetails,
  SeasonFormData,
  SeasonFormatType,
  SeasonStatus,
  SeasonParticipant,
  CoreTriple,
  RouteThemeId,
} from '@/types/season';
import type { PublicSeasonParticipant } from '@/lib/players/public-player';


type SeasonRow = Tables<'seasons'>;

function toCorePool(value: unknown): CoreTriple[] | null {
  if (!Array.isArray(value)) return null;
  const result: CoreTriple[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    if (!entry.every((t): t is string => typeof t === 'string')) continue;
    result.push([entry[0], entry[1], entry[2]] as CoreTriple);
  }
  return result;
}

function toCoreTriple(value: unknown): CoreTriple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((t): t is string => typeof t === 'string')) return null;
  return [value[0], value[1], value[2]] as CoreTriple;
}

function toSeason(row: SeasonRow): Season {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format_type: row.format_type as SeasonFormatType,
    ruleset_id: row.ruleset_id,
    start_date: row.start_date,
    end_date: row.end_date,
    status: row.status as SeasonStatus,
    archived: row.archived,
    legacy: row.legacy,
    is_test_season: row.is_test_season,
    core_pool: toCorePool(row.core_pool),
    point_buy_list_id: row.point_buy_list_id,
    route_theme: row.route_theme as RouteThemeId,
    // The column is CHECK-constrained to 'en' | 'de'; anything else (a row read
    // before the language migration, a test double) falls back to the default.
    language: isLocale(row.language) ? row.language : DEFAULT_CONTENT_LOCALE,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * The list/detail select: the season row, its ruleset name and COUNT embeds
 * for participants and stages. PostgREST returns `[{ count: n }]` for a
 * `child ( count )` embed, so the child id arrays never cross the wire.
 */
const SEASON_DETAILS_SELECT = `
  *,
  rulesets ( name ),
  season_participants ( count ),
  tournaments ( count )
`;

/** Read a `child ( count )` embed: `[{ count: n }]` → n (0 when absent). */
function embedCount(value: unknown): number {
  if (!Array.isArray(value) || value.length === 0) return 0;
  const first = value[0] as { count?: unknown };
  return typeof first.count === 'number' ? first.count : 0;
}

function toSeasonDetails(row: {
  rulesets: unknown;
  season_participants: unknown;
  tournaments: unknown;
}): Pick<SeasonWithDetails, 'ruleset_name' | 'participant_count' | 'tournament_count'> {
  return {
    ruleset_name: (row.rulesets as { name: string } | null)?.name ?? null,
    participant_count: embedCount(row.season_participants),
    tournament_count: embedCount(row.tournaments),
  };
}

/**
 * The active (non-archived) leagues: real leagues first, then test leagues,
 * each group newest first.
 *
 * Test leagues (`is_test_season`) are listed by default so the community can
 * find and play in them together: this is the read behind every public league
 * list (`/leagues`, the home page teaser, `GET /api/seasons`), the admin lists
 * and the creator content dashboard. Callers badge them as test leagues. Sorting
 * them after the real leagues (in the query, before the 100-row cap) keeps a
 * pile of test leagues from pushing a real league off the list.
 *
 * `{ includeTestSeasons: false }` leaves them out, for a caller that must
 * never offer one (the insights scope picker). Listing a test league changes
 * nothing about the stats: its games are kept out of the all-time aggregates by
 * `games.exclude_all_time`, frozen when each game is recorded, and its
 * matches out of player ratings by the current flag
 * (src/lib/rating/rating-scope.ts).
 */
export async function listSeasons(
  opts: { includeTestSeasons?: boolean } = {},
): Promise<SeasonWithDetails[]> {
  let query = supabase
    .from('seasons')
    .select(SEASON_DETAILS_SELECT)
    .eq('archived', false);
  if (opts.includeTestSeasons === false) query = query.eq('is_test_season', false);

  const { data, error } = await query
    .order('is_test_season', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return data.map((row) => ({
    ...toSeason(row),
    ...toSeasonDetails(row),
  }));
}

export async function listArchivedSeasons(): Promise<SeasonWithDetails[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select(SEASON_DETAILS_SELECT)
    .eq('archived', true)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return data.map((row) => ({
    ...toSeason(row),
    ...toSeasonDetails(row),
  }));
}

/**
 * Seasons by id. `archived` narrows by the archived flag: `false` = active
 * only, `true` = archived only, omitted = both (profile and filter callers).
 * The admin lists pass it so an active list never shows an archived league and
 * the archived list shows only the admin's own.
 */
export async function listSeasonsByIds(
  ids: string[],
  opts: { archived?: boolean } = {},
): Promise<SeasonWithDetails[]> {
  if (ids.length === 0) return [];

  let query = supabase
    .from('seasons')
    .select(SEASON_DETAILS_SELECT)
    .in('id', ids);
  if (opts.archived !== undefined) query = query.eq('archived', opts.archived);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;

  return data.map((row) => ({
    ...toSeason(row),
    ...toSeasonDetails(row),
  }));
}

/**
 * Load the ids of every season (archived + active), ordered oldest-first.
 * Used by the season reconcile orchestrator (spec §22) to iterate all seasons.
 * Unlike `listSeasons`, this includes archived seasons and returns only ids,
 * so it stays cheap for the all-seasons reconciliation fan-out.
 */
export async function listAllSeasonIds(): Promise<string[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

/**
 * One season row. React `cache()`: the format-aware standings entry point
 * reads it once per call, and a page computes several tables per render.
 */
export const getSeasonById = cache(async function getSeasonById(id: string): Promise<Season | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toSeason(data) : null;
});

/**
 * The ids of a season's stages (its tournaments), and nothing else. For
 * callers that only scope further reads to the season's stages.
 */
export async function getSeasonStageIds(seasonId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id')
    .eq('season_id', seasonId);

  if (error) throw error;
  return (data ?? []).map((row) => row.id as string);
}

/** The stage ids of a season with the two facts that decide whether its table scores Swiss byes. */
export interface SeasonStageBrackets {
  stageIds: string[];
  hasSwissStage: boolean;
  /** The season's format, read through the stage rows; null for a season without a stage. */
  formatType: SeasonFormatType | null;
}

/**
 * `getSeasonStageIds` that also tells whether a stage is Swiss and which format the season has, in the SAME
 * query (the season rides on the stage rows as an embed). A caller that reads the Swiss stages' rounds only for a
 * league that has one decides from this alone, so a league without a Swiss stage pays no extra read.
 */
export async function getSeasonStageBrackets(seasonId: string): Promise<SeasonStageBrackets> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, bracket_type, seasons ( format_type )')
    .eq('season_id', seasonId);

  if (error) throw error;
  const rows = data ?? [];
  return {
    stageIds: rows.map((row) => row.id as string),
    hasSwissStage: rows.some((row) => row.bracket_type === 'swiss'),
    formatType: (rows[0]?.seasons as { format_type: SeasonFormatType } | null | undefined)?.format_type ?? null,
  };
}

/**
 * Format type per season id, in one query. Lets a caller that computes
 * standings for many tournaments (the profile composer) resolve every
 * season's tiebreaker chain without one `getSeasonById` per tournament.
 */
export async function getSeasonFormatTypes(
  ids: readonly string[],
): Promise<Map<string, SeasonFormatType>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from('seasons')
    .select('id, format_type')
    .in('id', unique);

  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [row.id as string, row.format_type as SeasonFormatType]),
  );
}

/**
 * One season with its ruleset name and child counts. Wrapped in React
 * `cache()`: the league page, the world route builder and the standings
 * helpers ask for the same row in one render, and it is read once. Outside a
 * server-component render (route handlers, scripts) `cache` is a passthrough.
 */
export const getSeasonWithDetails = cache(async function getSeasonWithDetails(
  id: string,
): Promise<SeasonWithDetails | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select(SEASON_DETAILS_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...toSeason(data),
    ...toSeasonDetails(data),
  };
});

export async function createSeason(input: SeasonFormData): Promise<Season> {
  const { data, error } = await supabase
    .from('seasons')
    .insert({
      name: input.name,
      description: input.description ?? '',
      format_type: input.format_type,
      ruleset_id: input.ruleset_id ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      // Omitted when unset so the DB default ('auto') applies — the column is
      // NOT NULL, so null is never sent.
      route_theme: input.route_theme,
      // Omitted when unset so the DB default ('de') applies.
      ...(input.language !== undefined ? { language: input.language } : {}),
    })
    .select()
    .single();

  if (error) throw error;
  return toSeason(data);
}

export async function updateSeason(
  id: string,
  input: Partial<SeasonFormData> & {
    status?: SeasonStatus;
    archived?: boolean;
    /** Site-admin only; the route enforces it (`PATCH /api/seasons/[id]`). */
    is_test_season?: boolean;
  }
): Promise<Season> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.format_type !== undefined) updates.format_type = input.format_type;
  if (input.ruleset_id !== undefined) updates.ruleset_id = input.ruleset_id;
  if (input.start_date !== undefined) updates.start_date = input.start_date;
  if (input.end_date !== undefined) updates.end_date = input.end_date;
  if (input.status !== undefined) updates.status = input.status;
  if (input.archived !== undefined) updates.archived = input.archived;
  if (input.is_test_season !== undefined) updates.is_test_season = input.is_test_season;
  if (input.point_buy_list_id !== undefined) updates.point_buy_list_id = input.point_buy_list_id;
  if (input.route_theme !== undefined) updates.route_theme = input.route_theme;
  if (input.language !== undefined) updates.language = input.language;

  const { data, error } = await supabase
    .from('seasons')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  // A custom league without an attached format cannot become active (trigger on `seasons`): FORMAT_NOT_ATTACHED
  // becomes a typed 409. Every other error is returned unchanged by the mapper, so legacy leagues behave as before.
  if (error) throw mapFormatDbError(error);
  return toSeason(data);
}

/**
 * DELETE of a league that a row still points at through a foreign key without
 * an ON DELETE action (phases = `tournaments`, `draft_pools`, `teams`,
 * `season_storylines`, and a draft pick on one of its redraft slots), SQLSTATE
 * 23503. The statement rolled back, so nothing was deleted. HTTP 409.
 */
export class SeasonHasDependentsError extends UserFacingError<'SEASON_HAS_DEPENDENTS'> {
  /** The constraint Postgres named (for the log line; never sent to clients). */
  readonly constraint: string | null;

  constructor(constraint: string | null) {
    super(
      'This league still has phases, draft pools, teams or storylines that point to it, so nothing was deleted. Delete those first, then delete the league.',
      { code: 'SEASON_HAS_DEPENDENTS', status: 409 },
    );
    this.name = 'SeasonHasDependentsError';
    this.constraint = constraint;
  }
}

/**
 * Delete a league. Its cascading children (participants, trackers, format
 * rules, ...) go with it; a row that still references it without ON DELETE
 * refuses the whole statement (23503), which answers `SeasonHasDependentsError`
 * (409) naming nothing internal. Every other error propagates as it is.
 */
export async function deleteSeason(id: string): Promise<void> {
  const { error } = await supabase.from('seasons').delete().eq('id', id);
  if (!error) return;
  if (error.code === '23503') {
    const constraint = /foreign key constraint "([^"]+)"/.exec(error.message)?.[1] ?? null;
    console.warn(`[deleteSeason] league ${id} still has dependents (${constraint ?? 'unknown constraint'}); nothing deleted`);
    throw new SeasonHasDependentsError(constraint);
  }
  throw error;
}

/**
 * Get all leagues/seasons a player is participating in (the dashboard's My
 * Leagues, `GET /api/seasons/me`), test leagues included: real leagues first,
 * then test leagues, newest first inside each group (`listSeasons` order).
 */
export async function getSeasonsByPlayer(playerId: string): Promise<SeasonWithDetails[]> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('season_id')
    .eq('player_id', playerId);

  if (error) throw error;
  if (!data.length) return [];

  const ids = data.map(r => r.season_id);
  const seasons = await listSeasonsByIds(ids);
  // Stable sort: keeps listSeasonsByIds' newest-first order inside each group.
  return seasons.sort((a, b) => Number(a.is_test_season) - Number(b.is_test_season));
}

// --- Participant management ---

/**
 * FULL participant rows, private player columns included (`discord_id`,
 * `auth_user_id`, `ban_reason`, `suspended_until`, admin/test flags). For
 * admin, creator and server-internal callers only. Never pass the result into
 * a `'use client'` component or a public response: public pages use
 * `getPublicSeasonParticipants`, and anything crossing to a client maps
 * through `src/lib/players/public-player.ts`.
 */
export async function getSeasonParticipants(seasonId: string): Promise<SeasonParticipant[]> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('player_id, gym_type, core_types, core_assigned_at, players ( * )')
    .eq('season_id', seasonId);

  if (error) throw error;

  return data.map((row) => {
    const p = row.players as Tables<'players'>;
    return {
      id: p.id,
      name: p.name,
      discord_id: p.discord_id,
      auth_user_id: p.auth_user_id,
      ps_username: p.ps_username,
      champions_username: p.champions_username,
      is_admin: p.is_admin,
      is_creator: p.is_creator,
      is_guest: p.is_guest,
      is_test_account: p.is_test_account,
      joined_date: p.joined_date,
      avatar_url: p.avatar_url ?? null,
      avatar_config: (p.avatar_config as unknown as import('@/types/avatar').AvatarConfig) ?? null,
      status: p.status as PlayerStatus,
      suspended_until: p.suspended_until,
      ban_reason: p.ban_reason,
      created_at: p.created_at,
      updated_at: p.updated_at,
      gym_type: row.gym_type ?? null,
      core_types: toCoreTriple(row.core_types),
      core_assigned_at: row.core_assigned_at ?? null,
    };
  });
}

/**
 * Public-page participant rows: selects ONLY the public columns (the player's
 * id, name and avatar plus the season's gym band and core), so private player
 * columns are never read for a public render. React `cache()`: the league
 * page and the world route builder share one read per render.
 */
export const getPublicSeasonParticipants = cache(async function getPublicSeasonParticipants(
  seasonId: string,
): Promise<PublicSeasonParticipant[]> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('player_id, gym_type, core_types, players ( id, name, avatar_url )')
    .eq('season_id', seasonId);

  if (error) throw error;

  return data.map((row) => {
    const p = row.players as { id: string; name: string; avatar_url: string | null };
    return {
      id: p.id,
      name: p.name,
      gym_type: row.gym_type ?? null,
      avatar_url: p.avatar_url ?? null,
      core_types: toCoreTriple(row.core_types),
    };
  });
});

/**
 * Gym band per participant id — two columns, no player join. For pages that
 * only colour rows by gym type (the tournament detail page).
 */
export async function getSeasonParticipantGymTypes(
  seasonId: string,
): Promise<Record<string, string | null>> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('player_id, gym_type')
    .eq('season_id', seasonId);

  if (error) throw error;

  const gymTypes: Record<string, string | null> = {};
  for (const row of data) gymTypes[row.player_id] = row.gym_type ?? null;
  return gymTypes;
}

export async function addSeasonParticipant(seasonId: string, playerId: string): Promise<void> {
  const { error } = await supabase
    .from('season_participants')
    .insert({ season_id: seasonId, player_id: playerId });
  if (error) throw error;
}

// Removing a trainer goes through `removeLeagueParticipant` (queries/season-groups.ts, RPC
// season_participant_remove): leaving the league also leaves the league group, and the RPC enforces the group rules.

export interface SeasonParticipantRow {
  gym_type: string | null;
  core_types: string[] | null;
  core_assigned_at: string | null;
}

export async function getSeasonParticipantRow(
  seasonId: string,
  playerId: string,
): Promise<SeasonParticipantRow | null> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('gym_type, core_types, core_assigned_at')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Swap roster membership in one UPDATE: the outgoing player's row passes to
 * the incoming player with its gym/core metadata, so no moment leaves the
 * league with neither player (a failure changes nothing, and the substitution
 * re-run finishes it).
 *
 * The substitution checks both sides before it writes, so a failure here
 * means the roster changed in between (a second apply of the same
 * substitution, another tab, a roster edit). Both are 409s with their own
 * code, nothing written:
 * - `ROSTER_CHANGED`: the outgoing player is no longer on the roster.
 * - `IN_ALREADY_ON_ROSTER`: the primary key rejects an incoming player who
 *   is on the roster by now.
 * - `SEASON_GROUP_SUBSTITUTION_LOCKED` (`DraftRuleError`): the outgoing
 *   trainer's league group started drafting since the substitution's
 *   pre-check (the membership trigger, 20261018202000_league_groups_locks.sql,
 *   refuses the cascaded slot change; the roster row stays as it was).
 */
export async function swapSeasonParticipant(
  seasonId: string,
  outPlayerId: string,
  inPlayerId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('season_participants')
    .update({ player_id: inPlayerId })
    .eq('season_id', seasonId)
    .eq('player_id', outPlayerId)
    .select('player_id');

  if (error) {
    const rule = toDraftRuleError(error);
    if (rule) throw rule;
    if (error.code === '23505') {
      console.error('[swapSeasonParticipant] Query error:', error);
      throw new UserFacingError('Incoming player is already on the league roster', {
        code: 'IN_ALREADY_ON_ROSTER',
        status: 409,
      });
    }
    throw error;
  }
  if (data.length === 0) {
    throw new UserFacingError(
      'Outgoing player is not on the league roster any more (the roster changed during the substitution); check it again',
      { code: 'ROSTER_CHANGED', status: 409 },
    );
  }
}

export async function updateParticipantGymType(
  seasonId: string,
  playerId: string,
  gymType: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('season_participants')
    .update({ gym_type: gymType })
    .eq('season_id', seasonId)
    .eq('player_id', playerId);
  if (error) throw error;
}

// --- Core Liga: pool + participant core management ---

export async function getCorePool(seasonId: string): Promise<CoreTriple[] | null> {
  const { data, error } = await supabase
    .from('seasons')
    .select('core_pool')
    .eq('id', seasonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toCorePool(data.core_pool);
}

export async function setCorePool(
  seasonId: string,
  pool: CoreTriple[] | null,
): Promise<void> {
  const { error } = await supabase
    .from('seasons')
    .update({ core_pool: (pool ?? null) as Json | null })
    .eq('id', seasonId);
  if (error) throw error;
}

function isUniqueCoreViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === '23505'
  );
}

export async function updateParticipantCoreTypes(
  seasonId: string,
  playerId: string,
  coreTypes: CoreTriple | null,
): Promise<void> {
  if (coreTypes === null) {
    const { error } = await supabase
      .from('season_participants')
      .update({ core_types: null, core_assigned_at: null })
      .eq('season_id', seasonId)
      .eq('player_id', playerId);
    if (error) throw error;
    return;
  }

  const sorted = normalizeTriple(coreTypes);
  const pool = await getCorePool(seasonId);
  if (!pool || pool.length === 0) {
    throw new CoreNotInPoolError(sorted);
  }
  if (!isTripleInPool(pool, sorted)) {
    throw new CoreNotInPoolError(sorted);
  }

  const { data: existing, error: queryError } = await supabase
    .from('season_participants')
    .select('player_id')
    .eq('season_id', seasonId)
    .contains('core_types', sorted)
    .neq('player_id', playerId)
    .maybeSingle();
  if (queryError) throw queryError;
  if (existing) throw new CoreTypesConflictError(sorted);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('season_participants')
    .update({ core_types: sorted, core_assigned_at: now })
    .eq('season_id', seasonId)
    .eq('player_id', playerId);
  if (error) {
    if (isUniqueCoreViolation(error)) {
      throw new CoreTypesConflictError(sorted);
    }
    throw error;
  }
}

export async function getParticipantCore(
  seasonId: string,
  playerId: string,
): Promise<CoreTriple | null> {
  const { data, error } = await supabase
    .from('season_participants')
    .select('core_types')
    .eq('season_id', seasonId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toCoreTriple(data.core_types);
}

/**
 * Bulk-write assigned cores. Each input row updates exactly one participant.
 * Assignments are normalised (sorted) so the unique index across the season
 * matches regardless of permutation. Atomic at the row level (no global tx).
 */
export async function setParticipantCores(
  seasonId: string,
  assignments: Array<{ playerId: string; coreTypes: CoreTriple }>,
): Promise<void> {
  if (assignments.length === 0) return;
  const now = new Date().toISOString();
  for (const { playerId, coreTypes } of assignments) {
    const sorted: CoreTriple = [...coreTypes].sort() as CoreTriple;
    const { error } = await supabase
      .from('season_participants')
      .update({ core_types: sorted, core_assigned_at: now })
      .eq('season_id', seasonId)
      .eq('player_id', playerId);
    if (error) throw error;
  }
}
