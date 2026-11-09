import type { MachineSpec } from './machine';
import { actionSubmissionMachine, actionWindowMachine } from '@/lib/format-engine/runtime/action-state';
import { formatChallengeMachine } from '@/lib/format-engine/runtime/challenge-state';
import { formatCheckMachine } from '@/lib/format-engine/runtime/check-state';
import { relationRevealMachine } from '@/lib/format-engine/runtime/relation-state';
import { formatNotificationReadMachine } from '@/lib/format-engine/notifications/read-state';
import { seasonFormatEngineMachine } from '@/lib/format-studio/engine-state';
import { matchMachine } from '@/lib/tournament/match-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  actionWindowMachine.spec,
  actionSubmissionMachine.spec,
  formatChallengeMachine.spec,
  formatCheckMachine.spec,
  relationRevealMachine.spec,
  formatNotificationReadMachine.spec,
  seasonFormatEngineMachine.spec,
];
