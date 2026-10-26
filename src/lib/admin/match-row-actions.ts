/**
 * Which player-facing shortcuts the admin Matches list offers on a row. Submit Result and View
 * Prep open pages under /dashboard that redirect everyone they do not admit back to the player
 * dashboard, so a button the viewer cannot use is a dead end. The rules mirror those pages:
 * the submit page admits the two participants and a live site admin, the prep page admits the
 * two participants and the superadmin; both need the viewer to be a player. Override is not a
 * row action: the whole row opens the admin match page.
 */
import type { MatchStatus } from '@/types/match';

/** The signed-in admin as the list needs them; null where nothing is known (no buttons). */
export interface AdminMatchViewer {
  /** The viewer's own player id; null when the identity has no player. */
  playerId: string | null;
  /** Live site admin (what the submit page checks). */
  isSiteAdmin: boolean;
  /** The superadmin identity (what the prep page checks). */
  isSuperadmin: boolean;
}

/** Statuses in which a result can still be submitted and the prep still matters. */
const OPEN_STATUSES: readonly MatchStatus[] = ['scheduled', 'in_progress'];

export function matchRowActions(
  match: { status: MatchStatus; player_1_id: string; player_2_id: string },
  viewer: AdminMatchViewer | null,
): { submitResult: boolean; viewPrep: boolean } {
  if (!viewer || viewer.playerId === null || !OPEN_STATUSES.includes(match.status)) {
    return { submitResult: false, viewPrep: false };
  }
  const isParticipant = viewer.playerId === match.player_1_id || viewer.playerId === match.player_2_id;
  return {
    submitResult: isParticipant || viewer.isSiteAdmin,
    viewPrep: isParticipant || viewer.isSuperadmin,
  };
}
