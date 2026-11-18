import { supabase } from '../client';
import type { Tables } from '@/types/database';
import { phaseMatchMachine } from '@/lib/league-phase/phase-match-state';
import type { MatchResultInput } from '@/lib/validation';
import {
  isMatchOutcomeKind,
  isMatchOutcomeSource,
  type MatchOutcome,
  type MatchOutcomeKind,
  type MatchOutcomeSource,
} from '@/types/match-outcome';

type MatchOutcomeRow = Tables<'phase_match_outcomes'>;

const COLUMNS = 'match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at';

function toMatchOutcome(row: MatchOutcomeRow): MatchOutcome {
  if (!isMatchOutcomeKind(row.kind)) throw new Error(`match_outcomes ${row.match_id}: unknown kind ${row.kind}`);
  if (!isMatchOutcomeSource(row.source)) throw new Error(`match_outcomes ${row.match_id}: unknown source ${row.source}`);
  return {
    match_id: row.match_id,
    kind: row.kind,
    p1_faints: row.p1_faints,
    p2_faints: row.p2_faints,
    source: row.source,
    reason: row.reason,
    set_by: row.set_by,
    set_at: row.set_at,
  };
}

export async function getPhaseMatchOutcome(matchId: string): Promise<MatchOutcome | null> {
  const { data, error } = await supabase.from('phase_match_outcomes').select(COLUMNS).eq('match_id', matchId).maybeSingle();
  if (error) throw error;
  return data ? toMatchOutcome(data) : null;
}

export interface RecordMatchOutcomeInput {
  matchId: string;
  kind: MatchOutcomeKind;
  p1Faints: number | null;
  p2Faints: number | null;
  source: MatchOutcomeSource;
  reason: string | null;
  setBy: string | null;
  force: boolean;
  openOnly?: boolean;
}

export type RecordMatchOutcomeResult = 'written' | 'kept';

export async function recordPhaseMatchOutcome(input: RecordMatchOutcomeInput): Promise<RecordMatchOutcomeResult> {
  const { data, error } = await supabase.rpc('phase_match_outcome_record', {
    p_match_id: input.matchId,
    p_kind: input.kind,
    p_source: input.source,
    p_force: input.force,
    p_p1_faints: input.p1Faints ?? undefined,
    p_p2_faints: input.p2Faints ?? undefined,
    p_reason: input.reason ?? undefined,
    p_set_by: input.setBy ?? undefined,
    p_open_only: input.openOnly ?? undefined,
  });
  if (error) throw error;
  if (data !== 'written' && data !== 'kept') throw new Error(`match_outcome_record returned ${String(data)}`);
  return data;
}

export async function settlePhaseMatchAsAdmin(
  match: Pick<Tables<'phase_matches'>, 'id' | 'phase_id' | 'status' | 'player_1_id' | 'player_2_id'>,
  actorId: string,
  result: MatchResultInput,
): Promise<string | null> {
  phaseMatchMachine.assertTransition(match.status, 'completed', 'admin');
  const { data, error } = await supabase.rpc('phase_match_settle_admin', {
    p_phase_id: match.phase_id,
    p_match_id: match.id,
    p_expected_status: match.status,
    p_player_1_id: match.player_1_id,
    p_player_2_id: match.player_2_id,
    p_winner_id: result.winner_id,
    p_actor_id: actorId,
    p_kind: result.outcome,
    p_reason: result.reason,
  });
  if (error?.code === 'P0001' && error.message === 'tournament_not_found') return null;
  if (error) throw error;
  return data;
}

export async function deletePhaseMatchOutcome(matchId: string, options: { onlyIfSetAt?: string } = {}): Promise<number> {
  let query = supabase.from('phase_match_outcomes').delete({ count: 'exact' }).eq('match_id', matchId);
  if (options.onlyIfSetAt !== undefined) query = query.eq('set_at', options.onlyIfSetAt);
  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}
