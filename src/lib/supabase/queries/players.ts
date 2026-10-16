import { supabase } from '../client';
import type { Tables, TablesInsert } from '@/types/database';
import type {
  Player,
  PlayerRegistration,
  PlayerUpdate,
  PublicPlayerDirectoryEntry,
  WorldExperience,
} from '@/types/player';
import { DEFAULT_WORLD_EXPERIENCE, isWorldExperience } from '@/types/player';
import type { PlayerStatus } from '@/types/player';
import type { AvatarConfig } from '@/types/avatar';
import type { AuthProvider, SessionPlayer } from '@/types/auth';

type PlayerRow = Tables<'players'>;

export function toPlayer(row: PlayerRow): Player {
  return {
    id: row.id,
    name: row.name,
    discord_id: row.discord_id,
    auth_user_id: row.auth_user_id,
    ps_username: row.ps_username,
    champions_username: row.champions_username,
    is_admin: row.is_admin,
    is_creator: row.is_creator,
    is_guest: row.is_guest,
    is_test_account: row.is_test_account,
    joined_date: row.joined_date,
    avatar_url: row.avatar_url ?? null,
    avatar_config: (row.avatar_config as unknown as AvatarConfig) ?? null,
    status: row.status as Player['status'],
    suspended_until: row.suspended_until,
    ban_reason: row.ban_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ── Auth session read ─────────────────────────────────────────────────

/**
 * Explicit columns for the auth session read (DATA-PLAN fixes 3 and 3b).
 * These are exactly the fields `SessionPlayer` needs, plus an embedded count of
 * the player's `resource_admins` rows. The token refresh and the live guard
 * check are therefore one PostgREST round trip each.
 *
 * The result feeds the session JWT, so never add identity or moderation
 * columns here (`discord_id`, `auth_user_id`, `ban_reason`, `suspended_until`,
 * `is_test_account`, `avatar_config`).
 */
export const SESSION_PLAYER_COLUMNS =
  'id, name, is_admin, is_creator, ps_username, champions_username, avatar_url, status, resource_admins(count)';

const PLAYER_STATUSES: readonly PlayerStatus[] = ['active', 'suspended', 'banned'];

/** The narrow player row behind a signed-in identity. */
export interface SessionPlayerRow {
  id: string;
  name: string;
  is_admin: boolean;
  is_creator: boolean;
  ps_username: string;
  champions_username: string;
  avatar_url: string | null;
  status: PlayerStatus;
  /** Number of `resource_admins` rows held by this player (embedded count). */
  resource_admin_count: number;
}

function parsePlayerStatus(value: string): PlayerStatus {
  const status = PLAYER_STATUSES.find((s) => s === value);
  // players_status_check makes this unreachable. If it ever happens, throw
  // rather than guess a status: guards must not treat an unknown status as active.
  if (!status) {
    throw new Error(`[getSessionPlayerRowByIdentity] Unexpected player status: ${value}`);
  }
  return status;
}

/**
 * One narrow read of the player behind a signed-in identity: Discord
 * snowflake for 'discord', Supabase auth user UUID for 'credentials'.
 * Returns null when no player is linked to the identity. Query errors rethrow.
 */
export async function getSessionPlayerRowByIdentity(
  provider: AuthProvider,
  identityId: string
): Promise<SessionPlayerRow | null> {
  const column = provider === 'credentials' ? 'auth_user_id' : 'discord_id';
  const { data, error } = await supabase
    .from('players')
    .select(SESSION_PLAYER_COLUMNS)
    .eq(column, identityId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    is_admin: data.is_admin,
    is_creator: data.is_creator,
    ps_username: data.ps_username,
    champions_username: data.champions_username,
    avatar_url: data.avatar_url ?? null,
    status: parsePlayerStatus(data.status),
    resource_admin_count: data.resource_admins[0]?.count ?? 0,
  };
}

/**
 * Map a session row to the `SessionPlayer` stored in the JWT. Picks fields
 * explicitly, so extra properties on the input (for example a full `Player`
 * from `createPlayer`) never reach the token.
 */
export function toSessionPlayer(row: SessionPlayerRow): SessionPlayer {
  return {
    playerId: row.id,
    name: row.name,
    isAdmin: row.is_admin,
    isResourceAdmin: row.resource_admin_count > 0,
    isCreator: row.is_creator,
    psUsername: row.ps_username,
    championsUsername: row.champions_username,
    avatarUrl: row.avatar_url,
    status: row.status,
  };
}

export async function getPlayerByDiscordId(discordId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('discord_id', discordId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayer(data) : null;
}

/** Find a player by their Supabase Auth user ID (email/password login). */
export async function getPlayerByAuthUserId(authUserId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayer(data) : null;
}

/**
 * Attach a Discord identity to an existing player.
 * Guarded: only succeeds if the player has no discord_id yet.
 */
export async function linkDiscordToPlayer(playerId: string, discordId: string): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update({ discord_id: discordId })
    .eq('id', playerId)
    .is('discord_id', null)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

/**
 * Attach a Supabase Auth user to an existing player.
 * Guarded: only succeeds if the player has no auth_user_id yet.
 */
export async function linkAuthUserToPlayer(playerId: string, authUserId: string): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update({ auth_user_id: authUserId })
    .eq('id', playerId)
    .is('auth_user_id', null)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

export async function getPlayerById(id: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayer(data) : null;
}

/**
 * Find a player by their Pokémon Showdown username (case-insensitive).
 * Used for replay parsing to match PS usernames to internal player IDs.
 */
export async function getPlayerByPsUsername(psUsername: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .ilike('ps_username', psUsername)
    .maybeSingle();

  if (error) throw error;
  return data ? toPlayer(data) : null;
}

/**
 * Batch-fetch multiple players by ID in a single query.
 * Returns a Map keyed by player ID for O(1) lookup.
 */
export async function getPlayersByIds(ids: string[]): Promise<Map<string, Player>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .in('id', ids);

  if (error) throw error;

  const result = new Map<string, Player>();
  for (const row of data) {
    result.set(row.id, toPlayer(row));
  }
  return result;
}

export async function getPlayersByDiscordIds(discordIds: string[]): Promise<Map<string, Player>> {
  if (discordIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .in('discord_id', discordIds);

  if (error) throw error;

  const result = new Map<string, Player>();
  for (const row of data) {
    if (row.discord_id) {
      result.set(row.discord_id, toPlayer(row));
    }
  }
  return result;
}

export async function listPlayers(
  options?: { limit?: number; offset?: number; search?: string }
): Promise<{ data: Player[]; total: number }> {
  const limit = Math.min(options?.limit ?? 50, 200);
  const offset = options?.offset ?? 0;

  let query = supabase
    .from('players')
    .select('*', { count: 'exact' })
    .order('name')
    .range(offset, offset + limit - 1);

  if (options?.search) {
    query = query.ilike('name', `${options.search}%`);
  }

  const { data, error, count } = await query;

  if (error) throw error;
  return { data: data.map(toPlayer), total: count ?? 0 };
}

export async function createPlayer(input: PlayerRegistration): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .insert(playerInsert(input))
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

function playerInsert(input: PlayerRegistration): TablesInsert<'players'> {
  if (!input.discord_id && !input.auth_user_id && !input.is_guest) {
    throw new Error('Player registration requires a discord_id, auth_user_id, or is_guest');
  }
  return {
    name: input.name,
    discord_id: input.discord_id ?? null,
    auth_user_id: input.auth_user_id ?? null,
    ps_username: input.ps_username ?? '',
    champions_username: input.champions_username ?? '',
    is_guest: input.is_guest ?? false,
  };
}

export async function createPlayersBatch(inputs: PlayerRegistration[]): Promise<Player[]> {
  if (inputs.length === 0) return [];

  const { data, error } = await supabase
    .from('players')
    .insert(inputs.map(playerInsert))
    .select();

  if (error) throw error;
  return data.map(toPlayer);
}

export async function upsertPlayersByDiscordId(inputs: PlayerRegistration[]): Promise<Player[]> {
  if (inputs.length === 0) return [];

  const { data, error } = await supabase
    .from('players')
    .upsert(inputs.map(playerInsert), { onConflict: 'discord_id' })
    .select();

  if (error) throw error;
  return data.map(toPlayer);
}

export async function updatePlayer(id: string, input: PlayerUpdate): Promise<Player> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.ps_username !== undefined) updates.ps_username = input.ps_username;
  if (input.champions_username !== undefined) updates.champions_username = input.champions_username;
  if (input.is_admin !== undefined) updates.is_admin = input.is_admin;
  if (input.is_creator !== undefined) updates.is_creator = input.is_creator;
  if (input.avatar_url !== undefined) updates.avatar_url = input.avatar_url;
  if (input.avatar_config !== undefined) updates.avatar_config = input.avatar_config;

  const { data, error } = await supabase
    .from('players')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

export async function deletePlayer(id: string): Promise<void> {
  const { error } = await supabase
    .from('players')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Single-column PK read of the player's 3D world experience preference.
 * Unknown or missing stored values coerce to DEFAULT_WORLD_EXPERIENCE ('off')
 * rather than throwing — a bad preference must never break a world render.
 * Query errors rethrow.
 */
export async function getPlayerWorldExperience(playerId: string): Promise<WorldExperience> {
  const { data, error } = await supabase
    .from('players')
    .select('world_experience')
    .eq('id', playerId)
    .maybeSingle();

  if (error) throw error;
  const stored = data?.world_experience;
  return isWorldExperience(stored) ? stored : DEFAULT_WORLD_EXPERIENCE;
}

/** Persist the player's 3D world experience preference (own-row writes only). */
export async function setPlayerWorldExperience(
  playerId: string,
  value: WorldExperience
): Promise<void> {
  const { error } = await supabase
    .from('players')
    .update({ world_experience: value })
    .eq('id', playerId);

  if (error) throw error;
}

export interface PlayerActivityCounts {
  seasonParticipations: number;
  tournamentParticipations: number;
  matchCount: number;
  teamCount: number;
  matchProposals: number;
  draftPicks: number;
  wikiNotes: number;
  evolutionTrackerRows: number;
}

/** Count participations/matches/teams for claim-guard checks. */
export async function getPlayerActivityCounts(playerId: string): Promise<PlayerActivityCounts> {
  const [
    { count: seasonParticipations, error: seasonError },
    { count: tournamentParticipations, error: tournamentError },
    { count: matchCount, error: matchError },
    { count: teamCount, error: teamError },
    { count: matchProposalsAsProposer, error: proposerError },
    { count: matchProposalsAsResponder, error: responderError },
    { count: draftPicks, error: draftError },
    { count: wikiNotes, error: wikiError },
    { count: evolutionTrackerRows, error: evolutionError },
  ] = await Promise.all([
    supabase
      .from('season_participants')
      .select('player_id', { count: 'exact', head: true })
      .eq('player_id', playerId),
    supabase
      .from('tournament_participants')
      .select('player_id', { count: 'exact', head: true })
      .eq('player_id', playerId),
    supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`),
    supabase
      .from('teams')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
    supabase
      .from('match_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('proposer_id', playerId),
    supabase
      .from('match_proposals')
      .select('id', { count: 'exact', head: true })
      .eq('responder_id', playerId),
    supabase
      .from('draft_picks')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
    supabase
      .from('wiki_notes')
      .select('id', { count: 'exact', head: true })
      .eq('author_id', playerId),
    supabase
      .from('evolution_tracker')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', playerId),
  ]);

  if (seasonError) throw seasonError;
  if (tournamentError) throw tournamentError;
  if (matchError) throw matchError;
  if (teamError) throw teamError;
  if (proposerError) throw proposerError;
  if (responderError) throw responderError;
  if (draftError) throw draftError;
  if (wikiError) throw wikiError;
  if (evolutionError) throw evolutionError;

  return {
    seasonParticipations: seasonParticipations ?? 0,
    tournamentParticipations: tournamentParticipations ?? 0,
    matchCount: matchCount ?? 0,
    teamCount: teamCount ?? 0,
    matchProposals: (matchProposalsAsProposer ?? 0) + (matchProposalsAsResponder ?? 0),
    draftPicks: draftPicks ?? 0,
    wikiNotes: wikiNotes ?? 0,
    evolutionTrackerRows: evolutionTrackerRows ?? 0,
  };
}

/**
 * Transfer auth identity from a fresh empty account onto a guest row, then
 * delete the empty account. Caller must validate eligibility first.
 */
export async function claimGuestPlayer(
  guestId: string,
  sourcePlayerId: string,
): Promise<Player> {
  const [guest, source] = await Promise.all([
    getPlayerById(guestId),
    getPlayerById(sourcePlayerId),
  ]);

  if (!guest || !guest.is_guest) {
    throw new Error('Target player is not a guest account');
  }
  if (!source || source.is_guest) {
    throw new Error('Source player is not a valid registered account');
  }
  if (!source.discord_id && !source.auth_user_id) {
    throw new Error('Source player has no linked auth identity');
  }

  // Clear unique auth columns on the source row before attaching to guest.
  const { error: clearError } = await supabase
    .from('players')
    .update({ discord_id: null, auth_user_id: null })
    .eq('id', sourcePlayerId);

  if (clearError) throw clearError;

  const { data: claimed, error: claimError } = await supabase
    .from('players')
    .update({
      discord_id: source.discord_id,
      auth_user_id: source.auth_user_id,
      is_guest: false,
    })
    .eq('id', guestId)
    .select()
    .single();

  if (claimError) throw claimError;

  const { error: deleteError } = await supabase
    .from('players')
    .delete()
    .eq('id', sourcePlayerId);

  if (deleteError) throw deleteError;

  return toPlayer(claimed);
}

/**
 * Counts the NOT NULL competitive references that block a hard delete — matches
 * the player has played (as player 1 or 2) and match proposals they've sent or
 * received. These columns cannot be nulled out, and cascading them would destroy
 * opponents' tournament history, so the delete route refuses with a 409 when
 * either count is non-zero (admins suspend/ban competitors instead).
 *
 * `leagueHistory` counts the remaining ON DELETE NO ACTION references to
 * players that the 20260619 player-deletion migration did not cover (the
 * EvoLiga / EPB history tables added later, plus rating_history.opponent_id).
 * Any of them blocks the DELETE with SQLSTATE 23503, so the route refuses
 * up front with a coded 409 instead of attempting the delete:
 *   rating_history.opponent_id, match_evolution_snapshots.player_id,
 *   redraft_history.player_id / trade_partner_id, evolution_events.player_id,
 *   epb_token_grants.player_id / created_by, evo_progress_log.created_by,
 *   redraft_trade_requests.initiated_by / player_a_id / player_b_id / cancelled_by.
 *
 * `activeDrafts` (design decision) counts the player's seats in a
 * queue-engine draft that is still unfinished (phase not `complete` or
 * `cancelled`). The FK would cascade, but deleting a seated player mid-draft
 * would corrupt the draft order, so the route refuses with a coded 409 until
 * the draft is finished or cancelled, or the player is removed from it.
 *
 * Otherwise the draft-queue tables (migrations M2–M4) add no blocking reference: rows a
 * player owns (draft_participants, draft_slots, draft_line_restrictions,
 * redraft_submissions, redraft_slots, epb_draft_token_purchases,
 * epb_comeback_token_spends) cascade like draft_picks.player_id, and actor
 * columns (paused_by, created_by, made_by, voided_by) are set to NULL.
 */
export interface PlayerCompetitiveRefs {
  matches: number;
  proposals: number;
  leagueHistory: number;
  /** Seats in unfinished queue-engine drafts (draft_participants of a pool not complete/cancelled). */
  activeDrafts: number;
}

export async function getPlayerCompetitiveRefs(id: string): Promise<PlayerCompetitiveRefs> {
  // Parameterized .eq() counts (no .or() filter-string interpolation) — a player
  // can appear in several columns, so count each and sum. Over-counting is
  // harmless: the caller only checks whether the totals are > 0.
  const head = { count: 'exact', head: true } as const;
  const [activeSeats, asPlayer1, asPlayer2, asProposer, asResponder, ...history] = await Promise.all([
    supabase
      .from('draft_participants')
      .select('draft_pool_id, draft_pools!inner(engine, phase)', head)
      .eq('player_id', id)
      .eq('draft_pools.engine', 'queue')
      .not('draft_pools.phase', 'in', '(complete,cancelled)'),
    supabase.from('matches').select('id', head).eq('player_1_id', id),
    supabase.from('matches').select('id', head).eq('player_2_id', id),
    supabase.from('match_proposals').select('id', head).eq('proposer_id', id),
    supabase.from('match_proposals').select('id', head).eq('responder_id', id),
    supabase.from('rating_history').select('id', head).eq('opponent_id', id),
    supabase.from('match_evolution_snapshots').select('id', head).eq('player_id', id),
    supabase.from('redraft_history').select('id', head).eq('player_id', id),
    supabase.from('redraft_history').select('id', head).eq('trade_partner_id', id),
    supabase.from('evolution_events').select('id', head).eq('player_id', id),
    supabase.from('epb_token_grants').select('player_id', head).eq('player_id', id),
    supabase.from('epb_token_grants').select('player_id', head).eq('created_by', id),
    supabase.from('evo_progress_log').select('id', head).eq('created_by', id),
    supabase.from('redraft_trade_requests').select('id', head).eq('initiated_by', id),
    supabase.from('redraft_trade_requests').select('id', head).eq('player_a_id', id),
    supabase.from('redraft_trade_requests').select('id', head).eq('player_b_id', id),
    supabase.from('redraft_trade_requests').select('id', head).eq('cancelled_by', id),
  ]);

  for (const result of [activeSeats, asPlayer1, asPlayer2, asProposer, asResponder, ...history]) {
    if (result.error) throw result.error;
  }

  return {
    matches: (asPlayer1.count ?? 0) + (asPlayer2.count ?? 0),
    proposals: (asProposer.count ?? 0) + (asResponder.count ?? 0),
    leagueHistory: history.reduce((sum, result) => sum + (result.count ?? 0), 0),
    activeDrafts: activeSeats.count ?? 0,
  };
}

/**
 * Permanently ban a player. Clears any active suspension.
 */
export async function banPlayer(id: string, banReason: string): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'banned',
      ban_reason: banReason,
      suspended_until: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

/**
 * Suspend a player until the given timestamp. Sets suspended_until.
 */
export async function suspendPlayer(id: string, suspendedUntil: string): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'suspended',
      suspended_until: suspendedUntil,
      ban_reason: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

/**
 * Reinstate a suspended or banned player to active status.
 */
export async function unsuspendPlayer(id: string): Promise<Player> {
  const { data, error } = await supabase
    .from('players')
    .update({
      status: 'active',
      suspended_until: null,
      ban_reason: null,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toPlayer(data);
}

/**
 * Get all tournament IDs a player is participating in.
 * Used by the profile composition function to fetch participation details.
 */
export async function getPlayerParticipations(
  playerId: string
): Promise<{ tournamentIds: string[] }> {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select('tournament_id')
    .eq('player_id', playerId);

  if (error) throw error;

  return {
    tournamentIds: data.map((r) => r.tournament_id),
  };
}

/**
 * Resolve a list of player IDs to a map of id → name.
 */
export async function resolvePlayerNames(
  playerIds: string[]
): Promise<Record<string, string>> {
  if (playerIds.length === 0) return {};

  const { data, error } = await supabase
    .from('players')
    .select('id, name')
    .in('id', playerIds);

  if (error) throw error;

  const map: Record<string, string> = {};
  for (const row of data) {
    map[row.id] = row.name;
  }
  return map;
}

/**
 * Public player directory — no Discord IDs or usernames.
 */
export async function getPublicPlayers(
  options?: { limit?: number; offset?: number; search?: string },
): Promise<{ data: PublicPlayerDirectoryEntry[]; total: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 50);
  const offset = Math.max(options?.offset ?? 0, 0);
  const search = options?.search?.trim();

  if (search && search.length > 64) {
    return { data: [], total: 0 };
  }

  let query = supabase
    .from('players')
    .select('id, name, avatar_url, is_creator, is_guest', { count: 'exact' })
    .eq('status', 'active')
    .eq('is_test_account', false)
    .order('name')
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const playerIds = data.map((row) => row.id);
  const ratingsMap = new Map<string, { rating: number; rd: number }>();

  if (playerIds.length > 0) {
    const { data: ratings, error: ratingsErr } = await supabase
      .from('player_ratings')
      .select('player_id, rating, rd')
      .in('player_id', playerIds);

    if (ratingsErr) throw ratingsErr;
    for (const row of ratings) {
      ratingsMap.set(row.player_id, { rating: row.rating, rd: row.rd });
    }
  }

  const entries: PublicPlayerDirectoryEntry[] = data.map((row) => {
    const ratingRow = ratingsMap.get(row.id);
    return {
      id: row.id,
      name: row.name,
      avatar_url: row.avatar_url,
      is_creator: row.is_creator,
      is_guest: row.is_guest,
      rating: ratingRow?.rating ?? null,
      rd: ratingRow?.rd ?? null,
    };
  });

  return { data: entries, total: count ?? 0 };
}
