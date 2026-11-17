import 'server-only';
import { requirePhaseAwareAdmin, getPhaseAdminScope } from '@/lib/auth/phase-access';
import { getAdminScope } from '@/lib/auth/admin-scope';
import { getAgentOwnershipGraph, getAgentResourceOwner } from '@/lib/supabase/queries/agent-ownership';
import {
  agentResourceRefsSchema, type AgentOwnershipReader, type AgentResourceRef,
} from '@/lib/ai/agent/resource-ref';


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
        const owner = getAgentResourceOwner(ref, graph);
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
