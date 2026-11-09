import type { MachineSpec } from './machine';
import { draftPoolPauseMachine, draftPoolPhaseMachine, redraftSubmissionWindowMachine } from '@/lib/draft/pool-phase-state';
import { draftPoolStatusMachine } from '@/lib/draft/pool-status-state';
import { draftSlotMachine } from '@/lib/draft/slot-state';
import { draftKillTokenWindowMachine } from '@/lib/draft/token-window-state';
import { matchMachine } from '@/lib/tournament/match-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  draftPoolStatusMachine.spec,
  draftPoolPhaseMachine.spec,
  draftPoolPauseMachine.spec,
  redraftSubmissionWindowMachine.spec,
  draftSlotMachine.spec,
  draftKillTokenWindowMachine.spec,
];
