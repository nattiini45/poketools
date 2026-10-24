import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';

export interface AuditLogEntry {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  created_at: string;
}

export interface AttentionMatch {
  id: string;
  tournament_id: string;
  tournament_name: string;
  /** The league the tournament is a phase of; null for a standalone tournament. */
  season_name: string | null;
  player_1_name: string;
  player_2_name: string;
  status: MatchStatus;
  created_at: string;
}

/**
 * `null` means "not available for your role": a resource admin gets no
 * site-wide player and game totals.
 */
export interface DashboardCounts {
  players: number | null;
  tournaments: number;
  active_matches: number;
  seasons: number;
  games: number | null;
}

export interface DashboardData {
  counts: DashboardCounts;
  /** At most ATTENTION_LIMIT rows, newest first. */
  attention_required: AttentionMatch[];
  /** Every match needing attention, so the UI can show "N of M" when truncated. */
  attention_total: number;
  /** Site-wide audit trail; null for a resource admin (not available for your role). */
  recent_activity: AuditLogEntry[] | null;
}

const ATTENTION_LIMIT = 20;
/** Ids per `.in()` filter: keeps the request URL short for an admin with many tournaments. */
const ID_CHUNK_SIZE = 100;

const ACTIVE_STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation'];
const ATTENTION_STATUSES: MatchStatus[] = ['pending_confirmation', 'disputed'];

const ATTENTION_COLUMNS = `
  id,
  tournament_id,
  status,
  created_at,
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

/** Count of the matches in `statuses`; `tournamentIds` null = every tournament. */
async function countMatches(statuses: MatchStatus[], tournamentIds: string[] | null): Promise<number> {
  if (tournamentIds === null) {
    return countOf(
      await supabase.from('matches').select('*', { count: 'exact', head: true }).in('status', statuses)
    );
  }
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
  player_1: { name: string } | null;
  player_2: { name: string } | null;
  tournaments: { name: string; seasons: { name: string } | null } | null;
}

/** The newest matches needing attention plus the real total; `tournamentIds` null = every tournament. */
async function loadAttention(
  tournamentIds: string[] | null
): Promise<{ rows: AttentionMatch[]; total: number }> {
  const groups: Array<string[] | null> = tournamentIds === null ? [null] : chunk(tournamentIds);

  const results = await Promise.all(
    groups.map(async (ids) => {
      let query = supabase
        .from('matches')
        .select(ATTENTION_COLUMNS, { count: 'exact' })
        .in('status', ATTENTION_STATUSES);
      if (ids) query = query.in('tournament_id', ids);
      const result = await query.order('created_at', { ascending: false }).limit(ATTENTION_LIMIT);
      if (result.error) throw result.error;
      return { rows: (result.data ?? []) as unknown as AttentionRow[], total: result.count ?? 0 };
    })
  );

  const rows = results
    .flatMap((r) => r.rows)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, ATTENTION_LIMIT)
    .map((row) => ({
      id: row.id,
      tournament_id: row.tournament_id,
      tournament_name: row.tournaments?.name ?? 'Unknown',
      season_name: row.tournaments?.seasons?.name ?? null,
      player_1_name: row.player_1?.name ?? 'Unknown',
      player_2_name: row.player_2?.name ?? 'Unknown',
      status: row.status as MatchStatus,
      created_at: row.created_at,
    }));

  return { rows, total: results.reduce((sum, r) => sum + r.total, 0) };
}

async function loadRecentActivity(): Promise<AuditLogEntry[]> {
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

/**
 * GET /api/admin/dashboard — the landing dashboard of /admin.
 *
 * A site admin gets the site-wide totals and the audit trail. A resource
 * admin gets the tournament, league, active-match and attention figures of
 * their own scope only; the site-wide player and game totals and the audit
 * trail are `null` (not available for the role). A resource admin whose
 * assignments were all removed gets zeros and an empty list, not an error.
 */
export async function GET() {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    if (scope.isSiteAdmin) {
      const [players, tournaments, seasons, games, activeMatches, attention, recentActivity] =
        await Promise.all([
          supabase.from('players').select('*', { count: 'exact', head: true }),
          supabase.from('tournaments').select('*', { count: 'exact', head: true }),
          supabase.from('seasons').select('*', { count: 'exact', head: true }),
          supabase.from('games').select('*', { count: 'exact', head: true }),
          countMatches(ACTIVE_STATUSES, null),
          loadAttention(null),
          loadRecentActivity(),
        ]);

      return NextResponse.json<ApiResult<DashboardData>>({
        success: true,
        data: {
          counts: {
            players: countOf(players),
            tournaments: countOf(tournaments),
            active_matches: activeMatches,
            seasons: countOf(seasons),
            games: countOf(games),
          },
          attention_required: attention.rows,
          attention_total: attention.total,
          recent_activity: recentActivity,
        },
      });
    }

    const tournamentIds = scope.tournamentIds ?? [];
    const seasonIds = scope.seasonIds ?? [];
    const [activeMatches, attention] = await Promise.all([
      tournamentIds.length > 0 ? countMatches(ACTIVE_STATUSES, tournamentIds) : 0,
      tournamentIds.length > 0 ? loadAttention(tournamentIds) : { rows: [], total: 0 },
    ]);

    return NextResponse.json<ApiResult<DashboardData>>({
      success: true,
      data: {
        counts: {
          players: null,
          tournaments: tournamentIds.length,
          active_matches: activeMatches,
          seasons: seasonIds.length,
          games: null,
        },
        attention_required: attention.rows,
        attention_total: attention.total,
        recent_activity: null,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load dashboard');
  }
}
