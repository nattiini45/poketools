/**
 * Match children cleanup (spec §17/§18, Task T5).
 *
 * `cleanMatchChildren(matchId)` deletes or nulls every match-derived child
 * row that the admin reset/delete pipelines previously left orphaned. The
 * audit (`docs/match-derived-data-audit.md` §6) enumerated the gap set:
 *   - match_prep_teams (DELETE)
 *   - match_proposals (DELETE)
 *   - broadcast_moments (DELETE — match_id FK is ON DELETE CASCADE per §26;
 *     cleanup is still explicit so the soft-reset path is FK-action-agnostic)
 *   - epb_animation_views (DELETE — autoplay-once markers survive soft reset)
 *   - teams.match_id (SET NULL — shared teambuilder row is preserved)
 *   - cast_sessions.match_id (SET NULL — reusable studio session is preserved)
 *   - agent_suggestions.match_id (SET NULL — AI suggestion row preserved)
 *   - matches.social_image_url (SET NULL — plain column resetMatchFields omits)
 *
 * Each child type is cleaned in its own try/catch so a failure on one type
 * is logged distinctly and never aborts the others, mirroring the
 * `rollbackMatchdayWrites` error-logging style in `epb-matchday.ts`. The
 * summary counts are best-effort (rows deleted where the SDK supports
 * `count: 'exact'`; booleans where it does not).
 */

import { deleteMatchPrepTeamsByMatch } from '@/lib/supabase/queries/match-prep-teams';
import { deleteMatchProposalsByMatch } from '@/lib/supabase/queries/match-proposals';
import { deleteMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { deleteEpbAnimationViewsByMatch } from '@/lib/supabase/queries/epb-animation-views';
import { clearTeamsMatchPointer } from '@/lib/supabase/queries/teams';
import { clearCastSessionsMatchPointer } from '@/lib/supabase/queries/cast-sessions';
import { clearAgentSuggestionsMatchPointer } from '@/lib/supabase/queries/agent-suggestions';
import { clearMatchSocialImage } from '@/lib/supabase/queries/matches';

export interface MatchChildrenCleanup {
  matchPrepTeamsDeleted: number;
  matchProposalsDeleted: number;
  broadcastMomentsDeleted: number;
  animationViewsDeleted: number;
  teamPointersCleared: number;
  castSessionPointersCleared: number;
  agentSuggestionPointersCleared: number;
  socialImageCleared: boolean;
}

function emptyCleanup(): MatchChildrenCleanup {
  return {
    matchPrepTeamsDeleted: 0,
    matchProposalsDeleted: 0,
    broadcastMomentsDeleted: 0,
    animationViewsDeleted: 0,
    teamPointersCleared: 0,
    castSessionPointersCleared: 0,
    agentSuggestionPointersCleared: 0,
    socialImageCleared: false,
  };
}

/**
 * Delete or null all orphaned match-derived children for a match. Best-effort:
 * each child type is independent and a failure on one is logged distinctly and
 * does NOT abort the others. Returns a summary with per-type counts (deletes)
 * or booleans (the SET NULL operations where count is impractical to surface).
 */
export async function cleanMatchChildren(
  matchId: string
): Promise<MatchChildrenCleanup> {
  const result = emptyCleanup();

  // DELETE match_prep_teams (match-scoped)
  try {
    result.matchPrepTeamsDeleted = await deleteMatchPrepTeamsByMatch(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to delete match_prep_teams', err);
  }

  // DELETE match_proposals (match-scoped)
  try {
    result.matchProposalsDeleted = await deleteMatchProposalsByMatch(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to delete match_proposals', err);
  }

  // DELETE broadcast_moments (match-scoped; match_id FK is ON DELETE CASCADE per
  // §26, but cleanup stays explicit so the soft-reset path is FK-action-agnostic)
  try {
    result.broadcastMomentsDeleted = await deleteMomentsByMatch(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to delete broadcast_moments', err);
  }

  // DELETE epb_animation_views (match-scoped; autoplay-once markers survive reset)
  try {
    result.animationViewsDeleted = await deleteEpbAnimationViewsByMatch(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to delete epb_animation_views', err);
  }

  // SET NULL teams.match_id (shared teambuilder row preserved, never deleted; a
  // released prep row with a planned sibling moves to the personal teams)
  try {
    result.teamPointersCleared = await clearTeamsMatchPointer(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to clear teams.match_id', err);
  }

  // SET NULL cast_sessions.match_id (reusable studio session preserved)
  try {
    result.castSessionPointersCleared = await clearCastSessionsMatchPointer(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to clear cast_sessions.match_id', err);
  }

  // SET NULL agent_suggestions.match_id (AI suggestion row preserved; only
  // pointer cleared — mirrors the FK ON DELETE SET NULL behavior on hard delete).
  try {
    result.agentSuggestionPointersCleared = await clearAgentSuggestionsMatchPointer(matchId);
  } catch (err) {
    console.error('Match children cleanup: failed to clear agent_suggestions.match_id', err);
  }

  // SET NULL matches.social_image_url (plain column resetMatchFields omits)
  try {
    await clearMatchSocialImage(matchId);
    result.socialImageCleared = true;
  } catch (err) {
    console.error('Match children cleanup: failed to clear matches.social_image_url', err);
  }

  return result;
}