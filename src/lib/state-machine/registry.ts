import type { MachineSpec } from './machine';
import { matchMachine } from '@/lib/tournament/match-state';
import { tournamentMachine } from '@/lib/tournament/tournament-state';
import { seasonMachine } from '@/lib/season/season-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [matchMachine.spec, tournamentMachine.spec, seasonMachine.spec];
