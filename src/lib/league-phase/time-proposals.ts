import 'server-only';
import { logAuditEvent } from '@/lib/audit/log';
import { revalidatePhaseMatchPages } from '@/lib/revalidation';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { getMatchProposalById, getPhaseMatchProposalById, respondToPhaseMatchProposal } from '@/lib/supabase/queries/match-proposals';
import type { MatchProposal } from '@/types/match-proposal';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import type { CompetitionOwner } from '@/types/competition-owner';
import { resolveIdOnlyMatchRoute } from './match-route-owner';
import { getPhaseRouteMode } from './route-mode';

export async function loadTimeProposalMatch(id: string) {
  const owner = await resolveIdOnlyMatchRoute(id);
  if (!owner) return null;
  if (owner.kind === 'legacy') {
    const match = await getMatchById(id);
    return match ? { kind: 'legacy' as const, match } : null;
  }
  const matchId = id.toLowerCase();
  const match = await getPhaseMatchById(matchId);
  return match?.id === matchId && match.phase_id === owner.phase_id ? { kind: 'phase' as const, match, owner } : null;
}

export async function loadTimeProposalById(id: string) {
  const mode = await getPhaseRouteMode();
  if (mode === 'phase' || mode === 'frozen_phase') {
    const proposal = await getPhaseMatchProposalById(id);
    if (proposal) {
      const owner = await resolveIdOnlyMatchRoute(proposal.match_id, mode);
      const match = owner?.kind === 'phase' ? await getPhaseMatchById(proposal.match_id) : null;
      return owner?.kind === 'phase' && match?.id === proposal.match_id && match.phase_id === owner.phase_id
        ? { kind: 'phase' as const, match, owner, proposal } : null;
    }
  }
  const proposal = await getMatchProposalById(id);
  if (!proposal || (mode !== 'legacy' && (await resolveIdOnlyMatchRoute(proposal.match_id, mode))?.kind !== 'legacy')) {
    return null;
  }
  return { kind: 'legacy' as const, proposal };
}

export async function answerNativeTimeProposal(
  target: { owner: Extract<CompetitionOwner, { kind: 'phase' }>; match: PhaseMatchWithPlayers; proposal: MatchProposal },
  player: { playerId: string; name: string },
  accept: boolean,
) {
  const { owner, match } = target;
  const proposal = await respondToPhaseMatchProposal(owner.phase_id, match.id, target.proposal.id, player.playerId, accept);
  logAuditEvent({
    actor_id: player.playerId,
    actor_name: player.name,
    action: accept ? 'match.proposal.accept' : 'match.proposal.reject',
    resource_type: 'phase_match',
    resource_id: match.id,
    resource_name: `${match.player_1_name} vs ${match.player_2_name}`,
    metadata: {
      proposal_id: proposal.id,
      phase_id: owner.phase_id,
      season_id: owner.season_id,
      ...(accept ? { scheduled_at: proposal.proposed_at } : { proposed_at: proposal.proposed_at }),
    },
  });
  if (accept) await revalidatePhaseMatchPages(owner.phase_id, match.id, owner.season_id);
  return proposal;
}
