import type { MachineSpec } from './machine';
import { actionMachine } from '@/lib/ai/admin-agent/store/action-state';
import { planMachine } from '@/lib/ai/admin-agent/store/plan-state';
import { proposalMachine } from '@/lib/ai/admin-agent/store/proposal-state';
import { aiArtifactMachine } from '@/lib/ai/artifact-state';
import { castSessionMachine } from '@/lib/broadcast/cast-session-state';
import { castStudioSaveMachine } from '@/lib/broadcast/cast-studio-save-state';
import { armedConfirmMachine } from '@/lib/draft-ui/armed-confirm';
import { pickFlowMachine } from '@/lib/draft-ui/pick-flow-state';
import { pollerMachine } from '@/lib/draft/poller-state';
import { draftPoolPauseMachine, draftPoolPhaseMachine, redraftSubmissionWindowMachine } from '@/lib/draft/pool-phase-state';
import { draftPoolStatusMachine } from '@/lib/draft/pool-status-state';
import { draftSlotMachine } from '@/lib/draft/slot-state';
import { draftKillTokenWindowMachine } from '@/lib/draft/token-window-state';
import { formatNotificationReadMachine } from '@/lib/format-engine/notifications/read-state';
import { actionSubmissionMachine, actionWindowMachine } from '@/lib/format-engine/runtime/action-state';
import { formatChallengeMachine } from '@/lib/format-engine/runtime/challenge-state';
import { formatCheckMachine } from '@/lib/format-engine/runtime/check-state';
import { relationRevealMachine } from '@/lib/format-engine/runtime/relation-state';
import { seasonFormatEngineMachine } from '@/lib/format-studio/engine-state';
import { leagueTrashMachine } from '@/lib/league-trash/lifecycle-state';
import { aggregateJobMachine } from '@/lib/match/aggregate-job-state';
import { gameAggregateMarkerMachine, gameEditLeaseMachine, gameEvolutionCreditMachine, gameStatsLockMachine } from '@/lib/match/game-marker-state';
import { matchOutcomeMachine } from '@/lib/match/outcome-state';
import { matchProposalMachine } from '@/lib/match/proposal-state';
import { playerStatusMachine } from '@/lib/players/player-status-state';
import { pushDeviceMachine } from '@/lib/push/device-state';
import { teamSaveMachine } from '@/lib/team/editor-save-state';
import { teamRosterMachine } from '@/lib/team/team-roster-state';
import { teamLibraryMachine, teamShareMachine } from '@/lib/team/team-share-state';
import { matchMachine } from '@/lib/tournament/match-state';
import { tournamentMachine } from '@/lib/tournament/tournament-state';
import { submitPhaseMachine } from '@/lib/ui/submit-phase-state';
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
  tournamentMachine.spec,
  matchOutcomeMachine.spec,
  matchProposalMachine.spec,
  teamRosterMachine.spec,
  teamShareMachine.spec,
  teamLibraryMachine.spec,
  aggregateJobMachine.spec,
  gameAggregateMarkerMachine.spec,
  gameEvolutionCreditMachine.spec,
  gameEditLeaseMachine.spec,
  gameStatsLockMachine.spec,
  leagueTrashMachine.spec,
  actionWindowMachine.spec,
  actionSubmissionMachine.spec,
  formatChallengeMachine.spec,
  formatCheckMachine.spec,
  relationRevealMachine.spec,
  formatNotificationReadMachine.spec,
  seasonFormatEngineMachine.spec,
  pickFlowMachine.spec,
  armedConfirmMachine.spec,
  pollerMachine.spec,
  teamSaveMachine.spec,
  pushDeviceMachine.spec,
  submitPhaseMachine.spec,
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
