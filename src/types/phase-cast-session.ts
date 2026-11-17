import type { CastSession, CastSessionInsert, CastSessionUpdate, CastSessionPopulateResult } from './cast-session';

export interface PhaseCastSession extends Omit<CastSession, 'tournament_id'> {
  phase_id: string;
}

export type PhaseCastSessionInsert = Omit<CastSessionInsert, 'tournament_id' | 'season_id'> & { phase_id: string };
export type PhaseCastSessionUpdate = Omit<CastSessionUpdate, 'tournament_id' | 'season_id'> & { phase_id?: string };

export interface PhaseCastPopulateResult extends Omit<CastSessionPopulateResult, 'match'> {
  match: Omit<CastSessionPopulateResult['match'], 'tournament_id' | 'season_id'> & { phase_id: string; season_id: string };
}
