import 'server-only';
import { generatePhaseReportAsync } from './phase-report-generator';
import type { PhaseReportStandings } from './kale/phase-fact-pack';
import type { PhaseReportType } from '@/types/phase-report';
import { logger } from '@/lib/logger';

export function bindPhaseReportTrigger(standings: PhaseReportStandings) {
  return (phaseId: string, roundId: string, reportType: PhaseReportType): void => {
    void generatePhaseReportAsync(phaseId, roundId, reportType, standings).catch(error => {
      logger.error('ai/phase-trigger', 'Phase report trigger failed', { error, phaseId, roundId, reportType });
    });
  };
}
