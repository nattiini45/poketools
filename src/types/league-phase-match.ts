import type { Match, MatchWithPlayers } from './match';

export interface PhaseMatch extends Omit<Match, 'tournament_id'> {
  phase_id: string;
}

export interface PhaseMatchWithPlayers extends PhaseMatch, Omit<MatchWithPlayers, keyof Match> {}

export type PhaseMatchWithRoundNumber = PhaseMatchWithPlayers & { round_number?: number };
