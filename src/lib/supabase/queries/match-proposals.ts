import { supabase } from '../client';
import { assertValidUuid } from '@/lib/utils/uuid';
import type { Tables } from '@/types/database';
import type { MatchProposal, MatchProposalStatus, MatchProposalWithPlayers } from '@/types/match-proposal';

type MatchProposalRow = Tables<'match_proposals'>;
type PlayerJoin = { name: string };
type MatchProposalWithPlayersRow = MatchProposalRow & {
  proposer: PlayerJoin | null;
  responder: PlayerJoin | null;
};

const MATCH_PROPOSAL_WITH_PLAYERS_SELECT = `
  *,
  proposer:players!match_proposals_proposer_id_fkey ( name ),
  responder:players!match_proposals_responder_id_fkey ( name )
`;

function toMatchProposal(row: MatchProposalRow): MatchProposal {
  return {
    id: row.id,
    match_id: row.match_id,
    proposer_id: row.proposer_id,
    responder_id: row.responder_id,
    proposed_at: row.proposed_at,
    message: row.message,
    status: row.status as MatchProposalStatus,
    expires_at: row.expires_at,
    responded_at: row.responded_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toMatchProposalWithPlayers(row: MatchProposalWithPlayersRow): MatchProposalWithPlayers {
  return {
    ...toMatchProposal(row),
    // null when the player row is gone; the UI renders a localized fallback.
    proposer_name: row.proposer?.name ?? null,
    responder_name: row.responder?.name ?? null,
  };
}

export async function createMatchProposal(input: {
  match_id: string;
  proposer_id: string;
  responder_id: string;
  proposed_at: string;
  expires_at: string;
  message?: string;
}): Promise<MatchProposal> {
  assertValidUuid(input.match_id, 'match id');
  assertValidUuid(input.proposer_id, 'proposer id');
  assertValidUuid(input.responder_id, 'responder id');

  const { data, error } = await supabase
    .from('match_proposals')
    .insert({
      match_id: input.match_id,
      proposer_id: input.proposer_id,
      responder_id: input.responder_id,
      proposed_at: input.proposed_at,
      expires_at: input.expires_at,
      message: input.message ?? '',
    })
    .select()
    .single();

  if (error) throw error;
  return toMatchProposal(data);
}

export async function getMatchProposalById(id: string): Promise<MatchProposal | null> {
  assertValidUuid(id, 'proposal id');

  const { data, error } = await supabase
    .from('match_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchProposal(data) : null;
}

export async function getPendingProposalForParticipant(
  matchId: string,
  playerId: string
): Promise<MatchProposal | null> {
  assertValidUuid(matchId, 'match id');
  assertValidUuid(playerId, 'player id');

  const { data, error } = await supabase
    .from('match_proposals')
    .select('*')
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .or(`proposer_id.eq.${playerId},responder_id.eq.${playerId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ? toMatchProposal(data) : null;
}

export async function listMatchProposals(matchId: string): Promise<MatchProposalWithPlayers[]> {
  assertValidUuid(matchId, 'match id');

  const { data, error } = await supabase
    .from('match_proposals')
    .select(MATCH_PROPOSAL_WITH_PLAYERS_SELECT)
    .eq('match_id', matchId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data.map((row) => toMatchProposalWithPlayers(row as MatchProposalWithPlayersRow));
}

export async function listPendingMatchProposalsForPlayer(
  playerId: string
): Promise<MatchProposalWithPlayers[]> {
  assertValidUuid(playerId, 'player id');

  const { data, error } = await supabase
    .from('match_proposals')
    .select(MATCH_PROPOSAL_WITH_PLAYERS_SELECT)
    .eq('status', 'pending')
    .or(`proposer_id.eq.${playerId},responder_id.eq.${playerId}`)
    .order('expires_at', { ascending: true });

  if (error) throw error;
  return data.map((row) => toMatchProposalWithPlayers(row as MatchProposalWithPlayersRow));
}

export async function acceptMatchProposal(id: string): Promise<MatchProposal> {
  return updateMatchProposalStatus(id, 'accepted');
}

export async function rejectMatchProposal(id: string): Promise<MatchProposal> {
  return updateMatchProposalStatus(id, 'rejected');
}

export async function expireMatchProposal(id: string): Promise<MatchProposal> {
  return updateMatchProposalStatus(id, 'expired');
}

export async function cancelPendingMatchProposalsForMatch(matchId: string): Promise<MatchProposal[]> {
  assertValidUuid(matchId, 'match id');

  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('status', 'pending')
    .select();

  if (error) throw error;
  return data.map(toMatchProposal);
}

/**
 * Delete ALL proposals for a match (match-scoped). Used by the admin
 * match-reset cleanup: a reset returns the match to scheduled, so any
 * pending/accepted/rejected proposal rows tied to the prior result are
 * orphaned. Returns the count of rows deleted so the cleanup can surface
 * it in its summary.
 */
export async function deleteMatchProposalsByMatch(matchId: string): Promise<number> {
  assertValidUuid(matchId, 'match id');

  const { count, error } = await supabase
    .from('match_proposals')
    .delete({ count: 'exact' })
    .eq('match_id', matchId);

  if (error) throw error;
  return count ?? 0;
}

async function updateMatchProposalStatus(
  id: string,
  status: Exclude<MatchProposalStatus, 'pending'>
): Promise<MatchProposal> {
  assertValidUuid(id, 'proposal id');

  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .single();

  if (error) throw error;
  return toMatchProposal(data);
}