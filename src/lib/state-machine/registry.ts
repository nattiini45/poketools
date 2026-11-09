import type { MachineSpec } from './machine';
import { matchMachine } from '@/lib/tournament/match-state';
import { pickFlowMachine } from '@/lib/draft-ui/pick-flow-state';
import { armedConfirmMachine } from '@/lib/draft-ui/armed-confirm';
import { pollerMachine } from '@/lib/draft/poller-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  pickFlowMachine.spec,
  armedConfirmMachine.spec,
  pollerMachine.spec,
];
