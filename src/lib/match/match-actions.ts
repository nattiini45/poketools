import type { MatchStatus } from '@/types/match';
import { matchMachine, type MatchEvent } from '@/lib/tournament/match-state';

/** What `availableMatchActions` needs of a match. */
export interface MatchActionSubject {
  status: MatchStatus;
  player_1_id: string;
  player_2_id: string;
  /** Who reported the result; null for an admin screen that does not read it (an admin may confirm their own). */
  submitter_id: string | null;
}

/** Who looks at the match: a player (null when signed out) and whether they act as an admin of it. */
export interface MatchActionViewer {
  playerId: string | null;
  isAdmin: boolean;
}

/**
 * The match machine's events (docs/state-machines.md, match) the viewer may start from this screen:
 * `matchMachine.transitionsFrom(status, actor)` for the viewer's actor, plus the rules `validateTransition` adds on
 * top of the table (a player acts only on their own match, and confirms only a result they did not report). The server
 * decides again on every write; this only chooses which actions a screen offers.
 */
export function availableMatchActions(match: MatchActionSubject, viewer: MatchActionViewer): ReadonlySet<MatchEvent> {
  const isParticipant =
    viewer.playerId !== null && (viewer.playerId === match.player_1_id || viewer.playerId === match.player_2_id);
  if (!viewer.isAdmin && !isParticipant) return new Set();
  const actions = new Set<MatchEvent>();
  for (const transition of matchMachine.transitionsFrom(match.status, viewer.isAdmin ? 'admin' : 'player')) {
    if (transition.event === 'confirm' && !viewer.isAdmin && match.submitter_id === viewer.playerId) continue;
    actions.add(transition.event);
  }
  return actions;
}
