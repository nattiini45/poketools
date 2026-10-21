import { describe, expect, it } from 'vitest';
import {
  cardStateOf,
  LINE_LEVEL_REASONS,
  remainingAfterPick,
  toDraftViewModel,
} from '@/lib/draft-ui/snapshot-adapter';
import type { DraftSnapshotDTO } from '@/lib/draft-ui/snapshot-types';
import { DAWN, MISTY, OTHER, participant, snapshot } from './fixtures';

describe('toDraftViewModel', () => {
  it('maps pool fields and server time', () => {
    const vm = toDraftViewModel(snapshot());
    expect(vm.version).toBe(42);
    expect(vm.serverNow).toBe(Date.parse('2026-10-09T12:00:00.000Z'));
    expect(vm).toMatchObject({ mode: 'live', kind: 'initial', status: 'in_progress', phase: 'drafting', paused: false });
    expect(vm.pauseReason).toBeNull();
    expect(vm.rosterSize).toBe(9);
    expect(vm.budget).toBe(180);
    expect(vm.ladderSeconds).toEqual([43_200, 21_600, 10_800, 5_400]);
  });

  it('flags the viewer on the clock and names the active and next player', () => {
    const vm = toDraftViewModel(snapshot());
    expect(vm.activeSlot).toMatchObject({ slot_id: 'slot-3', playerName: 'Dawn', isViewer: true });
    expect(vm.viewerOnClock).toBe(true);
    expect(vm.viewerUpNext).toBe(false);
    expect(vm.nextPlayer).toEqual({ playerId: MISTY, name: 'Misty', isViewer: false });
  });

  it('flags "up next" for the following player', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({ ...dto, viewer: { ...dto.viewer, player_id: MISTY } });
    expect(vm.viewerOnClock).toBe(false);
    expect(vm.viewerUpNext).toBe(true);
    expect(vm.nextPlayer?.isViewer).toBe(true);
  });

  it('is never "on the clock" when the pool is not in progress', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({ ...dto, pool: { ...dto.pool, status: 'complete' } });
    expect(vm.viewerOnClock).toBe(false);
    expect(vm.viewerUpNext).toBe(false);
  });

  it('marks round breaks in the upcoming strip, starting from the active slot round', () => {
    const vm = toDraftViewModel(snapshot());
    expect(vm.upcoming.map((u) => [u.pickNumber, u.round, u.roundBreakBefore])).toEqual([
      [4, 2, false],
      [5, 3, true],
      [6, 3, false],
    ]);
    expect(vm.upcoming[2]).toMatchObject({ kind: 'makeup', isViewer: true, name: 'Dawn', slotId: 'slot-6' });
  });

  it('marks a break before the first upcoming item when the round changes after the active slot', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({ ...dto, active_slot: dto.active_slot && { ...dto.active_slot, round: 1 } });
    expect(vm.upcoming[0].roundBreakBefore).toBe(true);
  });

  it('sorts picks ascending and lists the recent picks newest first', () => {
    const dto = snapshot();
    const third = { ...dto.picks[0], pick_id: 'p3', pick_number: 3, line_id: 'mona--x', player_id: DAWN };
    const fourth = { ...dto.picks[0], pick_id: 'p4', pick_number: 4, line_id: 'dratini--dragonite', player_id: MISTY };
    const vm = toDraftViewModel({ ...dto, picks: [fourth, ...dto.picks, third] });
    expect(vm.picks.map((p) => p.pick_number)).toEqual([1, 2, 3, 4]);
    expect(vm.picks[0].playerName).toBe('Dawn');
    expect(vm.recentPicks.map((p) => p.pick_number)).toEqual([4, 3, 2]);
  });

  it('maps owners, roster lines and the viewer budget', () => {
    const vm = toDraftViewModel(snapshot());
    expect(vm.takenBy['gastly--gengar']).toEqual({ playerId: MISTY, name: 'Misty' });
    expect(vm.participants.map((p) => [p.name, p.isViewer, p.rosterLineIds])).toEqual([
      ['Dawn', true, ['teddiursa--ursalunabloodmoon']],
      ['Misty', false, ['gastly--gengar']],
    ]);
    expect(vm.viewer).toMatchObject({
      playerId: DAWN,
      isParticipant: true,
      isPoolAdmin: false,
      budgetRemaining: 150,
      picksMade: 1,
      slotsTotal: 9,
      pickBlock: null,
      activePlayerLineStatus: null,
    });
  });

  it('orders roster lines by pick, then by catalog order (kept redraft lines)', () => {
    const dto = snapshot();
    const vm = toDraftViewModel(
      { ...dto, taken: { ...dto.taken, 'zubat--crobat': DAWN, 'abra--alakazam': DAWN } },
      { lines: [{ lineId: 'abra--alakazam' }, { lineId: 'zubat--crobat' }, { lineId: 'teddiursa--ursalunabloodmoon' }] },
    );
    expect(vm.participants[0].rosterLineIds).toEqual(['teddiursa--ursalunabloodmoon', 'abra--alakazam', 'zubat--crobat']);
  });

  it('gives an empty name to an owner who is not a participant of this pool', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({ ...dto, taken: { ...dto.taken, 'abra--alakazam': OTHER } });
    expect(vm.takenBy['abra--alakazam']).toEqual({ playerId: OTHER, name: '' });
  });

  it('derives extension states (used / available / na)', () => {
    const vm = toDraftViewModel(snapshot());
    expect(vm.viewer.extensions).toEqual({ plus120: 'used', plus60: 'available' });

    const dto = snapshot();
    const slow = toDraftViewModel({ ...dto, pool: { ...dto.pool, mode: 'slow' } });
    expect(slow.viewer.extensions).toEqual({ plus120: 'na', plus60: 'na' });

    const disabled = toDraftViewModel({ ...dto, config: { ...dto.config, extension_seconds: null } });
    expect(disabled.viewer.extensions).toEqual({ plus120: 'na', plus60: 'na' });

    const spectator = toDraftViewModel({
      ...dto,
      viewer: { ...dto.viewer, player_id: OTHER, is_participant: false },
    });
    expect(spectator.viewer.extensions).toEqual({ plus120: 'na', plus60: 'na' });
    expect(spectator.viewer.budgetRemaining).toBeNull();
    expect(spectator.viewerOnClock).toBe(false);
  });

  it('maps the redraft slots and restricted lines', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({
      ...dto,
      pool: { ...dto.pool, kind: 'redraft' },
      redraft: {
        phase: 'drafting',
        deadline_at: null,
        published_at: '2026-10-08T22:00:00.000Z',
        drops: [],
        viewer_slots: [
          { redraft_slot_id: 'r-a', label: 'A', dropped_line_id: 'zubat--crobat', transferred_real_kills: 4, filled_by_pick_id: null },
          { redraft_slot_id: 'r-b', label: 'B', dropped_line_id: 'abra--alakazam', transferred_real_kills: 0, filled_by_pick_id: 'p9' },
        ],
      },
      viewer: { ...dto.viewer, restricted_line_ids: ['mona--x'] },
    });
    expect(vm.viewer.redraftSlots).toEqual([
      { redraftSlotId: 'r-a', label: 'A', droppedLineId: 'zubat--crobat', transferredRealKills: 4, filledByPickId: null, open: true },
      { redraftSlotId: 'r-b', label: 'B', droppedLineId: 'abra--alakazam', transferredRealKills: 0, filledByPickId: 'p9', open: false },
    ]);
    expect(vm.viewer.restrictedLineIds.has('mona--x')).toBe(true);
  });

  it('ignores additive backend fields', () => {
    const dto = snapshot() as DraftSnapshotDTO & { published_now: boolean; future_field: string };
    dto.published_now = true;
    dto.future_field = 'x';
    const vm = toDraftViewModel(dto);
    expect(vm).not.toHaveProperty('published_now');
    expect(vm).not.toHaveProperty('future_field');
    expect(vm).not.toHaveProperty('recent_events');
  });

  it('copes with an empty pool (no slot, no upcoming, no picks)', () => {
    const dto = snapshot({ active_slot: null, upcoming: [], picks: [], taken: {} });
    const vm = toDraftViewModel({ ...dto, pool: { ...dto.pool, status: 'pending' } });
    expect(vm.activeSlot).toBeNull();
    expect(vm.nextPlayer).toBeNull();
    expect(vm.recentPicks).toEqual([]);
    expect(vm.viewerOnClock).toBe(false);
  });
});

describe('cardStateOf', () => {
  const vm = toDraftViewModel(snapshot());

  it('returns mine / drafted for taken lines', () => {
    expect(cardStateOf(vm, 'teddiursa--ursalunabloodmoon')).toBe('mine');
    expect(cardStateOf(vm, 'gastly--gengar')).toBe('drafted');
  });

  it('greys a card only for line-level reasons, NOT_ENOUGH_LINES included', () => {
    expect(LINE_LEVEL_REASONS.has('NOT_ENOUGH_LINES')).toBe(true);
    expect(cardStateOf(vm, 'mona--x')).toBe('blocked');
    expect(cardStateOf(vm, 'dratini--dragonite')).toBe('blocked');
    expect(cardStateOf(vm, 'cosmog--solgaleo')).toBe('available');
    expect(cardStateOf(vm, 'abra--alakazam')).toBe('available');
  });

  it('never greys a card for viewer-level reasons', () => {
    for (const code of ['NOT_YOUR_TURN', 'DRAFT_PAUSED', 'ROSTER_FULL', 'SIGNED_OUT', 'NOT_PARTICIPANT'] as const) {
      expect(LINE_LEVEL_REASONS.has(code)).toBe(false);
    }
  });

  it('uses a given status map (admin pick-on-behalf)', () => {
    expect(cardStateOf(vm, 'abra--alakazam', { 'abra--alakazam': { code: 'LINE_RESTRICTED' } })).toBe('blocked');
  });

  it('shows a spectator every taken line as drafted', () => {
    const dto = snapshot();
    const spectator = toDraftViewModel({ ...dto, participants: [participant(DAWN, 'Dawn', 1)], viewer: { ...dto.viewer, player_id: null, is_participant: false } });
    expect(cardStateOf(spectator, 'teddiursa--ursalunabloodmoon')).toBe('drafted');
  });
});

describe('remainingAfterPick', () => {
  it('subtracts the price from the viewer budget (may go negative)', () => {
    const vm = toDraftViewModel(snapshot());
    expect(remainingAfterPick(vm, 30)).toBe(120);
    expect(remainingAfterPick(vm, 160)).toBe(-10);
  });

  it('is null for spectators', () => {
    const dto = snapshot();
    const vm = toDraftViewModel({ ...dto, viewer: { ...dto.viewer, player_id: null, is_participant: false } });
    expect(remainingAfterPick(vm, 30)).toBeNull();
  });
});
