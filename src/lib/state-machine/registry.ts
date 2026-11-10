import type { MachineSpec } from './machine';
import { actionMachine } from '@/lib/ai/admin-agent/store/action-state';
import { planMachine } from '@/lib/ai/admin-agent/store/plan-state';
import { proposalMachine } from '@/lib/ai/admin-agent/store/proposal-state';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';
import { castSessionMachine } from '@/lib/broadcast/cast-session-state';
import { castStudioSaveMachine } from '@/lib/broadcast/cast-studio-save-state';
import { draftPoolPauseMachine, draftPoolPhaseMachine, redraftSubmissionWindowMachine } from '@/lib/draft/pool-phase-state';
import { draftPoolStatusMachine } from '@/lib/draft/pool-status-state';
import { draftSlotMachine } from '@/lib/draft/slot-state';
import { draftKillTokenWindowMachine } from '@/lib/draft/token-window-state';
import { playerStatusMachine } from '@/lib/players/player-status-state';
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
  proposalMachine.spec,
  actionMachine.spec,
  planMachine.spec,
  castSessionMachine.spec,
  castStudioSaveMachine.spec,
  playerStatusMachine.spec,
  draftPoolStatusMachine.spec,
  draftPoolPhaseMachine.spec,
  draftPoolPauseMachine.spec,
  redraftSubmissionWindowMachine.spec,
  draftSlotMachine.spec,
  draftKillTokenWindowMachine.spec,
];
