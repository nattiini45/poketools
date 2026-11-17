import 'server-only';
import { requirePhaseAwareAdmin, getPhaseAdminScope } from '@/lib/auth/phase-access';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { getAgentOwnershipGraph, type AgentOwnershipGraph } from '@/lib/supabase/queries/agent-ownership';
import {
  agentResourceRefsSchema, type AgentOwnershipReader, type AgentResourceRef, type CompetitionRef,
} from '@/lib/ai/agent/resource-ref';

function actualOwner(ref: AgentResourceRef, graph: AgentOwnershipGraph): CompetitionRef | null {
  const store = graph[ref.owner.kind];
  let competitionId: string;
  if (ref.resource === 'competition') {
    competitionId = ref.owner.kind === 'phase' ? ref.owner.phaseId : ref.owner.tournamentId;
  } else if (ref.resource === 'round') {
    const round = store.rounds.get(ref.id);
    if (!round) return null;
    competitionId = round.parentId;
  } else {
    const matchId = ref.resource === 'game' ? store.games.get(ref.id)?.parentId : ref.id;
    if (!matchId) return null;
    const match = store.matches.get(matchId);
    if (!match) return null;
    const round = store.rounds.get(match.roundId);
    if (!round || round.parentId !== match.parentId) return null;
    competitionId = match.parentId;
  }
  const competition = store.competitions.get(competitionId);
  if (!competition) return null;
  if (ref.owner.kind === 'tournament') {
    return competition.seasonId === null ? { kind: 'tournament', tournamentId: competition.id } : null;
  }
  if (competition.seasonId === null || !graph.seasons.has(competition.seasonId)) return null;
  return { kind: 'phase', seasonId: competition.seasonId, phaseId: competition.id };
}

export function createAdminAgentOwnershipReader(): AgentOwnershipReader {
  return {
    async resolve(input) {
      const refs = agentResourceRefsSchema.parse(input);
      if (refs.length === 0) return [];
      const player = await requirePhaseAwareAdmin();
      const [phaseScope, legacyScope] = await Promise.all([
        refs.some((ref) => ref.owner.kind === 'phase') ? getPhaseAdminScope(player) : null,
        refs.some((ref) => ref.owner.kind === 'tournament') ? getAdminScope(player) : null,
      ]);
      const graph = await getAgentOwnershipGraph(refs);
      return refs.map((ref): AgentResourceRef | null => {
        const owner = actualOwner(ref, graph);
        if (!owner) return null;
        const allowed = owner.kind === 'phase'
          ? phaseScope !== null && (phaseScope.phaseIds === null || phaseScope.phaseIds.includes(owner.phaseId)
            || phaseScope.seasonIds === null || phaseScope.seasonIds.includes(owner.seasonId))
          : legacyScope !== null && (legacyScope.tournamentIds === null
            || legacyScope.tournamentIds.includes(owner.tournamentId));
        if (!allowed) return null;
        return ref.resource === 'competition' ? { resource: 'competition', owner }
          : { resource: ref.resource, id: ref.id, owner };
      });
    },
  };
}
