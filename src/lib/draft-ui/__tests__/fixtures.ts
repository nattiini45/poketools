/** Snapshot fixtures for the draft-ui tests (no DB, no network). */
import type { DraftSnapshotDTO, DraftSnapshotParticipant } from '@/lib/draft-ui/snapshot-types';

export const DAWN = '00000000-0000-4000-8000-00000000000a';
export const MISTY = '00000000-0000-4000-8000-00000000000b';
export const OTHER = '00000000-0000-4000-8000-00000000000c';

export function participant(
  playerId: string,
  name: string,
  seat: number,
  overrides: Partial<DraftSnapshotParticipant> = {},
): DraftSnapshotParticipant {
  return {
    player_id: playerId,
    name,
    avatar_url: null,
    seat,
    standing_rank: null,
    slots_total: 9,
    picks_made: 1,
    open_slots: 8,
    budget_start: 180,
    budget_remaining: 150,
    penalty_stage: 0,
    timeout_count: 0,
    extensions: { plus120_used: false, plus60_used: false },
    done: false,
    ...overrides,
  };
}

/** Dawn on the clock (round 1, pick 3), Misty next; viewer = Dawn. */
export function snapshot(overrides: Partial<DraftSnapshotDTO> = {}): DraftSnapshotDTO {
  return {
    state_version: 42,
    server_now: '2026-10-09T12:00:00.000Z',
    pool: {
      id: 'pool-1',
      season_id: 'season-1',
      kind: 'initial',
      mode: 'live',
      status: 'in_progress',
      paused: false,
      paused_at: null,
      roster_size: 9,
      budget: 180,
      started_at: '2026-10-09T11:00:00.000Z',
      ended_at: null,
      phase: 'drafting',
      pause_reason: null,
      list_version_id: 'list-1',
      league_time_zone: 'Europe/Berlin',
    },
    config: {
      pick_seconds: 300,
      makeup_seconds: 150,
      slow_ladder_seconds: [43_200, 21_600, 10_800, 5_400],
      extension_seconds: [120, 60],
      redraft_max_lines: 3,
    },
    participants: [
      participant(DAWN, 'Dawn', 1, { budget_remaining: 150, picks_made: 1, extensions: { plus120_used: true, plus60_used: false } }),
      participant(MISTY, 'Misty', 2, { budget_remaining: 152, picks_made: 1 }),
    ],
    active_slot: {
      slot_id: 'slot-3',
      player_id: DAWN,
      round: 2,
      pick_number: 3,
      kind: 'normal',
      status: 'active',
      duration_ms: 300_000,
      extensions_applied_ms: 0,
      started_at: '2026-10-09T11:58:00.000Z',
      deadline_at: '2026-10-09T12:03:00.000Z',
      remaining_ms_at_pause: null,
    },
    upcoming: [
      { slot_id: 'slot-4', player_id: MISTY, pick_number: 4, round: 2, kind: 'normal', duration_ms: 300_000 },
      { slot_id: 'slot-5', player_id: MISTY, pick_number: 5, round: 3, kind: 'normal', duration_ms: 300_000 },
      { slot_id: 'slot-6', player_id: DAWN, pick_number: 6, round: 3, kind: 'makeup', duration_ms: 150_000 },
    ],
    picks: [
      {
        pick_id: 'p2',
        slot_id: 'slot-2',
        pick_number: 2,
        round: 1,
        player_id: MISTY,
        line_id: 'gastly--gengar',
        entry_id: 'e2',
        price: 28,
        made_at: '2026-10-09T11:55:00.000Z',
        admin_override: false,
        redraft_slot_id: null,
      },
      {
        pick_id: 'p1',
        slot_id: 'slot-1',
        pick_number: 1,
        round: 1,
        player_id: DAWN,
        line_id: 'teddiursa--ursalunabloodmoon',
        entry_id: 'e1',
        price: 30,
        made_at: '2026-10-09T11:50:00.000Z',
        admin_override: false,
        redraft_slot_id: null,
      },
    ],
    taken: { 'teddiursa--ursalunabloodmoon': DAWN, 'gastly--gengar': MISTY },
    redraft: null,
    recent_events: [],
    viewer: {
      player_id: DAWN,
      is_participant: true,
      is_pool_admin: false,
      pick_block: null,
      line_status: {
        'gastly--gengar': { code: 'LINE_TAKEN', params: { player_id: MISTY } },
        'mona--x': { code: 'NOT_ENOUGH_LINES', params: { slots: 2, available: 1 } },
        'dratini--dragonite': { code: 'INSUFFICIENT_BUDGET', params: { price: 30, remaining: 20 } },
        'cosmog--solgaleo': { code: 'NOT_YOUR_TURN' },
      },
      restricted_line_ids: [],
    },
    ...overrides,
  };
}
