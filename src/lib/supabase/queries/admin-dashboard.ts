import { supabase } from '../client';
import { readAllRows, readRowsByIds } from './matches';
import {
  ATTENTION_NOTE_MAX_LENGTH,
  ATTENTION_STATUSES,
  DASHBOARD_ATTENTION_LIMIT,
  type AttentionMatch,
  type AttentionStatus,
  type AuditLogEntry,
} from '@/lib/admin/dashboard';
import type { MatchStatus } from '@/types/match';

/** The competitions the admin dashboard counts and lists matches for. */
export interface ActiveCompetitions {
  /** Active leagues in scope (for a resource admin: the directly assigned ones). */
  seasonIds: string[];
  /** Active tournaments without a league. */
  standaloneTournamentIds: string[];
  /** Every active tournament in scope: standalone ones plus the phases of active leagues. */
  tournamentIds: string[];
}

type TournamentRow = { id: string; season_id: string | null };
type SeasonRow = { id: string; archived: boolean; is_test_season: boolean };

const isActiveSeason = (season: SeasonRow) => !season.archived && !season.is_test_season;

/**
 * The live part of an admin's scope: leagues that are neither archived nor
 * test leagues, and the non-archived tournaments that are standalone or a
 * phase of such a league. `null` scope = unrestricted (site admin).
 *
 * A phase whose league was not read counts as inactive, so a dangling or
 * unreadable league never lets its matches into the dashboard. Archiving a
 * league archives its phases, so `archived = false` on tournaments already
 * covers an archived league; the league check also covers test leagues.
 * Every read pages past the PostgREST row cap or chunks its id list.
 */
export async function listActiveCompetitions(scope: {
  seasonIds: string[] | null;
  tournamentIds: string[] | null;
}): Promise<ActiveCompetitions> {
  const tournamentRows =
    scope.tournamentIds === null
      ? await readAllRows<TournamentRow>((from, to) =>
          supabase
            .from('tournaments')
            .select('id, season_id')
            .eq('archived', false)
            .order('id')
            .range(from, to)
        )
      : await readRowsByIds<TournamentRow>(scope.tournamentIds, (chunk) =>
          supabase
            .from('tournaments')
            .select('id, season_id')
            .in('id', chunk)
            .eq('archived', false)
            .order('id')
        );

  const seasonRows =
    scope.seasonIds === null
      ? await readAllRows<SeasonRow>((from, to) =>
          supabase.from('seasons').select('id, archived, is_test_season').order('id').range(from, to)
        )
      : await readRowsByIds<SeasonRow>(
          [...scope.seasonIds, ...tournamentRows.flatMap((row) => (row.season_id ? [row.season_id] : []))],
          (chunk) => supabase.from('seasons').select('id, archived, is_test_season').in('id', chunk).order('id')
        );

  const activeSeasons = new Set(seasonRows.filter(isActiveSeason).map((season) => season.id));

  const eligible = tournamentRows.filter((row) => row.season_id === null || activeSeasons.has(row.season_id));
  const assignedSeasonIds = scope.seasonIds === null ? null : new Set(scope.seasonIds);

  return {
    seasonIds: [...activeSeasons].filter((id) => assignedSeasonIds === null || assignedSeasonIds.has(id)),
    standaloneTournamentIds: eligible.filter((row) => row.season_id === null).map((row) => row.id),
    tournamentIds: eligible.map((row) => row.id),
  };
}

/** Ids per `.in()` filter: keeps the request URL short for an admin with many tournaments. */
const ID_CHUNK_SIZE = 100;

const ATTENTION_COLUMNS = `
  id,
  tournament_id,
  status,
  created_at,
  updated_at,
  notes,
  player_1:players!matches_player_1_id_fkey ( name ),
  player_2:players!matches_player_2_id_fkey ( name ),
  tournaments ( name, seasons ( name ) )
`;

function chunk(ids: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) chunks.push(ids.slice(i, i + ID_CHUNK_SIZE));
  return chunks;
}

/** Throws the Supabase error of a failed read instead of counting it as zero. */
function countOf(result: { count: number | null; error: unknown }): number {
  if (result.error) throw result.error;
  return result.count ?? 0;
}

/** Count of the matches in `statuses` within `tournamentIds`; no tournaments means no query. */
export async function countMatches(statuses: MatchStatus[], tournamentIds: string[]): Promise<number> {
  const counts = await Promise.all(
    chunk(tournamentIds).map(async (ids) =>
      countOf(
        await supabase
          .from('matches')
          .select('*', { count: 'exact', head: true })
          .in('status', statuses)
          .in('tournament_id', ids)
      )
    )
  );
  return counts.reduce((sum, n) => sum + n, 0);
}

interface AttentionRow {
  id: string;
  tournament_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  notes: string | null;
  player_1: { name: string } | null;
  player_2: { name: string } | null;
  tournaments: { name: string; seasons: { name: string } | null } | null;
}

/** The dispute note of a row: trimmed and capped, null for an empty note or a row that is not disputed. */
function attentionNote(row: AttentionRow): string | null {
  if (row.status !== 'disputed') return null;
  const note = (row.notes ?? '').trim().slice(0, ATTENTION_NOTE_MAX_LENGTH);
  return note === '' ? null : note;
}

/**
 * The matches waiting longest (oldest `updated_at` first) plus the exact
 * per-status totals, within `tournamentIds`. No tournaments means no query.
 */
export async function loadAttention(tournamentIds: string[]): Promise<{
  rows: AttentionMatch[];
  total: number;
  byStatus: Record<AttentionStatus, number>;
}> {
  const [chunked, disputed, pending] = await Promise.all([
    Promise.all(
      chunk(tournamentIds).map(async (ids) => {
        const result = await supabase
          .from('matches')
          .select(ATTENTION_COLUMNS)
          .in('status', [...ATTENTION_STATUSES])
          .in('tournament_id', ids)
          .order('updated_at', { ascending: true })
          .order('id')
          .limit(DASHBOARD_ATTENTION_LIMIT);
        if (result.error) throw result.error;
        return (result.data ?? []) as unknown as AttentionRow[];
      })
    ),
    countMatches(['disputed'], tournamentIds),
    countMatches(['pending_confirmation'], tournamentIds),
  ]);

  // Each chunk holds its own oldest rows, so the oldest rows overall are among the merged ones.
  const rows = chunked
    .flat()
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.id.localeCompare(b.id))
    .slice(0, DASHBOARD_ATTENTION_LIMIT)
    .map(
      (row): AttentionMatch => ({
        id: row.id,
        tournament_id: row.tournament_id,
        tournament_name: row.tournaments?.name ?? null,
        season_name: row.tournaments?.seasons?.name ?? null,
        player_1_name: row.player_1?.name ?? null,
        player_2_name: row.player_2?.name ?? null,
        status: row.status as AttentionStatus,
        created_at: row.created_at,
        updated_at: row.updated_at,
        note: attentionNote(row),
      })
    );

  return {
    rows,
    total: disputed + pending,
    byStatus: { disputed, pending_confirmation: pending },
  };
}

/** The 20 newest audit entries, with the columns the dashboard shows. */
export async function loadRecentActivity(): Promise<AuditLogEntry[]> {
  const result = await supabase
    .from('audit_log')
    .select('id, actor_name, action, resource_type, resource_id, resource_name, created_at')
    .order('created_at', { ascending: false })
    .limit(20);
  if (result.error) throw result.error;
  return (result.data ?? []).map((row) => ({
    id: row.id,
    actor_name: row.actor_name,
    action: row.action,
    resource_type: row.resource_type,
    resource_id: row.resource_id,
    resource_name: row.resource_name,
    created_at: row.created_at,
  }));
}

/** Site-wide totals for a site admin: players (test accounts left out) and games. */
export async function countSiteTotals(): Promise<{ players: number; games: number }> {
  const [players, games] = await Promise.all([
    supabase.from('players').select('*', { count: 'exact', head: true }).eq('is_test_account', false),
    supabase.from('games').select('*', { count: 'exact', head: true }),
  ]);
  return { players: countOf(players), games: countOf(games) };
}