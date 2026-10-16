import type { TournamentReportType, ReportContent } from '@/types/tournament-report';
import type { PromptTask, ValidationResult, PipelineMode, ReportParams } from './types';

// ─── Report Definition Interface ────────────────────────────────────

export interface ReportDefinition {
  type: TournamentReportType;
  buildFactPack: (params: ReportParams) => Promise<unknown>;
  getPromptTasks: (factPack: unknown, mode: PipelineMode) => PromptTask[];
  validate: (taskId: string, text: string, factPack: unknown) => ValidationResult;
  assemble: (outputs: Map<string, string>, factPack: unknown) => ReportContent;
}

// ─── Registry ───────────────────────────────────────────────────────

const registry = new Map<TournamentReportType, ReportDefinition>();

export function registerReportType(definition: ReportDefinition): void {
  registry.set(definition.type, definition);
}

export function getReportDefinition(type: TournamentReportType): ReportDefinition {
  const def = registry.get(type);
  if (!def) {
    throw new Error(`Unknown report type: "${type}". Registered types: ${[...registry.keys()].join(', ')}`);
  }
  return def;
}

export function getRegisteredTypes(): TournamentReportType[] {
  return [...registry.keys()];
}

// ─── Auto-register built-in report types ────────────────────────────

import { roundRecapDefinition } from './reports/round-recap';
import { roundForecastDefinition } from './reports/round-forecast';
import { seasonSummaryDefinition } from './reports/season-summary';
import { metaReportDefinition } from './reports/meta-report';
import { playerProfileDefinition } from './reports/player-profile';

registerReportType(roundRecapDefinition);
registerReportType(roundForecastDefinition);
registerReportType(seasonSummaryDefinition);
registerReportType(metaReportDefinition);
registerReportType(playerProfileDefinition);
