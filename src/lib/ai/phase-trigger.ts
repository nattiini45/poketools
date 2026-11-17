import 'server-only';
import { generatePhaseReportAsync } from './phase-report-generator';
import type { PhaseReportStandings } from './kale/phase-fact-pack';
import type { PhaseReport, PhaseReportType } from '@/types/phase-report';
import { logger } from '@/lib/logger';

export function bindPhaseReportTrigger(standings: PhaseReportStandings, publish?: (report: PhaseReport) => Promise<void>) {
  return (phaseId: string, roundId: string, reportType: PhaseReportType): void => {
    void generatePhaseReportAsync(phaseId, roundId, reportType, standings).then(async result => {
      if (result.kind === 'generated') await publish?.(result.report);
    }).catch(error => {
      logger.error('ai/phase-trigger', 'Phase report trigger failed', { error, phaseId, roundId, reportType });
    });
  };
}
