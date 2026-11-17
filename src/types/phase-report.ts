import type { TournamentReport } from './tournament-report';

export type PhaseReportType = 'round_recap' | 'round_forecast';

export interface PhaseReport extends Omit<TournamentReport, 'tournament_id' | 'round_id' | 'report_type'> {
  phase_id: string;
  round_id: string | null;
  report_type: PhaseReportType;
}
