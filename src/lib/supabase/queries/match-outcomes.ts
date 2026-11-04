import { supabase } from '../client';
import type { Tables } from '@/types/database';
import {
  isMatchOutcomeKind,
  isMatchOutcomeSource,
  type MatchOutcome,
  type MatchOutcomeKind,
  type MatchOutcomeSource,
} from '@/types/match-outcome';

type MatchOutcomeRow = Tables<'match_outcomes'>;

const COLUMNS = 'match_id, kind, p1_faints, p2_faints, source, reason, set_by, set_at';

/** Ids per `.in()` read: keeps the request URL short and every page far below `max_rows`. */
const IN_CHUNK = 150;

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

export async function getMatchOutcome(matchId: string): Promise<MatchOutcome | null> {
  const { data, error } = await supabase.from('match_outcomes').select(COLUMNS).eq('match_id', matchId).maybeSingle();
  if (error) throw error;
  return data ? toMatchOutcome(data) : null;
}

/** The outcomes of the given matches (a match without a row is absent from the result). */
export async function getMatchOutcomesByMatchIds(matchIds: readonly string[]): Promise<MatchOutcome[]> {
  const unique = [...new Set(matchIds)];
  const out: MatchOutcome[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase.from('match_outcomes').select(COLUMNS).in('match_id', chunk);
    if (error) throw error;
    for (const row of data ?? []) out.push(toMatchOutcome(row));
  }
  return out;
}

export interface RecordMatchOutcomeInput {
  matchId: string;
  kind: MatchOutcomeKind;
  p1Faints: number | null;
  p2Faints: number | null;
  source: MatchOutcomeSource;
  reason: string | null;
  setBy: string | null;
  /** Admin writes replace any row; other writes never replace an admin row. */
  force: boolean;
}

export type RecordMatchOutcomeResult = 'written' | 'kept';

/** Writes one outcome through `match_outcome_record` (the table's only writer). */
export async function recordMatchOutcome(input: RecordMatchOutcomeInput): Promise<RecordMatchOutcomeResult> {
  const { data, error } = await supabase.rpc('match_outcome_record', {
    p_match_id: input.matchId,
    p_kind: input.kind,
    p_source: input.source,
    p_force: input.force,
    // An omitted argument is the SQL default NULL.
    p_p1_faints: input.p1Faints ?? undefined,
    p_p2_faints: input.p2Faints ?? undefined,
    p_reason: input.reason ?? undefined,
    p_set_by: input.setBy ?? undefined,
  });
  if (error) throw error;
  if (data !== 'written' && data !== 'kept') throw new Error(`match_outcome_record returned ${String(data)}`);
  return data;
}

/** Removes a match's outcome (reset, reopen, a lost compare-and-set). Returns the rows deleted. */
export async function deleteMatchOutcome(matchId: string): Promise<number> {
  const { error, count } = await supabase.from('match_outcomes').delete({ count: 'exact' }).eq('match_id', matchId);
  if (error) throw error;
  return count ?? 0;
}
