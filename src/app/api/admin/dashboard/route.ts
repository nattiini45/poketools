import { NextResponse } from 'next/server';
import { requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import { listActiveCompetitions } from '@/lib/supabase/queries/admin-dashboard';
import {
  ATTENTION_NOTE_MAX_LENGTH,
  ATTENTION_STATUSES,
  DASHBOARD_ATTENTION_LIMIT,
  type AttentionMatch,
  type AttentionStatus,
  type AuditLogEntry,
  type DashboardData,
} from '@/lib/admin/dashboard';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';

export type { AttentionMatch, AuditLogEntry, DashboardCounts, DashboardData } from '@/lib/admin/dashboard';

/** Ids per `.in()` filter: keeps the request URL short for an admin with many tournaments. */
const ID_CHUNK_SIZE = 100;

const ACTIVE_STATUSES: MatchStatus[] = ['scheduled', 'in_progress', 'pending_confirmation'];

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
async function countMatches(statuses: MatchStatus[], tournamentIds: string[]): Promise<number> {
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
async function loadAttention(tournamentIds: string[]): Promise<{
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
 * Counts and the attention list cover live competitions only: test leagues
 * and archived leagues and tournaments are left out, and the site-wide player
 * total skips test accounts. The list is the 20 matches that have waited
 * longest, with exact per-status totals.
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

    const active = await listActiveCompetitions({
      seasonIds: scope.seasonIds,
      tournamentIds: scope.tournamentIds,
    });

    const [activeMatches, attention] = await Promise.all([
      countMatches(ACTIVE_STATUSES, active.tournamentIds),
      loadAttention(active.tournamentIds),
    ]);

    const counts = {
      tournaments: active.standaloneTournamentIds.length,
      active_matches: activeMatches,
      leagues: active.seasonIds.length,
    };
    const attentionData = {
      attention_required: attention.rows,
      attention_total: attention.total,
      attention_by_status: attention.byStatus,
    };

    if (scope.isSiteAdmin) {
      const [players, games, recentActivity] = await Promise.all([
        supabase.from('players').select('*', { count: 'exact', head: true }).eq('is_test_account', false),
        supabase.from('games').select('*', { count: 'exact', head: true }),
        loadRecentActivity(),
      ]);

      return NextResponse.json<ApiResult<DashboardData>>({
        success: true,
        data: {
          counts: { players: countOf(players), ...counts, games: countOf(games) },
          ...attentionData,
          recent_activity: recentActivity,
        },
      });
    }

    return NextResponse.json<ApiResult<DashboardData>>({
      success: true,
      data: {
        counts: { players: null, ...counts, games: null },
        ...attentionData,
        recent_activity: null,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load dashboard');
  }
}
