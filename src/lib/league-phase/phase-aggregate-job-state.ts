import { defineMachine } from '@/lib/state-machine/machine';
import { aggregateJobMachine } from '@/lib/match/aggregate-job-state';
import { gameAggregateMarkerMachine } from '@/lib/match/game-marker-state';

const SQL = 'supabase/migrations/20261117122000_phase_aggregate_pipeline.sql';
const STORAGE = 'src/lib/league-phase/phase-aggregate-storage.ts';
const jobWriters: Record<string, readonly string[]> = {
  claim: [`${SQL}#claim_phase_aggregate_jobs_inner`],
  complete: [`${SQL}#apply_phase_aggregate_job_inner`, STORAGE],
  retry: [`${SQL}#reclaim_stale_phase_aggregate_jobs`, STORAGE],
  fail: [`${SQL}#reclaim_stale_phase_aggregate_jobs`, STORAGE],
  requeue: [STORAGE],
  cancel: [`${SQL}#cancel_phase_aggregate_jobs_for_game`],
};

export const phaseAggregateJobMachine = defineMachine({
  ...aggregateJobMachine.spec,
  id: 'phase_aggregate_job',
  title: 'Phase aggregate job',
  storage: 'phase_aggregate_jobs.status',
  summary: 'A native phase game count. Claim, retry, failure and cancellation share the legacy queue rules. Apply commits phase and shared league/all-time counters, the phase game marker and completion together; no native game or job uses tournament storage.',
  doc: 'docs/match.md',
  transitions: aggregateJobMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: jobWriters[transition.event],
    note: undefined,
  })),
});

export const phaseGameAggregateMarkerMachine = defineMachine({
  ...gameAggregateMarkerMachine.spec,
  id: 'phase_game.aggregate_applied_at',
  title: 'Phase game aggregate marker',
  storage: 'phase_games.aggregate_applied_at (NULL = uncounted)',
  summary: 'Whether native phase battle stats are counted. Apply and rollback hold the phase game row lock and atomically change the marker with phase, league and all-time projections. Rebuilds skip live jobs without changing markers.',
  transitions: gameAggregateMarkerMachine.spec.transitions.map((transition) => ({
    ...transition,
    writers: [`${SQL}#${transition.event === 'apply' ? 'apply_phase_aggregate_job_inner' : 'rollback_phase_game_aggregates_inner'}`, STORAGE],
    note: undefined,
  })),
});
