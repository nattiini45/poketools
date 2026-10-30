/**
 * Match-context agent tool (PRD §5, Layer 2).
 *
 * Wraps {@link gatherMatchContext} — the single source of truth for "everything
 * known about a match" (per-game battle stats, team sheets with abilities,
 * league/format rules, and the attributed turn-by-turn summary including who set
 * each weather/terrain). Without this the `linden_match_prep` agent is blind to
 * the actual game it is asked to analyse: its other tools only return aggregates,
 * match records and replay URLs — none of them parse a replay into events.
 *
 * The match id comes from the model, so the tool decides for itself whether the
 * requesting player may see that match, with the rules of the analysis routes
 * (`/api/ai/agent/analyze-match`): a participant of the match, or a site admin
 * for a match in a post-match status. The requester is the authenticated player,
 * put into the input by the server (`applyToolOverrides`); a call without one is
 * refused. A refusal says the same thing whether the match does not exist or is
 * not the requester's, so the tool cannot be used to probe which ids exist.
 */
import { gatherMatchContext } from '@/lib/ai/context-builder';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPlayerById } from '@/lib/supabase/queries/players';
import type { GetMatchAnalysisContextInput } from './schemas';

export interface MatchAnalysisContextResult {
  match_id: string;
  /** Generation the match was played in (for gen-locking suggestions). */
  gen: number;
  /** Fully-rendered match context block (markdown-ish), ready to reason over. */
  context: string;
}

/** Match statuses a site admin may read the context of (the post-match analysis route's rule). */
const ADMIN_READABLE_STATUSES = new Set(['pending_confirmation', 'completed']);

/** One message for "no such match" and "not yours": the answer must not tell the two apart. */
const NOT_AVAILABLE = 'No match context is available for that match id.';

/** True when `requesterId` may read the context of `matchId`. */
async function mayReadMatch(matchId: string, requesterId: string): Promise<boolean> {
  const match = await getMatchById(matchId);
  if (!match) return false;
  if (match.player_1_id === requesterId || match.player_2_id === requesterId) return true;
  if (!ADMIN_READABLE_STATUSES.has(match.status)) return false;
  const requester = await getPlayerById(requesterId);
  return requester?.is_admin === true;
}

export async function getMatchAnalysisContext(
  input: GetMatchAnalysisContextInput,
): Promise<MatchAnalysisContextResult> {
  if (!input.requesterId || !(await mayReadMatch(input.matchId, input.requesterId))) {
    throw new Error(NOT_AVAILABLE);
  }
  const { context, gen } = await gatherMatchContext(input.matchId);
  return { match_id: input.matchId, gen, context };
}
