import { supabase } from '../client';
import { readBoundedPages } from '../read-bounded-pages';
import { assertValidUuid } from '@/lib/utils/uuid';
import { UserFacingError } from '@/lib/api/user-facing-error';
import type { Tables } from '@/types/database';
import type { MatchProposal, MatchProposalStatus, MatchProposalWithPlayers } from '@/types/match-proposal';
import { matchProposalMachine } from '@/lib/match/proposal-state';
import matchErrors from '@/i18n/messages/errors/matches/en';
import type { ScheduleResult } from '@/lib/admin/match-detail';

/** The only state an answer, an expiry or a cancellation leaves (`matchProposalMachine.sourcesOf`). */
const [PENDING] = matchProposalMachine.sourcesOf('cancelled');

const proposalWriteErrors = {
  match_not_found: 404,
  match_proposal_not_found: 404,
  match_proposal_participants_only: 403,
  match_proposal_accept_responder_only: 403,
  match_proposal_reject_responder_only: 403,
  match_proposal_match_closed: 409,
  match_proposal_time_past: 400,
  match_proposal_pending_exists: 409,
  match_proposal_not_pending: 409,
  match_schedule_closed: 409,
  match_schedule_completed: 409,
} satisfies Partial<Record<keyof typeof matchErrors, number>>;

function throwPhaseProposalWriteError(error: { code: string; message: string }): never {
  if (error.code === 'P0001' && Object.hasOwn(proposalWriteErrors, error.message)) {
    const code = error.message as keyof typeof proposalWriteErrors;
    throw new UserFacingError(matchErrors[code], { code, status: proposalWriteErrors[code] });
  }
  throw error;
}

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

export async function getPhaseMatchProposalById(id: string): Promise<MatchProposal | null> {
  assertValidUuid(id, 'proposal id');
  const { data, error } = await supabase.from('phase_match_proposals').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? toMatchProposal(data) : null;
}

export async function createPhaseMatchProposal(
  phaseId: string, matchId: string, playerId: string, proposedAt: string, message = '',
): Promise<MatchProposal> {
  matchProposalMachine.assertTransition(PENDING, 'expired', 'system');
  const { data, error } = await supabase.rpc('phase_match_proposal_create', {
    p_phase_id: phaseId, p_match_id: matchId, p_player_id: playerId, p_proposed_at: proposedAt, p_message: message,
  });
  if (error) throwPhaseProposalWriteError(error);
  return toMatchProposal(data as unknown as Tables<'phase_match_proposals'>);
}

export async function respondToPhaseMatchProposal(
  phaseId: string, matchId: string, proposalId: string, playerId: string, accept: boolean,
): Promise<MatchProposal> {
  matchProposalMachine.assertTransition(PENDING, accept ? 'accepted' : 'rejected', 'responder');
  matchProposalMachine.assertTransition(PENDING, 'expired', 'system');
  if (accept) matchProposalMachine.assertTransition(PENDING, 'cancelled', 'system');
  const { data, error } = await supabase.rpc('phase_match_proposal_respond', {
    p_phase_id: phaseId, p_match_id: matchId, p_proposal_id: proposalId, p_player_id: playerId, p_accept: accept,
  });
  if (error) throwPhaseProposalWriteError(error);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.outcome === 'expired') {
      throw new UserFacingError(matchErrors.match_proposal_expired, { code: 'match_proposal_expired', status: 409 });
    }
    if (data.outcome === 'answered' && data.proposal) {
      return toMatchProposal(data.proposal as unknown as Tables<'phase_match_proposals'>);
    }
  }
  throw new Error('Unexpected phase proposal response');
}

export async function overridePhaseMatchSchedule(
  phaseId: string, matchId: string, scheduledAt: string | null,
): Promise<ScheduleResult> {
  matchProposalMachine.assertTransition(PENDING, 'cancelled', 'admin');
  const { data, error } = await supabase.rpc('phase_match_schedule_override', {
    p_phase_id: phaseId, p_match_id: matchId, p_scheduled_at: scheduledAt as unknown as string,
  });
  if (error) throwPhaseProposalWriteError(error);
  return data as unknown as ScheduleResult;
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

export async function listPhaseMatchProposals(matchId: string, playerId: string): Promise<MatchProposalWithPlayers[]> {
  assertValidUuid(matchId, 'match id');
  assertValidUuid(playerId, 'player id');

  const { rows } = await readBoundedPages<MatchProposalWithPlayersRow>(
    (from, to) => supabase
      .from('phase_match_proposals')
      .select(`
        *,
        proposer:players!phase_match_proposals_proposer_id_fkey ( name ),
        responder:players!phase_match_proposals_responder_id_fkey ( name )
      `)
      .eq('match_id', matchId)
      .or(`proposer_id.eq.${playerId},responder_id.eq.${playerId}`)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
    { label: 'listPhaseMatchProposals' },
  );

  return rows.map(toMatchProposalWithPlayers);
}

export async function countOpenPhaseMatchProposals(matchId: string, nowIso: string): Promise<number> {
  assertValidUuid(matchId, 'match id');
  const { count, error } = await supabase
    .from('phase_match_proposals')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('status', PENDING)
    .gt('expires_at', nowIso);
  if (error) throw error;
  return count ?? 0;
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
  return updateMatchProposalStatus(id, 'accepted', 'responder');
}

export async function rejectMatchProposal(id: string): Promise<MatchProposal> {
  return updateMatchProposalStatus(id, 'rejected', 'responder');
}

export async function expireMatchProposal(id: string): Promise<MatchProposal> {
  return updateMatchProposalStatus(id, 'expired', 'system');
}

/**
 * Moves the match's pending proposals whose `expires_at` has passed to expired (event `expire`): before a new
 * proposal, so an overdue one nobody answered no longer counts as the match's pending proposal (nor holds the
 * one-pending-per-player index). Returns the expired rows.
 */
export async function expireOverdueMatchProposals(matchId: string, nowIso: string): Promise<MatchProposal[]> {
  assertValidUuid(matchId, 'match id');
  matchProposalMachine.assertTransition(PENDING, 'expired', 'system');

  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status: 'expired', responded_at: nowIso })
    .eq('match_id', matchId)
    .eq('status', PENDING)
    .lte('expires_at', nowIso)
    .select();

  if (error) throw error;
  return data.map(toMatchProposal);
}

export async function cancelPendingMatchProposalsForMatch(matchId: string): Promise<MatchProposal[]> {
  assertValidUuid(matchId, 'match id');

  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('match_id', matchId)
    .eq('status', PENDING)
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

/** The proposal left pending between the caller's read and its answer (another answer, an expiry, a cancellation). HTTP 409. */
export class MatchProposalNotPendingError extends UserFacingError<'match_proposal_not_pending'> {
  constructor() {
    super('Proposal is no longer pending', { code: 'match_proposal_not_pending', status: 409 });
    this.name = 'MatchProposalNotPendingError';
  }
}

/** An answer to a pending proposal (match proposal machine): written only while the row is still pending. */
async function updateMatchProposalStatus(
  id: string,
  status: Exclude<MatchProposalStatus, 'pending'>,
  actor: 'responder' | 'system'
): Promise<MatchProposal> {
  assertValidUuid(id, 'proposal id');
  matchProposalMachine.assertTransition(PENDING, status, actor);

  const { data, error } = await supabase
    .from('match_proposals')
    .update({ status, responded_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', PENDING)
    .select()
    .maybeSingle();

  if (error) throw error;
  // A concurrent answer, expiry or cancellation got there first: the row is no longer pending.
  if (!data) throw new MatchProposalNotPendingError();
  return toMatchProposal(data);
}
