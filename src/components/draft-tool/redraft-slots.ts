import type { RedraftSlotVM } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';

/**
 * The Redraft slots the confirm dialog offers for a pick (null = not a Redraft
 * pick, no chooser). The server requires a slot of the PICKING player for every
 * Redraft pick (`draft__commit_pick` raises REDRAFT_SLOT_REQUIRED /
 * REDRAFT_SLOT_INVALID otherwise), so:
 * - a player's own pick lists the viewer's slots (`redraft.viewer_slots`);
 * - an admin's pick on behalf of the active player lists THAT player's slots,
 *   from `redraft.admin_slots` (sent to pool admins after the publish). The
 *   admin's own slots never apply to someone else's pick.
 */
export function redraftSlotsForPick(
  kind: 'initial' | 'redraft',
  viewerSlots: readonly RedraftSlotVM[],
  redraft: DraftSnapshotDTO['redraft'] | undefined,
  onBehalfOfPlayerId: string | null,
): RedraftSlotVM[] | null {
  if (kind !== 'redraft') return null;
  if (onBehalfOfPlayerId === null) return [...viewerSlots];
  const all = redraft?.admin_slots;
  // Before the publish no slot exists yet; the server refuses the pick and the dialog shows that error.
  if (!Array.isArray(all)) return [];
  return all
    .filter((s) => s.player_id === onBehalfOfPlayerId)
    .map((s) => ({
      redraftSlotId: s.redraft_slot_id,
      label: s.label,
      droppedLineId: s.dropped_line_id,
      transferredRealKills: s.transferred_real_kills,
      filledByPickId: s.filled_by_pick_id,
      open: s.filled_by_pick_id === null,
    }));
}
