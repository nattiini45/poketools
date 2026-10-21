import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock every query-module helper cleanMatchChildren delegates to, so the suite
// can drive each one independently (success / rejection) and assert best-effort
// isolation: a failure on one child type must not abort the others.

vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({
  deleteMatchPrepTeamsByMatch: vi.fn(async () => 1),
}));
vi.mock('@/lib/supabase/queries/match-proposals', () => ({
  deleteMatchProposalsByMatch: vi.fn(async () => 2),
}));
vi.mock('@/lib/supabase/queries/broadcast-moments', () => ({
  deleteMomentsByMatch: vi.fn(async () => 3),
}));
vi.mock('@/lib/supabase/queries/epb-animation-views', () => ({
  deleteEpbAnimationViewsByMatch: vi.fn(async () => 4),
}));
vi.mock('@/lib/supabase/queries/teams', () => ({
  clearTeamsMatchPointer: vi.fn(async () => 5),
}));
vi.mock('@/lib/supabase/queries/cast-sessions', () => ({
  clearCastSessionsMatchPointer: vi.fn(async () => 6),
}));
vi.mock('@/lib/supabase/queries/agent-suggestions', () => ({
  clearAgentSuggestionsMatchPointer: vi.fn(async () => 7),
}));
vi.mock('@/lib/supabase/queries/matches', () => ({
  clearMatchSocialImage: vi.fn(async () => undefined),
}));

import { cleanMatchChildren } from '../match-children';
import { deleteMatchPrepTeamsByMatch } from '@/lib/supabase/queries/match-prep-teams';
import { deleteMatchProposalsByMatch } from '@/lib/supabase/queries/match-proposals';
import { deleteMomentsByMatch } from '@/lib/supabase/queries/broadcast-moments';
import { deleteEpbAnimationViewsByMatch } from '@/lib/supabase/queries/epb-animation-views';
import { clearTeamsMatchPointer } from '@/lib/supabase/queries/teams';
import { clearCastSessionsMatchPointer } from '@/lib/supabase/queries/cast-sessions';
import { clearAgentSuggestionsMatchPointer } from '@/lib/supabase/queries/agent-suggestions';
import { clearMatchSocialImage } from '@/lib/supabase/queries/matches';

describe('cleanMatchChildren', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('invokes every child cleanup helper for the match and aggregates counts', async () => {
    const result = await cleanMatchChildren('match-1');

    expect(deleteMatchPrepTeamsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteMatchProposalsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteMomentsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteEpbAnimationViewsByMatch).toHaveBeenCalledWith('match-1');
    expect(clearTeamsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearCastSessionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearAgentSuggestionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearMatchSocialImage).toHaveBeenCalledWith('match-1');

    expect(result).toEqual({
      matchPrepTeamsDeleted: 1,
      matchProposalsDeleted: 2,
      broadcastMomentsDeleted: 3,
      animationViewsDeleted: 4,
      teamPointersCleared: 5,
      castSessionPointersCleared: 6,
      agentSuggestionPointersCleared: 7,
      socialImageCleared: true,
    });
  });

  it('completes the other cleanups and resolves when one helper rejects, logging distinctly', async () => {
    // Make the broadcast_moments cleanup reject; everything else succeeds.
    vi.mocked(deleteMomentsByMatch).mockRejectedValueOnce(new Error('moments boom'));

    const result = await cleanMatchChildren('match-1');

    // The failing helper WAS invoked (it just rejected).
    expect(deleteMomentsByMatch).toHaveBeenCalledWith('match-1');
    // The failure is logged distinctly with the table name + the error.
    expect(errorSpy).toHaveBeenCalledWith(
      'Match children cleanup: failed to delete broadcast_moments',
      expect.any(Error),
    );
    // The rejecting helper's count stays at its empty-cleanup default (0).
    expect(result.broadcastMomentsDeleted).toBe(0);

    // Every OTHER child cleanup was still invoked and completed.
    expect(deleteMatchPrepTeamsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteMatchProposalsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteEpbAnimationViewsByMatch).toHaveBeenCalledWith('match-1');
    expect(clearTeamsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearCastSessionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearAgentSuggestionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearMatchSocialImage).toHaveBeenCalledWith('match-1');

    // The summary reflects the partial completion: only the failed type is 0.
    expect(result).toEqual({
      matchPrepTeamsDeleted: 1,
      matchProposalsDeleted: 2,
      broadcastMomentsDeleted: 0, // the rejecting helper
      animationViewsDeleted: 4,
      teamPointersCleared: 5,
      castSessionPointersCleared: 6,
      agentSuggestionPointersCleared: 7,
      socialImageCleared: true,
    });
  });

  it('continues after the FIRST helper rejects and still runs + reports later failures', async () => {
    // First helper (match_prep_teams) AND a later helper (teams pointer) both
    // reject. The middle and end helpers must still run, and both failures must
    // be logged distinctly (proving the loop is not short-circuited).
    vi.mocked(deleteMatchPrepTeamsByMatch).mockRejectedValueOnce(new Error('prep boom'));
    vi.mocked(clearTeamsMatchPointer).mockRejectedValueOnce(new Error('teams boom'));

    const result = await cleanMatchChildren('match-1');

    // Both failing helpers were invoked.
    expect(deleteMatchPrepTeamsByMatch).toHaveBeenCalledWith('match-1');
    expect(clearTeamsMatchPointer).toHaveBeenCalledWith('match-1');

    // Both failures logged with their distinct table names.
    expect(errorSpy).toHaveBeenCalledWith(
      'Match children cleanup: failed to delete match_prep_teams',
      expect.any(Error),
    );
    expect(errorSpy).toHaveBeenCalledWith(
      'Match children cleanup: failed to clear teams.match_id',
      expect.any(Error),
    );
    // Exactly two distinct error logs (one per failure).
    expect(errorSpy).toHaveBeenCalledTimes(2);

    // The helpers between and after the two failures still completed.
    expect(deleteMatchProposalsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteMomentsByMatch).toHaveBeenCalledWith('match-1');
    expect(deleteEpbAnimationViewsByMatch).toHaveBeenCalledWith('match-1');
    expect(clearCastSessionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearAgentSuggestionsMatchPointer).toHaveBeenCalledWith('match-1');
    expect(clearMatchSocialImage).toHaveBeenCalledWith('match-1');

    // Summary: only the two failing types are at their defaults.
    expect(result.matchPrepTeamsDeleted).toBe(0);
    expect(result.teamPointersCleared).toBe(0);
    expect(result.matchProposalsDeleted).toBe(2);
    expect(result.broadcastMomentsDeleted).toBe(3);
    expect(result.animationViewsDeleted).toBe(4);
    expect(result.castSessionPointersCleared).toBe(6);
    expect(result.agentSuggestionPointersCleared).toBe(7);
    expect(result.socialImageCleared).toBe(true);
  });
});