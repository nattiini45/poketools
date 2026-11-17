import 'server-only';
import { auditMatchTeamsWithStorage, type PhaseTeamAuditInput, type TeamAuditStorage } from '@/lib/format-engine/runtime/team-audit-server';
import { getPhaseById } from '@/lib/supabase/queries/league-phases';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getPhaseRoundById } from '@/lib/supabase/queries/phase-rounds';
import { getPhaseMatchOutcome } from '@/lib/supabase/queries/phase-match-outcomes';
import { getPhaseGamesByMatch, getPhaseBattleStatsByMatch } from '@/lib/supabase/queries/phase-games';
import { getPlayerPhaseTeamForMatch, PhaseTeamRowConflictError } from '@/lib/supabase/queries/phase-teams';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { openFormatCheck } from '@/lib/supabase/queries/format-runtime';
import { phaseById } from '@/lib/format-engine/runtime/load';
import { auditsTeams } from '@/lib/format-engine/runtime/team-audit';

export function createNativePhaseTeamAudit(invalidate: TeamAuditStorage['invalidate']) {
  return async (input: PhaseTeamAuditInput): Promise<{ opened: number }> => {
    if (input.context.seasonId !== input.phase.season_id) throw new Error('Native audit league scope mismatch');
    const phaseInfo = phaseById(input.context, input.phase.id);
    if (!phaseInfo || !auditsTeams(phaseInfo)) return { opened: 0 };
    const [match, round] = await Promise.all([getPhaseMatchById(input.matchId), getPhaseRoundById(input.roundId)]);
    if (!match || !round || match.phase_id !== input.phase.id || round.phase_id !== input.phase.id
      || match.round_id !== round.id || match.player_1_id !== input.player1Id || match.player_2_id !== input.player2Id) {
      throw new Error('Native team audit context does not match its phase');
    }
    const storage: TeamAuditStorage = {
      round: async () => round,
      outcome: id => getPhaseMatchOutcome(id),
      ruleset: async id => {
        const phase = await getPhaseById(id);
        if (phase && phase.season_id !== input.phase.season_id) throw new Error('Native audit phase scope mismatch');
        return phase ? getRulesetById(phase.ruleset_id) : null;
      },
      games: id => getPhaseGamesByMatch(id),
      stats: id => getPhaseBattleStatsByMatch(id),
      team: (playerId, scope) => getPlayerPhaseTeamForMatch(playerId, { id: scope.matchId, phase_id: scope.phaseId }),
      isTeamRowConflict: error => error instanceof PhaseTeamRowConflictError,
      match: async id => {
        const match = await getPhaseMatchById(id);
        if (match && match.phase_id !== input.phase.id) throw new Error('Native audit match scope mismatch');
        return match;
      },
      openCheck: check => {
        if (check.subject === null || typeof check.subject !== 'object' || Array.isArray(check.subject)) {
          throw new Error('Native audit check requires an explicit owned subject');
        }
        return openFormatCheck({ ...check,
          subject: { ...check.subject, owner_kind: 'phase', match_kind: 'phase_match' },
        });
      },
      invalidate,
    };
    return auditMatchTeamsWithStorage(input, storage);
  };
}
