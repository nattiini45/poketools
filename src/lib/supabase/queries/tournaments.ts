import { supabase } from '../client';
import type { Tables, TablesInsert, Json } from '@/types/database';
import type { PlayerStatus } from '@/types/player';
import type {
  Tournament,
  TournamentWithDetails,
  TournamentFormData,
  BracketType,
  TournamentStatus,
  TeamVisibility,
  ParticipantWithSeed,
} from '@/types/tournament';
import { parseAdvancementRule, parseBoOverrides, parseEnrollmentSource } from '@/types/tournament';
import type { SeasonFormatType } from '@/types/season';
import type { EnrollmentSource } from '@/types/season';
import { SeedConflictError, SeedUpdatePartialError } from '@/lib/tournament/seed-errors';

type TournamentRow = Tables<'tournaments'>;

function toTournament(row: TournamentRow): Tournament {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    season_id: row.season_id,
    bracket_type: row.bracket_type as BracketType,
    ruleset_id: row.ruleset_id,
    best_of_default: row.best_of_default,
    bo_overrides: parseBoOverrides(row.bo_overrides),
    is_doubles: row.is_doubles,
    team_visibility: row.team_visibility as TeamVisibility,
    status: row.status as TournamentStatus,
    current_round: row.current_round,
    stage_order: row.stage_order,
    advancement_rule: parseAdvancementRule(row.advancement_rule),
    enrollment_source: parseEnrollmentSource(row.enrollment_source),
    archived: row.archived,
    legacy: row.legacy,
    bracket_reset_enabled: row.bracket_reset_enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Participant totals come from a PostgREST count embed,
 * `tournament_participants ( count )`, which arrives as `[{ count: n }]`.
 * Before, list queries pulled every participant's `player_id` just to take
 * the array length.
 */
function embeddedCount(embed: { count: number }[] | null | undefined): number {
  return embed?.[0]?.count ?? 0;
}

/** List ALL tournaments regardless of season or archive status. Superadmin only. */
export async function listAllTournaments(): Promise<TournamentWithDetails[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name ),
      tournament_participants ( count )
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return data.map((row) => ({
    ...toTournament(row),
    ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
    season_name: (row.seasons as { name: string } | null)?.name ?? null,
    participant_count: embeddedCount(row.tournament_participants),
  }));
}

export async function listTournaments(): Promise<TournamentWithDetails[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name ),
      tournament_participants ( count )
    `)
    .is('season_id', null)
    .eq('archived', false)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  return data.map((row) => ({
    ...toTournament(row),
    ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
    season_name: (row.seasons as { name: string } | null)?.name ?? null,
    participant_count: embeddedCount(row.tournament_participants),
  }));
}

export async function listArchivedTournaments(): Promise<TournamentWithDetails[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name ),
      tournament_participants ( count )
    `)
    .is('season_id', null)
    .eq('archived', true)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data.map((row) => ({
    ...toTournament(row),
    ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
    season_name: (row.seasons as { name: string } | null)?.name ?? null,
    participant_count: embeddedCount(row.tournament_participants),
  }));
}

/**
 * Tournaments by id. `archived` narrows by the archived flag (`false` = active
 * only, `true` = archived only, omitted = both). `standaloneOnly` drops league
 * stages (rows with a season_id), like the site admin's `listTournaments`: a
 * season admin's assignments cascade to the league's stages, which belong to
 * the league pages, not to the tournament list.
 */
export async function listTournamentsByIds(
  ids: string[],
  opts: { archived?: boolean; standaloneOnly?: boolean } = {},
): Promise<TournamentWithDetails[]> {
  if (ids.length === 0) return [];

  let query = supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name, format_type ),
      tournament_participants ( count )
    `)
    .in('id', ids);
  if (opts.archived !== undefined) query = query.eq('archived', opts.archived);
  if (opts.standaloneOnly) query = query.is('season_id', null);

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) throw error;

  return data.map((row) => {
    const season = row.seasons as { name: string; format_type: SeasonFormatType } | null;
    return {
      ...toTournament(row),
      ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
      season_name: season?.name ?? null,
      season_format_type: season?.format_type ?? null,
      participant_count: embeddedCount(row.tournament_participants),
    };
  });
}

export async function getTournamentById(id: string): Promise<Tournament | null> {
  // Joins the season's format_type so hot paths (game pipeline, match
  // finalize) can branch on format without a second seasons query.
  const { data, error } = await supabase
    .from('tournaments')
    .select('*, seasons ( format_type )')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...toTournament(data),
    season_format_type:
      (data.seasons as { format_type: SeasonFormatType } | null)?.format_type ?? null,
  };
}

export async function getTournamentWithDetails(
  id: string
): Promise<TournamentWithDetails | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name, format_type ),
      tournament_participants ( count )
    `)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const season = data.seasons as { name: string; format_type: SeasonFormatType } | null;

  return {
    ...toTournament(data),
    ruleset_name: (data.rulesets as { name: string } | null)?.name ?? '',
    season_name: season?.name ?? null,
    season_format_type: season?.format_type ?? null,
    participant_count: embeddedCount(data.tournament_participants),
  };
}

export async function createTournament(input: TournamentFormData): Promise<Tournament> {
  const insertData: TablesInsert<'tournaments'> = {
    name: input.name,
    description: input.description ?? '',
    season_id: input.season_id ?? null,
    bracket_type: input.bracket_type,
    ruleset_id: input.ruleset_id,
    best_of_default: input.best_of_default,
    bo_overrides: (input.bo_overrides as Json) ?? {},
    is_doubles: input.is_doubles,
    team_visibility: input.team_visibility,
    stage_order: input.stage_order ?? 0,
    advancement_rule: (input.advancement_rule as Json) ?? null,
    bracket_reset_enabled: input.bracket_reset_enabled ?? true,
  };

  const { data, error } = await supabase
    .from('tournaments')
    .insert(insertData)
    .select()
    .single();

  if (error) throw error;
  return toTournament(data);
}

export async function getStagesBySeasonId(seasonId: string): Promise<TournamentWithDetails[]> {
  const { data, error } = await supabase
    .from('tournaments')
    .select(`
      *,
      rulesets ( name ),
      seasons ( name ),
      tournament_participants ( count )
    `)
    .eq('season_id', seasonId)
    .order('stage_order');

  if (error) throw error;

  return data.map((row) => ({
    ...toTournament(row),
    ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
    season_name: (row.seasons as { name: string } | null)?.name ?? null,
    participant_count: embeddedCount(row.tournament_participants),
  }));
}

/**
 * Ids per `.in('season_id', …)` filter of the batched stage read, so the request URL stays short for any
 * number of leagues.
 */
const STAGE_BATCH_IDS = 50;

/** The PostgREST `max_rows` ceiling (`supabase/config.toml`): a full page may have been truncated server-side. */
const STAGE_PAGE_SIZE = 1000;

/**
 * The phases of several leagues in one batched read: the same select and mapping as `getStagesBySeasonId`,
 * grouped by league id. Ids are read in chunks of 50 and every chunk is paged with `.range()` until a short page,
 * so neither the URL nor `max_rows` can drop a phase silently. A league without phases maps to an empty list.
 * Each league's phases come in `stage_order`, then creation order. No filter is built from user input: the ids
 * are database ids or `isValidUuid`-checked route params.
 */
export async function getStagesBySeasonIds(seasonIds: string[]): Promise<Map<string, TournamentWithDetails[]>> {
  const unique = [...new Set(seasonIds)];
  const grouped = new Map<string, TournamentWithDetails[]>(unique.map((id) => [id, []]));

  for (let i = 0; i < unique.length; i += STAGE_BATCH_IDS) {
    const chunk = unique.slice(i, i + STAGE_BATCH_IDS);
    for (let from = 0; ; from += STAGE_PAGE_SIZE) {
      const { data, error } = await supabase
        .from('tournaments')
        .select(`
          *,
          rulesets ( name ),
          seasons ( name ),
          tournament_participants ( count )
        `)
        .in('season_id', chunk)
        .order('season_id')
        .order('stage_order')
        .order('created_at')
        .order('id')
        .range(from, from + STAGE_PAGE_SIZE - 1);

      if (error) throw error;
      for (const row of data) {
        const stage: TournamentWithDetails = {
          ...toTournament(row),
          ruleset_name: (row.rulesets as { name: string } | null)?.name ?? '',
          season_name: (row.seasons as { name: string } | null)?.name ?? null,
          participant_count: embeddedCount(row.tournament_participants),
        };
        if (stage.season_id !== null) grouped.get(stage.season_id)?.push(stage);
      }
      if (data.length < STAGE_PAGE_SIZE) break;
    }
  }

  return grouped;
}

export async function updateTournament(
  id: string,
  input: Partial<TournamentFormData> & {
    status?: TournamentStatus;
    current_round?: number;
    archived?: boolean;
    enrollment_source?: EnrollmentSource | null;
  }
): Promise<Tournament> {
  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.season_id !== undefined) updates.season_id = input.season_id;
  if (input.bracket_type !== undefined) updates.bracket_type = input.bracket_type;
  if (input.ruleset_id !== undefined) updates.ruleset_id = input.ruleset_id;
  if (input.best_of_default !== undefined) updates.best_of_default = input.best_of_default;
  if (input.bo_overrides !== undefined) updates.bo_overrides = input.bo_overrides;
  if (input.is_doubles !== undefined) updates.is_doubles = input.is_doubles;
  if (input.team_visibility !== undefined) updates.team_visibility = input.team_visibility;
  if (input.stage_order !== undefined) updates.stage_order = input.stage_order;
  if (input.advancement_rule !== undefined) {
    updates.advancement_rule = input.advancement_rule as Json;
  }
  if (input.status !== undefined) updates.status = input.status;
  if (input.current_round !== undefined) updates.current_round = input.current_round;
  if (input.archived !== undefined) updates.archived = input.archived;
  if (input.bracket_reset_enabled !== undefined) {
    updates.bracket_reset_enabled = input.bracket_reset_enabled;
  }
  if (input.enrollment_source !== undefined) {
    updates.enrollment_source = input.enrollment_source as Json;
  }

  const { data, error } = await supabase
    .from('tournaments')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return toTournament(data);
}

export async function archiveTournamentsBySeason(seasonId: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('tournaments')
    .update({ archived })
    .eq('season_id', seasonId);
  if (error) throw error;
}

export async function deleteTournament(id: string): Promise<void> {
  const { error } = await supabase
    .from('tournaments')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/**
 * Get all tournaments a player is participating in (standalone + league stages).
 */
export async function getTournamentsByPlayer(playerId: string): Promise<TournamentWithDetails[]> {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select('tournament_id')
    .eq('player_id', playerId);

  if (error) throw error;
  if (!data.length) return [];

  const ids = data.map(r => r.tournament_id);
  return listTournamentsByIds(ids);
}

// --- Participant management ---

type StartingBracket = ParticipantWithSeed['starting_bracket'];

function toStartingBracket(value: string | null | undefined): StartingBracket {
  if (value === 'losers') return 'losers';
  return 'winners';
}

function mapParticipantRow(
  row: { seed: number | null; starting_bracket: string | null | undefined; players: Tables<'players'> },
): ParticipantWithSeed {
  const p = row.players;
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
    seed: row.seed,
    starting_bracket: toStartingBracket(row.starting_bracket),
  };
}

export async function getParticipants(tournamentId: string): Promise<ParticipantWithSeed[]> {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select(`
      player_id,
      seed,
      starting_bracket,
      players ( * )
    `)
    .eq('tournament_id', tournamentId);

  if (error) throw error;

  // Sort: seeded first (ascending), then unseeded (alphabetical by name)
  const mapped = data.map((row) =>
    mapParticipantRow({
      seed: row.seed,
      starting_bracket: row.starting_bracket,
      players: row.players as Tables<'players'>,
    }),
  );

  return mapped.sort((a, b) => {
    if (a.seed !== null && b.seed !== null) return a.seed - b.seed;
    if (a.seed !== null) return -1;
    if (b.seed !== null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Batch-fetch participants for multiple tournaments in a single query.
 * Returns a Map keyed by tournament_id. Used by profile composition
 * to avoid N+1 queries when computing standings.
 */
export async function getParticipantsBatch(
  tournamentIds: string[]
): Promise<Map<string, ParticipantWithSeed[]>> {
  if (tournamentIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('tournament_participants')
    .select(`
      tournament_id,
      player_id,
      seed,
      starting_bracket,
      players ( * )
    `)
    .in('tournament_id', tournamentIds);

  if (error) throw error;

  const result = new Map<string, ParticipantWithSeed[]>();
  for (const row of data) {
    const participant = mapParticipantRow({
      seed: row.seed,
      starting_bracket: row.starting_bracket,
      players: row.players as Tables<'players'>,
    });
    const list = result.get(row.tournament_id) ?? [];
    list.push(participant);
    result.set(row.tournament_id, list);
  }

  return result;
}

/**
 * Check if a player is registered as a participant in a tournament.
 * Single-row existence check — used for authorization before team creation and moments.
 */
export async function isPlayerTournamentParticipant(
  playerId: string,
  tournamentId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select('player_id')
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function addParticipant(
  tournamentId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('tournament_participants')
    .insert({ tournament_id: tournamentId, player_id: playerId });

  if (error) throw error;
  await freezeEnrollment(tournamentId);
}

export async function removeParticipant(
  tournamentId: string,
  playerId: string
): Promise<void> {
  const { error } = await supabase
    .from('tournament_participants')
    .delete()
    .eq('tournament_id', tournamentId)
    .eq('player_id', playerId);

  if (error) throw error;
  await freezeEnrollment(tournamentId);
}

/**
 * What `swapTournamentParticipant` did. `swapped` says whether the enrollment
 * row moved: false (nothing written) when the outgoing player is not
 * enrolled, or their row is gone by the UPDATE (a concurrent removal or
 * swap). `seed` is the moved row's seed, null for an unseeded enrollee
 * (`seed` is nullable and `addParticipant` enrolls without one), so a null
 * seed never stands for "nothing moved".
 */
export interface TournamentParticipantSwap {
  swapped: boolean;
  seed: number | null;
}

/**
 * Replace a phase enrollee while preserving their slot: one UPDATE hands the
 * outgoing player's enrollment row to the incoming player, so the seed and the
 * starting bracket (a double-elimination losers-side starter stays one) carry
 * over and no moment leaves the phase without either player. When the
 * incoming player is already enrolled the UPDATE fails on the primary key and
 * changes nothing. The enrollment is frozen before the swap, so a failure
 * after it can never leave the swapped enrollment open to a standings sync.
 * Their group row moves separately (`swapGroupMemberInTournament`).
 */
export async function swapTournamentParticipant(
  tournamentId: string,
  outPlayerId: string,
  inPlayerId: string,
): Promise<TournamentParticipantSwap> {
  const { data: outRow, error: fetchError } = await supabase
    .from('tournament_participants')
    .select('seed')
    .eq('tournament_id', tournamentId)
    .eq('player_id', outPlayerId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!outRow) return { swapped: false, seed: null };

  await freezeEnrollment(tournamentId);

  const { data: swapped, error: swapError } = await supabase
    .from('tournament_participants')
    .update({ player_id: inPlayerId })
    .eq('tournament_id', tournamentId)
    .eq('player_id', outPlayerId)
    .select('seed');

  if (swapError) throw swapError;
  const row = swapped[0];
  return row ? { swapped: true, seed: row.seed } : { swapped: false, seed: null };
}

export { SeedConflictError, SeedUpdatePartialError };

/**
 * Write seeds (and optionally starting brackets) for a tournament's enrollees.
 *
 * `tournament_participants_seed_unique` is a non-deferrable unique index on
 * `(tournament_id, seed) WHERE seed IS NOT NULL`, so writing new seeds row by
 * row collides as soon as two players trade seeds (1 <-> 2). The write is
 * therefore collision-free by construction:
 *
 * 1. One read of the tournament's current seeds. The seeding that would
 *    result is checked for duplicates first: a requested seed held by a
 *    player outside the request throws `SeedConflictError` (409) and nothing
 *    is written.
 * 2. One UPDATE clears (sets null) every requested player whose seed changes.
 *    A single statement, so it lands completely or not at all.
 * 3. The new values are written, one UPDATE per changed row. After step 2 no
 *    requested seed is held by anyone, so these cannot collide with each
 *    other or with the rest of the roster.
 *
 * Unknown player ids are ignored (no row to update), and a row whose seed is
 * unchanged is only written when the request sets its `starting_bracket`.
 * Every non-empty request that completes freezes the phase's enrollment
 * (`freezeEnrollment`), including one that changes nothing: the save records
 * that the admin took control of the seeding.
 * When step 3 fails after anything was written, `SeedUpdatePartialError`
 * (code `SEED_UPDATE_PARTIAL`) reports it distinctly; a failure before any
 * write rethrows the original error.
 */
export async function updateParticipantSeeds(
  tournamentId: string,
  seeds: Array<{
    player_id: string;
    seed: number | null;
    starting_bracket?: StartingBracket;
  }>
): Promise<void> {
  if (seeds.length === 0) return;

  const { data: currentRows, error: readError } = await supabase
    .from('tournament_participants')
    .select('player_id, seed')
    .eq('tournament_id', tournamentId);
  if (readError) throw readError;

  const current = new Map<string, number | null>(
    (currentRows ?? []).map((row) => [row.player_id, row.seed]),
  );
  const requested = new Map<string, (typeof seeds)[number]>();
  for (const entry of seeds) {
    if (current.has(entry.player_id)) requested.set(entry.player_id, entry);
  }

  const resulting = new Map(current);
  for (const [playerId, entry] of requested) resulting.set(playerId, entry.seed);
  const holders = new Set<number>();
  for (const seed of resulting.values()) {
    if (seed === null) continue;
    if (holders.has(seed)) throw new SeedConflictError(seed);
    holders.add(seed);
  }

  const toClear: string[] = [];
  const toWrite: Array<(typeof seeds)[number]> = [];
  for (const [playerId, entry] of requested) {
    const seedChanges = current.get(playerId) !== entry.seed;
    if (seedChanges && current.get(playerId) !== null) toClear.push(playerId);
    const needsSeedWrite = seedChanges && entry.seed !== null;
    if (needsSeedWrite || entry.starting_bracket !== undefined) toWrite.push(entry);
  }
  if (toClear.length === 0 && toWrite.length === 0) {
    // Nothing to write, but the admin still confirmed this seeding (a save
    // without moves, or seed-by-rating matching the current order): freeze
    // it like any other seed save, so a later standings sync cannot replace it.
    await freezeEnrollment(tournamentId);
    return;
  }

  if (toClear.length > 0) {
    const { error: clearError } = await supabase
      .from('tournament_participants')
      .update({ seed: null })
      .eq('tournament_id', tournamentId)
      .in('player_id', toClear);
    if (clearError) throw clearError;
  }

  const results = await Promise.allSettled(
    toWrite.map(async (entry) => {
      // starting_bracket omitted → keep the existing value (never reset silently)
      const update: { seed: number | null; starting_bracket?: StartingBracket } = {
        seed: entry.seed,
      };
      if (entry.starting_bracket !== undefined) {
        update.starting_bracket = entry.starting_bracket;
      }
      const { error } = await supabase
        .from('tournament_participants')
        .update(update)
        .eq('tournament_id', tournamentId)
        .eq('player_id', entry.player_id);
      if (error) throw error;
    }),
  );

  const failures: Array<{ playerId: string; reason: unknown }> = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      failures.push({ playerId: toWrite[index].player_id, reason: result.reason });
    }
  });
  if (failures.length > 0) {
    const anythingWritten = toClear.length > 0 || failures.length < toWrite.length;
    if (!anythingWritten) throw failures[0].reason;
    console.error(
      '[updateParticipantSeeds] Partial seed write:',
      failures.map((failure) => ({ player_id: failure.playerId, error: failure.reason })),
    );
    throw new SeedUpdatePartialError(
      failures.map((failure) => failure.playerId),
      failures.map((failure) => failure.reason),
    );
  }

  await freezeEnrollment(tournamentId);
}

export async function setEnrollmentSource(
  tournamentId: string,
  source: import('@/types/season').EnrollmentSource
): Promise<void> {
  const { error } = await supabase
    .from('tournaments')
    .update({ enrollment_source: source as unknown as Json })
    .eq('id', tournamentId);
  if (error) throw error;
}

export async function freezeEnrollment(tournamentId: string): Promise<void> {
  const tournament = await getTournamentById(tournamentId);
  if (!tournament?.enrollment_source || tournament.enrollment_source.frozen) return;

  await setEnrollmentSource(tournamentId, {
    ...tournament.enrollment_source,
    frozen: true,
  });
}

export async function replacePhaseParticipants(
  tournamentId: string,
  entries: Array<{ player_id: string; seed: number }>
): Promise<void> {
  const { error: delErr } = await supabase
    .from('tournament_participants')
    .delete()
    .eq('tournament_id', tournamentId);
  if (delErr) throw delErr;

  if (entries.length === 0) return;

  const { error: insErr } = await supabase
    .from('tournament_participants')
    .insert(
      entries.map((e) => ({
        tournament_id: tournamentId,
        player_id: e.player_id,
        seed: e.seed,
      }))
    );
  if (insErr) throw insErr;
}

/** Shift stage_order for phases at or after insert position. */
export async function shiftStageOrders(
  seasonId: string,
  fromOrder: number,
  delta: number
): Promise<void> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, stage_order')
    .eq('season_id', seasonId)
    .gte('stage_order', fromOrder);

  if (error) throw error;

  await Promise.all(
    (data ?? []).map(async (row) => {
      const { error } = await supabase
        .from('tournaments')
        .update({ stage_order: row.stage_order + delta })
        .eq('id', row.id);
      if (error) throw error;
    })
  );
}

/** Batch-update stage_order for league phases. */
export async function reorderPhases(
  seasonId: string,
  orderedPhaseIds: string[]
): Promise<void> {
  const results = await Promise.all(
    orderedPhaseIds.map((phaseId, index) =>
      supabase
        .from('tournaments')
        .update({ stage_order: index + 1 })
        .eq('id', phaseId)
        .eq('season_id', seasonId)
    )
  );
  for (const { error } of results) {
    if (error) throw error;
  }
}
