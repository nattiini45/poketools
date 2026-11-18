import { supabase } from '../client';
import { readAllPages } from '../read-all-pages';
import { isMatchOutcomeKind } from '@/types/match-outcome';
import type { NativeKitConsumers } from '@/lib/league-phase/kit-storage';
import type { MatchRecord } from '@/lib/tournament/types';

function chunks(ids: readonly string[]): string[][] {
  const unique = [...new Set(ids)];
  return Array.from({ length: Math.ceil(unique.length / 50) }, (_, index) => unique.slice(index * 50, (index + 1) * 50));
}

export const getNativeKitOutcomes: NativeKitConsumers['outcomes'] = async (ids) => {
  const result: Awaited<ReturnType<NativeKitConsumers['outcomes']>> = [];
  for (const chunk of chunks(ids)) {
    const rows = await readAllPages((from, to) => supabase.from('phase_match_outcomes')
      .select('match_id, kind, p1_faints, p2_faints, phase_matches!inner(phase_id)')
      .in('phase_matches.phase_id', chunk).order('match_id').range(from, to));
    for (const row of rows) {
      if (!isMatchOutcomeKind(row.kind)) throw new Error(`phase_match_outcomes ${row.match_id}: unknown kind ${row.kind}`);
      result.push({ match_id: row.match_id, kind: row.kind, p1_faints: row.p1_faints, p2_faints: row.p2_faints });
    }
  }
  return result;
};

export const getNativeKitMatchIds: NativeKitConsumers['matchIds'] = async (ids) => {
  const result: { id: string; phase_id: string }[] = [];
  for (const chunk of chunks(ids)) {
    result.push(...await readAllPages((from, to) => supabase.from('phase_matches')
      .select('id, phase_id').in('phase_id', chunk).order('id').range(from, to)));
  }
  return result;
};

export const getNativeKitGameCounts: NativeKitConsumers['gameCounts'] = async (ids) => {
  const counts: Record<string, number> = {};
  for (const chunk of chunks(ids)) {
    const rows = await readAllPages((from, to) => supabase.from('phase_games')
      .select('id, match_id, phase_matches!inner(phase_id, status)').in('phase_matches.phase_id', chunk)
      .eq('phase_matches.status', 'completed').order('id').range(from, to));
    for (const row of rows) counts[row.match_id] = (counts[row.match_id] ?? 0) + 1;
  }
  return counts;
};

export const getNativeKitKills: NativeKitConsumers['kills'] = async (ids) => {
  const kills: Record<string, Record<string, number>> = {};
  for (const chunk of chunks(ids)) {
    const rows = await readAllPages((from, to) => supabase.from('phase_battle_stats')
      .select('id, player_id, kos_dealt, was_koed, phase_games!inner(match_id, phase_matches!inner(phase_id, status))')
      .in('phase_games.phase_matches.phase_id', chunk).eq('phase_games.phase_matches.status', 'completed')
      .order('id').range(from, to));
    for (const row of rows) {
      const players = kills[row.phase_games.match_id] ??= {};
      players[row.player_id] = (players[row.player_id] ?? 0) + row.kos_dealt - (row.was_koed ? 1 : 0);
    }
  }
  return kills;
};

export async function getNativeKitCompletedRecords(phaseId: string): Promise<MatchRecord[]> {
  const rows = await readAllPages((from, to) => supabase.from('phase_matches')
    .select('id, player_1_id, player_2_id, winner_id, bracket_side, bracket_pos, phase_rounds!inner(round_number)')
    .eq('phase_id', phaseId).eq('status', 'completed').order('id').range(from, to));
  return rows.map((row) => {
    const side = row.bracket_side ?? null;
    if (side !== null && side !== 'winners' && side !== 'losers' && side !== 'grand_finals') {
      throw new Error(`phase_matches ${row.id}: unknown bracket side ${side}`);
    }
    return { match_id: row.id, player_1_id: row.player_1_id, player_2_id: row.player_2_id,
      winner_id: row.winner_id, round_number: row.phase_rounds.round_number,
      bracket_side: side, bracket_pos: row.bracket_pos };
  });
}

export async function getNativeKitMatchFacts(phaseId: string, legacyOrder = false) {
  return readAllPages((from, to) => {
    const query = supabase.from('phase_matches')
      .select('id, round_id, status, winner_id, player_1_id, player_2_id')
      .eq('phase_id', phaseId);
    return (legacyOrder ? query.order('created_at') : query).order('id').range(from, to);
  });
}
