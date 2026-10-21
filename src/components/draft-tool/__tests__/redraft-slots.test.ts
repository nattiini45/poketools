/**
 * The confirm dialog's Redraft slot list: a player's own pick offers the
 * viewer's slots; an admin's on-behalf pick offers the ACTIVE player's slots
 * (from `redraft.admin_slots`), since `draft__commit_pick` refuses every
 * Redraft pick without a slot of the picking player (REDRAFT_SLOT_REQUIRED).
 */
import { describe, expect, it } from 'vitest';
import type { RedraftSlotVM } from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { redraftSlotsForPick } from '../redraft-slots';

const ADMIN = 'player-admin';
const P = 'player-p';

const viewerSlots: RedraftSlotVM[] = [
  { redraftSlotId: 'own-A', label: 'A', droppedLineId: 'a--a', transferredRealKills: 0, filledByPickId: null, open: true },
];

const redraft: NonNullable<DraftSnapshotDTO['redraft']> = {
  phase: 'drafting',
  deadline_at: null,
  published_at: '2026-10-19T10:00:00Z',
  drops: [],
  viewer_slots: [],
  admin_slots: [
    { redraft_slot_id: 'own-A', player_id: ADMIN, label: 'A', dropped_line_id: 'a--a', transferred_real_kills: 0, filled_by_pick_id: null },
    { redraft_slot_id: 'p-A', player_id: P, label: 'A', dropped_line_id: 'b--b', transferred_real_kills: 2, filled_by_pick_id: 'pick-1' },
    { redraft_slot_id: 'p-B', player_id: P, label: 'B', dropped_line_id: 'c--c', transferred_real_kills: 1, filled_by_pick_id: null },
  ],
};

describe('redraftSlotsForPick', () => {
  it('offers no chooser outside a Redraft pool', () => {
    expect(redraftSlotsForPick('initial', viewerSlots, redraft, null)).toBeNull();
    expect(redraftSlotsForPick('initial', viewerSlots, redraft, P)).toBeNull();
  });

  it("a player's own pick lists the viewer's slots", () => {
    expect(redraftSlotsForPick('redraft', viewerSlots, redraft, null)).toEqual(viewerSlots);
  });

  it("an on-behalf pick lists the active player's slots, never the admin's own", () => {
    const slots = redraftSlotsForPick('redraft', viewerSlots, redraft, P);
    expect(slots?.map((s) => s.redraftSlotId)).toEqual(['p-A', 'p-B']);
    expect(slots?.filter((s) => s.open).map((s) => s.redraftSlotId)).toEqual(['p-B']);
    expect(slots?.find((s) => s.redraftSlotId === 'p-B')).toEqual({
      redraftSlotId: 'p-B',
      label: 'B',
      droppedLineId: 'c--c',
      transferredRealKills: 1,
      filledByPickId: null,
      open: true,
    });
  });

  it('an on-behalf pick without the admin slot list (before publish) offers an empty list, not the admin slots', () => {
    const { admin_slots: _unused, ...withoutAdmin } = redraft;
    void _unused;
    expect(redraftSlotsForPick('redraft', viewerSlots, withoutAdmin, P)).toEqual([]);
    expect(redraftSlotsForPick('redraft', viewerSlots, null, P)).toEqual([]);
  });
});
