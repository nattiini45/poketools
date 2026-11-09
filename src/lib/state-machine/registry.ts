import type { MachineSpec } from './machine';
import { teamRosterMachine } from '@/lib/team/team-roster-state';
import { teamLibraryMachine, teamShareMachine } from '@/lib/team/team-share-state';
import { matchMachine } from '@/lib/tournament/match-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  teamRosterMachine.spec,
  teamShareMachine.spec,
  teamLibraryMachine.spec,
];
