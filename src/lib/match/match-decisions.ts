import { createMatchDecisionHandler } from './match-decisions-core';
import { canAdministerMatchAccess } from '@/lib/auth/match-access';
import { getMatchById, updateMatchStatus } from '@/lib/supabase/queries/matches';
import { finalizeMatchCompletion } from './finalize';
import { revalidateMatchPages } from '@/lib/revalidation';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { emitDiscordEvent } from '@/lib/discord/notify';
import { emitSocialEvent } from '@/lib/social/notify';
import type { MatchWithPlayers } from '@/types/match';

export const handleLegacyMatchDecision = createMatchDecisionHandler<MatchWithPlayers>({
  competitionId: (match) => match.tournament_id,
  getMatchById: (id) => getMatchById(id),
  canAdminister: (player, id) => canAdministerMatchAccess(player, id),
  updateMatchStatus: (id, status, winnerId, submitterId, notes, expectedStatus) =>
    updateMatchStatus(id, status, winnerId, submitterId, notes, expectedStatus),
  finalizeMatchCompletion: (input) => finalizeMatchCompletion(input),
  resourceType: 'match',
  auditOwner: (match) => ({ tournament_id: match.tournament_id }),
  revalidate: (competitionId, matchId) => revalidateMatchPages(competitionId, matchId),
  announceDispute: async ({ match, player }) => {
    const tournament = await getTournamentById(match.tournament_id);
    if (!tournament) return;
    const payload = {
      event_type: 'match_disputed' as const,
      tournament_id: match.tournament_id,
      season_id: tournament.season_id,
      data: {
        kind: 'match_disputed' as const,
        player_1_name: match.player_1_name,
        player_2_name: match.player_2_name,
        disputer_name: player.name,
        tournament_name: tournament.name,
      },
    };
    void emitDiscordEvent(payload);
    void emitSocialEvent(payload);
  },
});
