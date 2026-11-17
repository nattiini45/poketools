import 'server-only';

import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import { mapKitCronPhases, UNCOMPLETED_MATCH_CHUNK, type CronPhaseRow } from './format-cron';
import { mapFormatRuntimeDbError, type CompleteFormatForfeitInput } from './format-runtime';
import type { CronFinalizedMatch, CronPendingMatch } from '@/lib/format-engine/runtime/cron';

function phaseChunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / 50) }, (_, index) => unique.slice(index * 50, (index + 1) * 50));
}

export async function listNativeKitCronPhases() {
  const { rows } = await readBoundedPages<CronPhaseRow>((from, to) => supabase.from('league_phases')
    .select('id, season_id, status, format_stage_key, stage_spec, seasons!inner(start_date, status, archived, season_formats!inner(engine, clock_shift_seconds))')
    .not('format_stage_key', 'is', null).in('status', ['upcoming', 'active']).in('seasons.status', ['upcoming', 'active'])
    .eq('seasons.archived', false).eq('seasons.season_formats.engine', 'kit').order('id').range(from, to),
  { label: 'native format-cron phases' });
  return mapKitCronPhases(rows);
}

export async function listNativeFinalizedMatches(phaseIds: readonly string[]): Promise<CronFinalizedMatch[]> {
  const result: (CronFinalizedMatch & { finalized_at: string | null })[] = [];
  for (const ids of phaseChunks(phaseIds)) {
    const { rows } = await readBoundedPages((from, to) => supabase.from('phase_matches')
      .select('id, phase_id, round_id, player_1_id, player_2_id, winner_id, confirmed_at, finalized_at')
      .in('phase_id', ids).eq('status', 'completed').not('finalized_at', 'is', null).not('winner_id', 'is', null)
      .order('finalized_at').order('id').range(from, to), { label: 'native format-cron finalized matches' });
    for (const row of rows) if (row.winner_id !== null) result.push({ ...row, winner_id: row.winner_id });
  }
  return result.sort((a, b) => (a.finalized_at ?? '').localeCompare(b.finalized_at ?? '') || a.id.localeCompare(b.id))
    .map(({ finalized_at: _finalizedAt, ...row }) => row);
}

export async function listNativeUncompletedMatches(phaseIds: readonly string[], matchIds: readonly string[]): Promise<CronPendingMatch[]> {
  const result: CronPendingMatch[] = [];
  for (let from = 0; from < matchIds.length; from += UNCOMPLETED_MATCH_CHUNK) {
    const rows: CronPendingMatch[] = [];
    for (const ids of phaseChunks(phaseIds)) {
      const { data, error } = await supabase.from('phase_matches').select('id, phase_id, status')
        .in('phase_id', ids).in('id', matchIds.slice(from, from + UNCOMPLETED_MATCH_CHUNK)).neq('status', 'completed').order('id');
      if (error) throw error;
      rows.push(...(data ?? []));
    }
    result.push(...rows.sort((a, b) => a.id.localeCompare(b.id)));
  }
  return result;
}

export async function completePhaseFormatForfeit(input: CompleteFormatForfeitInput): Promise<boolean> {
  const { data, error } = await supabase.rpc('phase_format_forfeit_complete', {
    p_season_id: input.seasonId, p_match_id: input.matchId, p_expected_status: input.expectedStatus,
    p_player_1_id: input.player1Id, p_player_2_id: input.player2Id, p_winner_id: input.winnerId, p_expected_revision: input.revision,
  });
  if (error) throw mapFormatRuntimeDbError(error);
  return data === true;
}
