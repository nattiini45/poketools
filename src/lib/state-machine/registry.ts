import type { MachineSpec } from './machine';
import { matchMachine } from '@/lib/tournament/match-state';
import { aggregateJobMachine } from '@/lib/match/aggregate-job-state';
import {
  gameAggregateMarkerMachine,
  gameEditLeaseMachine,
  gameEvolutionCreditMachine,
  gameStatsLockMachine,
} from '@/lib/match/game-marker-state';
import { leagueTrashMachine } from '@/lib/league-trash/lifecycle-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  aggregateJobMachine.spec,
  gameAggregateMarkerMachine.spec,
  gameEvolutionCreditMachine.spec,
  gameEditLeaseMachine.spec,
  gameStatsLockMachine.spec,
  leagueTrashMachine.spec,
];
