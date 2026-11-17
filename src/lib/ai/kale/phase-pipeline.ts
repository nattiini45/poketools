import 'server-only';
import { buildPhaseRecapFactPack, buildPhaseForecastFactPack, type PhaseReportStandings } from './phase-fact-pack';
import { roundRecapDefinition } from './reports/round-recap';
import { roundForecastDefinition } from './reports/round-forecast';
import { runFactPackPipeline } from './pipeline';
import type { PhaseReportType } from '@/types/phase-report';

export async function runPhasePipeline(phaseId: string, roundId: string, reportType: PhaseReportType,
  standings: PhaseReportStandings, onProgress?: () => void) {
  const started = Date.now();
  const recap = reportType === 'round_recap';
  const facts = recap ? await buildPhaseRecapFactPack(phaseId, roundId, standings)
    : await buildPhaseForecastFactPack(phaseId, roundId, standings);
  return runFactPackPipeline(recap ? roundRecapDefinition : roundForecastDefinition, facts, onProgress, started);
}
