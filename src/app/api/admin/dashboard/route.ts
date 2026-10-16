import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { supabase } from '@/lib/supabase/client';
import type { ApiResult } from '@/types/api';
import type { MatchStatus } from '@/types/match';

interface AuditLogEntry {
  id: string;
  actor_name: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  resource_name: string | null;
  created_at: string;
}

interface AttentionMatch {
  id: string;
  tournament_id: string;
  tournament_name: string;
  player_1_name: string;
  player_2_name: string;
  status: MatchStatus;
  created_at: string;
}

export async function GET() {
  try {
    await requireAdmin();

    // Parallel count queries
    const [playersResult, tournamentsResult, seasonsResult, gamesResult] = await Promise.all([
      supabase.from('players').select('*', { count: 'exact', head: true }),
      supabase.from('tournaments').select('*', { count: 'exact', head: true }),
      supabase.from('seasons').select('*', { count: 'exact', head: true }),
      supabase.from('games').select('*', { count: 'exact', head: true }),
    ]);

    const activeMatchesResult = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .in('status', ['scheduled', 'in_progress', 'pending_confirmation'] as MatchStatus[]);

    const counts = {
      players: playersResult.count ?? 0,
      tournaments: tournamentsResult.count ?? 0,
      active_matches: activeMatchesResult.count ?? 0,
      seasons: seasonsResult.count ?? 0,
      games: gamesResult.count ?? 0,
    };

    // Attention-required matches: pending_confirmation + disputed
    const attentionResult = await supabase
      .from('matches')
      .select(`
        id,
        tournament_id,
        status,
        created_at,
        player_1:players!matches_player_1_id_fkey ( name ),
        player_2:players!matches_player_2_id_fkey ( name ),
        tournaments ( name )
      `)
      .in('status', ['pending_confirmation', 'disputed'] as MatchStatus[])
      .order('created_at', { ascending: false })
      .limit(20);

    const attention_required: AttentionMatch[] = (attentionResult.data ?? []).map((row) => ({
      id: row.id,
      tournament_id: row.tournament_id,
      tournament_name: (row.tournaments as { name: string } | null)?.name ?? 'Unknown',
      player_1_name: (row.player_1 as { name: string } | null)?.name ?? 'Unknown',
      player_2_name: (row.player_2 as { name: string } | null)?.name ?? 'Unknown',
      status: row.status as MatchStatus,
      created_at: row.created_at,
    }));

    // Recent activity from audit_log
    const activityResult = await supabase
      .from('audit_log')
      .select('id, actor_name, action, resource_type, resource_id, resource_name, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    const recent_activity: AuditLogEntry[] = (activityResult.data ?? []).map((row) => ({
      id: row.id,
      actor_name: row.actor_name,
      action: row.action,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      resource_name: row.resource_name,
      created_at: row.created_at,
    }));

    return NextResponse.json<ApiResult<{
      counts: typeof counts;
      attention_required: AttentionMatch[];
      recent_activity: AuditLogEntry[];
    }>>({
      success: true,
      data: { counts, attention_required, recent_activity },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load dashboard');
  }
}