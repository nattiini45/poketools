/**
 * The narrow reads behind the dashboard's "Now" queue (`/dashboard`): what waits for one player besides their matches.
 * Server only. Every read is scoped to the player and selects named columns; the format reads are batched over the
 * player's running custom leagues, so their cost does not grow with the number of leagues.
 */
import 'server-only';

import type { FormatDefinition } from '@/lib/format-kit/types';
import type { Json } from '@/types/database';
import type { MatchWithPlayers } from '@/types/match';
import { assertValidUuid } from '@/lib/utils/uuid';
import { readAllPages } from '../read-all-pages';
import { supabase } from '../client';

type DashboardMatchFields = Pick<MatchWithPlayers,
  'id' | 'created_at' | 'date_played' | 'scheduled_at' | 'status' | 'winner_id' | 'submitter_id' |
  'player_1_id' | 'player_2_id' | 'player_1_name' | 'player_2_name' | 'round_status'>;

export type DashboardTournamentMatch = DashboardMatchFields & { tournament_id: string };

export type DashboardPhaseMatch = DashboardMatchFields & {
  phase_id: string;
  season_id: string;
  season_name: string;
};

const MATCH_FIELDS = 'id, created_at, date_played, scheduled_at, status, winner_id, submitter_id, player_1_id, player_2_id';

export async function listStandaloneDashboardMatches(playerId: string): Promise<DashboardTournamentMatch[]> {
  assertValidUuid(playerId, 'playerId');
  const { data, error } = await supabase.from('matches')
    .select(`
      ${MATCH_FIELDS}, tournament_id,
      player_1:players!matches_player_1_id_fkey (name),
      player_2:players!matches_player_2_id_fkey (name),
      round:rounds!matches_round_id_fkey (status),
      owner:tournaments!matches_tournament_id_fkey!inner (season_id)
    `)
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
    .is('owner.season_id', null)
    .order('date_played', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data.map(({ owner: _owner, round, player_1, player_2, ...row }) => ({
    ...row,
    round_status: round?.status ?? 'pending',
    player_1_name: player_1.name,
    player_2_name: player_2.name,
  }));
}

export async function listDashboardPhaseMatches(playerId: string): Promise<DashboardPhaseMatch[]> {
  assertValidUuid(playerId, 'playerId');
  const { data, error } = await supabase.from('phase_matches')
    .select(`
      ${MATCH_FIELDS}, phase_id,
      player_1:players!phase_matches_player_1_id_fkey (name),
      player_2:players!phase_matches_player_2_id_fkey (name),
      round:phase_rounds!phase_matches_phase_round_fkey (status),
      phase:league_phases!phase_matches_phase_id_fkey!inner (season_id, season:seasons!inner (name))
    `)
    .or(`player_1_id.eq.${playerId},player_2_id.eq.${playerId}`)
    .order('date_played', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data.map(({ phase, round, player_1, player_2, ...row }) => ({
    ...row,
    season_id: phase.season_id,
    season_name: phase.season.name,
    round_status: round.status,
    player_1_name: player_1.name,
    player_2_name: player_2.name,
  }));
}

export interface PlayerPhaseTeamSlot {
  phase_id: string;
  match_id: string | null;
}

export async function listPlayerPhaseTeamSlots(playerId: string, phaseIds: readonly string[]): Promise<PlayerPhaseTeamSlot[]> {
  const unique = [...new Set(phaseIds)];
  const rows: PlayerPhaseTeamSlot[] = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    rows.push(...await readAllPages((from, to) => supabase.from('phase_teams')
      .select('phase_id, match_id').eq('player_id', playerId).in('phase_id', unique.slice(offset, offset + 50))
      .order('id').range(from, to)));
  }
  return rows;
}

/** A queue-engine draft slot that is running for the player: they are on the clock in that pool. */
export interface ActiveDraftTurnRow {
  pool_id: string;
  /** `initial` or `redraft`. */
  pool_kind: string;
  paused: boolean;
  deadline_at: string | null;
  season_id: string;
  season_name: string;
  season_format_type: string;
}

interface SlotEmbed {
  deadline_at: string | null;
  draft_pools: {
    id: string;
    kind: string;
    paused_at: string | null;
    seasons: { id: string; name: string; format_type: string; archived: boolean };
  };
}

/**
 * The pools where `playerId` holds the active slot of a running draft (queue engine; a legacy pool has no slots). A
 * paused pool is listed with `paused`: its clock stands still. Archived leagues are left out.
 */
export async function listActiveDraftTurns(playerId: string): Promise<ActiveDraftTurnRow[]> {
  const { data, error } = await supabase
    .from('draft_slots')
    .select('deadline_at, draft_pools!inner ( id, kind, paused_at, status, seasons!inner ( id, name, format_type, archived ) )')
    .eq('player_id', playerId)
    .eq('status', 'active')
    .eq('draft_pools.status', 'in_progress')
    .order('deadline_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data as unknown as SlotEmbed[])
    .filter((row) => !row.draft_pools.seasons.archived)
    .map((row) => ({
      pool_id: row.draft_pools.id,
      pool_kind: row.draft_pools.kind,
      paused: row.draft_pools.paused_at !== null,
      deadline_at: row.deadline_at,
      season_id: row.draft_pools.seasons.id,
      season_name: row.draft_pools.seasons.name,
      season_format_type: row.draft_pools.seasons.format_type,
    }));
}

/** Which team rows a player has in a set of tournaments: the tournament and the match a row is linked to (or none). */
export interface PlayerTeamSlotRow {
  tournament_id: string | null;
  match_id: string | null;
}

/** The player's team rows in `tournamentIds`, as slots only (no roster is read). No request for an empty list. */
export async function listPlayerTeamSlots(playerId: string, tournamentIds: readonly string[]): Promise<PlayerTeamSlotRow[]> {
  if (tournamentIds.length === 0) return [];
  const { data, error } = await supabase
    .from('teams')
    .select('tournament_id, match_id')
    .eq('player_id', playerId)
    .in('tournament_id', [...tournamentIds]);
  if (error) throw error;
  return data;
}

/** What the queue needs to know about one player's open business in their running kit leagues. */
export interface PlayerFormatFacts {
  formats: { season_id: string; spec: FormatDefinition }[];
  /** The `action:<id>` window flags of those leagues. */
  flags: { season_id: string; key: string; value: Json }[];
  /** The player's own submissions. */
  submissions: { season_id: string; action_key: string; status: string }[];
  /** The relations the player holds a link from. */
  links: { season_id: string; relation_key: string }[];
  /** Open challenges addressed to the player whose accept window has not passed. */
  challenges: { season_id: string; expires_at: string }[];
}

const NO_FORMAT_FACTS: PlayerFormatFacts = { formats: [], flags: [], submissions: [], links: [], challenges: [] };

/**
 * The format facts of `playerId` in `seasonIds` (their running custom leagues): one wave of five reads whatever the
 * number of leagues, and no request at all for an empty list. Only leagues on the `kit` engine are returned in
 * `formats`; rows of the other reads are the player's own.
 */
export async function getPlayerFormatFacts(playerId: string, seasonIds: readonly string[], now: Date = new Date()): Promise<PlayerFormatFacts> {
  if (seasonIds.length === 0) return NO_FORMAT_FACTS;
  const ids = [...seasonIds];
  const [formats, flags, submissions, links, challenges] = await Promise.all([
    supabase.from('season_formats').select('season_id, spec').eq('engine', 'kit').in('season_id', ids),
    supabase.from('format_flags').select('season_id, key, value').like('key', 'action:%').in('season_id', ids),
    supabase.from('format_action_submissions').select('season_id, action_key, status').eq('actor_player_id', playerId).in('season_id', ids),
    supabase.from('format_relation_links').select('season_id, relation_key').eq('from_player_id', playerId).in('season_id', ids),
    supabase
      .from('format_challenges')
      .select('season_id, expires_at')
      .eq('defender_id', playerId)
      .eq('status', 'open')
      .gt('expires_at', now.toISOString())
      .in('season_id', ids),
  ]);
  for (const result of [formats, flags, submissions, links, challenges]) if (result.error) throw result.error;
  return {
    formats: (formats.data ?? []).map((row) => ({ season_id: row.season_id, spec: row.spec as unknown as FormatDefinition })),
    flags: flags.data ?? [],
    submissions: submissions.data ?? [],
    links: links.data ?? [],
    challenges: challenges.data ?? [],
  };
}
