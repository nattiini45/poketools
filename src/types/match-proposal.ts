import type { Enums } from './database';

export type MatchProposalStatus = Enums<'match_proposal_status'>;

export interface MatchProposal {
  id: string;
  match_id: string;
  proposer_id: string;
  responder_id: string;
  proposed_at: string;
  message: string;
  status: MatchProposalStatus;
  expires_at: string;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchProposalWithPlayers extends MatchProposal {
  /** null when the player could not be joined; render a localized fallback. */
  proposer_name: string | null;
  responder_name: string | null;
}