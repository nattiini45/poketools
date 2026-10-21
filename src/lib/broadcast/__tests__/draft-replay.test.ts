import { describe, it, expect } from 'vitest';
import {
  createReplayState,
  advanceToIndex,
  stepForward,
  stepBackward,
  jumpToRound,
  getCurrentEvent,
  getDisplayDuration,
  getTotalRounds,
} from '../draft-replay';
import type { DraftReplayEvent, DraftReplayPickData } from '@/types/broadcast';

// ─── Fixtures ──────────────────────────────────────────────────────

function makePickEvent(seq: number, playerId: string, pokemon: string, round: number, opts?: Partial<DraftReplayPickData>): DraftReplayEvent {
  return {
    id: `event-${seq}`,
    draft_pool_id: 'pool-1',
    pick_id: `pick-${seq}`,
    event_type: 'pick',
    event_data: {
      player_id: playerId,
      player_name: playerId === 'p1' ? 'Ash' : 'Gary',
      pokemon_name: pokemon,
      power_tier: null,
      points_spent: null,
      round,
      pick_number: seq,
      remaining_budget: null,
      tier_usage_after: null,
      evolution_chain: null,
      ...opts,
    },
    sequence_number: seq,
    wall_clock_time: '2024-01-01T00:00:00Z',
    display_duration_ms: 2000,
  };
}

function makeCommentaryEvent(seq: number): DraftReplayEvent {
  return {
    id: `event-${seq}`,
    draft_pool_id: 'pool-1',
    pick_id: null,
    event_type: 'commentary',
    event_data: { text: 'Great pick!', author: 'Caster' },
    sequence_number: seq,
    wall_clock_time: '2024-01-01T00:00:00Z',
    display_duration_ms: 3000,
  };
}

const EVENTS: DraftReplayEvent[] = [
  makePickEvent(1, 'p1', 'Pikachu', 1),
  makePickEvent(2, 'p2', 'Charizard', 1),
  makeCommentaryEvent(3),
  makePickEvent(4, 'p1', 'Bulbasaur', 2),
  makePickEvent(5, 'p2', 'Squirtle', 2),
];

// ─── Tests ─────────────────────────────────────────────────────────

describe('createReplayState', () => {
  it('creates initial state with sorted events', () => {
    const state = createReplayState('pool-1', EVENTS);
    expect(state.draft_pool_id).toBe('pool-1');
    expect(state.currentIndex).toBe(-1);
    expect(state.playing).toBe(false);
    expect(state.speed).toBe(1);
    expect(state.events).toHaveLength(5);
    expect(state.rosters).toEqual({});
    expect(state.budgets).toBeNull();
  });

  it('initializes budgets when provided', () => {
    const state = createReplayState('pool-1', EVENTS, 100, ['p1', 'p2']);
    expect(state.budgets).toEqual({ p1: 100, p2: 100 });
  });

  it('builds player name lookup from pick events', () => {
    const state = createReplayState('pool-1', EVENTS);
    expect(state.playerNames.p1).toBe('Ash');
    expect(state.playerNames.p2).toBe('Gary');
  });

  it('handles no budgets when no playerIds provided', () => {
    const state = createReplayState('pool-1', EVENTS, 100);
    expect(state.budgets).toBeNull();
  });
});

describe('advanceToIndex', () => {
  it('builds roster from events up to target index', () => {
    const state = createReplayState('pool-1', EVENTS);
    const advanced = advanceToIndex(state, 1);

    expect(advanced.currentIndex).toBe(1);
    expect(advanced.rosters.p1).toEqual(['Pikachu']);
    expect(advanced.rosters.p2).toEqual(['Charizard']);
  });

  it('skips non-pick events when building roster', () => {
    const state = createReplayState('pool-1', EVENTS);
    const advanced = advanceToIndex(state, 2); // commentary event

    expect(advanced.rosters.p1).toEqual(['Pikachu']);
    expect(advanced.rosters.p2).toEqual(['Charizard']);
  });

  it('rebuilds state from scratch (idempotent)', () => {
    const state = createReplayState('pool-1', EVENTS);
    const first = advanceToIndex(state, 4);
    const second = advanceToIndex(first, 4);

    expect(first.rosters).toEqual(second.rosters);
  });

  it('handles budget tracking', () => {
    const events = [
      makePickEvent(1, 'p1', 'Pikachu', 1, { points_spent: 10, remaining_budget: 90 }),
      makePickEvent(2, 'p2', 'Charizard', 1, { points_spent: 15, remaining_budget: 85 }),
    ];
    const state = createReplayState('pool-1', events, 100, ['p1', 'p2']);
    const advanced = advanceToIndex(state, 1);

    expect(advanced.budgets!.p1).toBe(90);
    expect(advanced.budgets!.p2).toBe(85);
  });

  it('clamps to last event index', () => {
    const state = createReplayState('pool-1', EVENTS);
    const advanced = advanceToIndex(state, 100);
    expect(advanced.currentIndex).toBe(4); // 5 events, max index 4
  });
});

describe('stepForward', () => {
  it('advances by one event', () => {
    const state = createReplayState('pool-1', EVENTS);
    const after = stepForward(state);
    expect(after.currentIndex).toBe(0);
  });

  it('stops playing at end of events', () => {
    const state = createReplayState('pool-1', EVENTS);
    const atEnd = advanceToIndex(state, 4);
    const result = stepForward(atEnd);
    expect(result.playing).toBe(false);
    expect(result.currentIndex).toBe(4);
  });
});

describe('stepBackward', () => {
  it('goes back one event', () => {
    const state = advanceToIndex(createReplayState('pool-1', EVENTS), 2);
    const result = stepBackward(state);
    expect(result.currentIndex).toBe(1);
  });

  it('goes to -1 when at start', () => {
    const state = advanceToIndex(createReplayState('pool-1', EVENTS), 0);
    const result = stepBackward(state);
    expect(result.currentIndex).toBe(-1);
  });
});

describe('jumpToRound', () => {
  it('jumps to the first event of a round', () => {
    const state = createReplayState('pool-1', EVENTS);
    const result = jumpToRound(state, 2);
    // First round 2 event is at index 3
    expect(result.currentIndex).toBe(3);
    expect(result.rosters.p1).toEqual(['Pikachu', 'Bulbasaur']);
  });

  it('returns unchanged state when round not found', () => {
    const state = createReplayState('pool-1', EVENTS);
    const result = jumpToRound(state, 99);
    expect(result.currentIndex).toBe(-1);
  });

  it('jumps to round 1', () => {
    const state = createReplayState('pool-1', EVENTS);
    const result = jumpToRound(state, 1);
    expect(result.currentIndex).toBe(0);
  });
});

describe('getCurrentEvent', () => {
  it('returns null when not started', () => {
    const state = createReplayState('pool-1', EVENTS);
    expect(getCurrentEvent(state)).toBeNull();
  });

  it('returns current event at index', () => {
    const state = advanceToIndex(createReplayState('pool-1', EVENTS), 0);
    const event = getCurrentEvent(state);
    expect(event).not.toBeNull();
    expect(event!.event_type).toBe('pick');
  });

  it('returns null when past end', () => {
    const state = createReplayState('pool-1', EVENTS);
    state.currentIndex = 100;
    expect(getCurrentEvent(state)).toBeNull();
  });
});

describe('getDisplayDuration', () => {
  it('returns 0 when no current event', () => {
    const state = createReplayState('pool-1', EVENTS);
    expect(getDisplayDuration(state)).toBe(0);
  });

  it('returns duration adjusted by speed', () => {
    const state = advanceToIndex(createReplayState('pool-1', EVENTS), 0);
    expect(getDisplayDuration(state)).toBe(2000); // speed=1, duration=2000

    state.speed = 2;
    expect(getDisplayDuration(state)).toBe(1000); // 2000/2
  });
});

describe('getTotalRounds', () => {
  it('returns the maximum round number', () => {
    const state = createReplayState('pool-1', EVENTS);
    expect(getTotalRounds(state)).toBe(2);
  });

  it('returns 0 when no pick events', () => {
    const state = createReplayState('pool-1', [makeCommentaryEvent(1)]);
    expect(getTotalRounds(state)).toBe(0);
  });
});
