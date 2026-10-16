/**
 * Match-context agent tool (PRD §5, Layer 2).
 *
 * Wraps {@link gatherMatchContext} — the single source of truth for "everything
 * known about a match" (per-game battle stats, team sheets with abilities,
 * league/format rules, and the attributed turn-by-turn summary including who set
 * each weather/terrain). Without this the `linden_match_prep` agent is blind to
 * the actual game it is asked to analyse: its other tools only return aggregates,
 * match records and replay URLs — none of them parse a replay into events.
 */
import { gatherMatchContext } from '@/lib/ai/context-builder';
import type { GetMatchAnalysisContextInput } from './schemas';

export interface MatchAnalysisContextResult {
  match_id: string;
  /** Generation the match was played in (for gen-locking suggestions). */
  gen: number;
  /** Fully-rendered match context block (markdown-ish), ready to reason over. */
  context: string;
}

export async function getMatchAnalysisContext(
  input: GetMatchAnalysisContextInput,
): Promise<MatchAnalysisContextResult> {
  const { context, gen } = await gatherMatchContext(input.matchId);
  return { match_id: input.matchId, gen, context };
}
