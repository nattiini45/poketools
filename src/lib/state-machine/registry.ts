import type { MachineSpec } from './machine';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';
import { matchMachine } from '@/lib/tournament/match-state';
import { noteModerationMachine } from '@/lib/wiki/note-moderation-state';
import { noteReportMachine } from '@/lib/wiki/note-report-state';

/**
 * Every explicit state machine in the app. docs/state-machines.md is generated
 * from this list (`npm run docs:state-machines`), and the registry test checks
 * each spec's structure. A new machine is added here in the same change that
 * defines it.
 */
export const STATE_MACHINES: readonly MachineSpec<string, string>[] = [
  matchMachine.spec,
  aiArtifactMachine.spec,
  noteModerationMachine.spec,
  noteReportMachine.spec,
];
