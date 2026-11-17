import type { PhaseReport } from '@/types/phase-report';

export type PublicPhaseReport = Pick<PhaseReport,
  'id' | 'phase_id' | 'round_id' | 'report_type' | 'content' | 'status' | 'created_at' | 'updated_at'
>;

export function toPublicPhaseReport(report: PhaseReport): PublicPhaseReport {
  return {
    id: report.id, phase_id: report.phase_id, round_id: report.round_id,
    report_type: report.report_type, content: report.content, status: report.status,
    created_at: report.created_at, updated_at: report.updated_at,
  };
}
