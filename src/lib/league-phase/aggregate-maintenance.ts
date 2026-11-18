import { createProcessAggregatesHandler, type AggregateMaintenanceStorage } from '@/lib/match/process-aggregates';
import {
  countAllFailedAggregateJobs,
  getAllAggregateJobHealth,
  processAllAggregateJobs,
} from '@/lib/match/aggregate-queue';
import {
  countFailedPhaseAggregateJobs,
  getPhaseAggregateJobHealth,
  processPhaseAggregateJobs,
  type PhaseAggregateOwner,
} from './phase-aggregate-storage';

export function mixedAggregateMaintenanceStorage(onPhaseApplied: (owner: PhaseAggregateOwner) => Promise<void>): AggregateMaintenanceStorage {
  return {
    process: (limit) => processAllAggregateJobs(limit, onPhaseApplied),
    health: () => getAllAggregateJobHealth(),
    countFailed: () => countAllFailedAggregateJobs(),
  };
}

export function createPhaseProcessAggregatesHandler(onApplied: (owner: PhaseAggregateOwner) => Promise<void>) {
  return createProcessAggregatesHandler({
    process: (limit) => processPhaseAggregateJobs(limit, onApplied),
    health: () => getPhaseAggregateJobHealth(),
    countFailed: () => countFailedPhaseAggregateJobs(),
  });
}
