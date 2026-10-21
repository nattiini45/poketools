import { describe, it, expect } from 'vitest';
import {
  generateSnakeOrder,
  getRoundForPick,
  computeDraftState,
  validatePick,
  isDraftComplete,
  getDefaultRounds,
  resolveTotalRounds,
  getRoundOrder,
  rosterCompletionShortfall,
  legacySeatOrder,
  availablePricesSorted,
  legacyPickerStall,
} from '../engine';
import { defaultPickOrder } from '../pool-format';
import type { DraftPool, DraftPickWithPlayer, MakePickInput, DraftState } from '@/types/draft';

// ── Helpers ──────────────────────────────────────────────────────────

function makePool(overrides?: Partial<DraftPool>): DraftPool {
  return {
    id: 'pool-1',
    season_id: 'season-1',
    draft_type: 'snake',
    // The order each draft_type implied before the split; tests of linear/free/snake+points override it.
    pick_order: defaultPickOrder(overrides?.draft_type ?? 'snake'),
    point_budget: null,
    pool_mode: 'tier',
    default_point_cost: null,
    team_size_mode: null,
    team_size_exact: null,
    team_size_min: null,
    team_size_max: null,
    status: 'in_progress',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    engine: 'legacy',
    kind: 'initial',
    mode: 'live',
    phase: 'setup',
    list_version_id: null,
    parent_pool_id: null,
    roster_size: null,
    pick_seconds: null,
    makeup_seconds: null,
    slow_ladder_seconds: [],
    extension_seconds: [],
    extensions_enabled: true,
    redraft_max_lines: null,
    redraft_lock_no_redraft_lines: true,
    submission_deadline_at: null,
    submissions_published_at: null,
    token_purchase_closes_at: null,
    paused_at: null,
    paused_by: null,
    pause_reason: null,
    state_version: 0,
    publish_notified_at: null,
    started_at: null,
    ended_at: null,
    created_by: null,
    ...overrides,
  };
}

function makePick(
  playerId: string,
  pokemonName: string,
  pickNumber: number,
  overrides?: Partial<DraftPickWithPlayer>
): DraftPickWithPlayer {
  return {
    id: `pick-${pickNumber}`,
    draft_pool_id: 'pool-1',
    player_id: playerId,
    pokemon_name: pokemonName,
    pick_number: pickNumber,
    round: 1,
    points_spent: null,
    timestamp: '2024-01-01T00:00:00Z',
    player_name: `Player ${playerId}`,
    line_id: null,
    line_entry_id: null,
    slot_id: null,
    redraft_slot_id: null,
    client_request_id: null,
    made_by: null,
    made_by_role: null,
    override_reason: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    ...overrides,
  };
}

// ── generateSnakeOrder ───────────────────────────────────────────────

describe('generateSnakeOrder', () => {
  const players = ['A', 'B', 'C', 'D'];

  it('generates correct snake pattern for 3 rounds', () => {
    const order = generateSnakeOrder(players, 3);
    expect(order).toEqual([
      'A', 'B', 'C', 'D', // round 1: normal
      'D', 'C', 'B', 'A', // round 2: reversed
      'A', 'B', 'C', 'D', // round 3: normal
    ]);
  });

  it('produces total length = players × rounds', () => {
    const order = generateSnakeOrder(players, 5);
    expect(order).toHaveLength(players.length * 5);
  });

  it('handles single player', () => {
    const order = generateSnakeOrder(['X'], 3);
    expect(order).toEqual(['X', 'X', 'X']);
  });

  it('handles single round', () => {
    const order = generateSnakeOrder(players, 1);
    expect(order).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles zero rounds', () => {
    const order = generateSnakeOrder(players, 0);
    expect(order).toEqual([]);
  });
});

// ── getRoundForPick ──────────────────────────────────────────────────

describe('getRoundForPick', () => {
  it('returns round 1 for first pick', () => {
    expect(getRoundForPick(1, 4)).toBe(1);
  });

  it('returns round 1 for last pick in round 1', () => {
    expect(getRoundForPick(4, 4)).toBe(1);
  });

  it('returns round 2 for first pick of round 2', () => {
    expect(getRoundForPick(5, 4)).toBe(2);
  });

  it('handles mid-round pick correctly', () => {
    expect(getRoundForPick(7, 4)).toBe(2);
  });

  it('returns round 3 for pick 12 with 4 players', () => {
    expect(getRoundForPick(12, 4)).toBe(3);
  });
});

// ── isDraftComplete ──────────────────────────────────────────────────

describe('isDraftComplete', () => {
  it('returns false when picks < total', () => {
    expect(isDraftComplete(5, 4, 3)).toBe(false);
  });

  it('returns true when picks = total', () => {
    expect(isDraftComplete(12, 4, 3)).toBe(true);
  });

  it('returns true when picks > total', () => {
    expect(isDraftComplete(15, 4, 3)).toBe(true);
  });
});

// ── getDefaultRounds ─────────────────────────────────────────────────

describe('getDefaultRounds', () => {
  it('returns 11 for snake', () => {
    expect(getDefaultRounds('snake')).toBe(11);
  });

  it('returns 11 for auction', () => {
    expect(getDefaultRounds('auction')).toBe(11);
  });

  it('returns 11 for budget', () => {
    expect(getDefaultRounds('budget')).toBe(11);
  });
});

describe('resolveTotalRounds', () => {
  it('uses EPB draft_picks override when provided', () => {
    expect(resolveTotalRounds(makePool(), { epbDraftPicks: 9 })).toBe(9);
  });

  it('falls back to getDefaultRounds when no override', () => {
    expect(resolveTotalRounds(makePool())).toBe(11);
  });
});

// ── computeDraftState ────────────────────────────────────────────────

describe('computeDraftState', () => {
  const players = ['p1', 'p2', 'p3'];
  const pool = makePool();

  it('builds rosters from picks', () => {
    const picks = [
      makePick('p1', 'Pikachu', 1),
      makePick('p2', 'Charizard', 2),
      makePick('p3', 'Bulbasaur', 3),
    ];
    const state = computeDraftState(pool, picks, players, 3);
    expect(state.rosters['p1']).toEqual(['Pikachu']);
    expect(state.rosters['p2']).toEqual(['Charizard']);
    expect(state.rosters['p3']).toEqual(['Bulbasaur']);
  });

  it('initializes empty rosters for all participants', () => {
    const state = computeDraftState(pool, [], players, 3);
    expect(state.rosters['p1']).toEqual([]);
    expect(state.rosters['p2']).toEqual([]);
    expect(state.rosters['p3']).toEqual([]);
  });

  it('tracks taken_pokemon set', () => {
    const picks = [
      makePick('p1', 'Pikachu', 1),
      makePick('p2', 'Charizard', 2),
    ];
    const state = computeDraftState(pool, picks, players, 3);
    expect(state.taken_pokemon.has('Pikachu')).toBe(true);
    expect(state.taken_pokemon.has('Charizard')).toBe(true);
    expect(state.taken_pokemon.has('Bulbasaur')).toBe(false);
  });

  it('identifies correct current_picker in snake draft', () => {
    // After 2 picks in round 1 with [p1, p2, p3], next is p3
    const picks = [
      makePick('p1', 'Pikachu', 1),
      makePick('p2', 'Charizard', 2),
    ];
    const state = computeDraftState(pool, picks, players, 3);
    expect(state.current_picker).toBe('p3');
    expect(state.next_pick_number).toBe(3);
  });

  it('sets current_picker to null when draft is complete', () => {
    // 3 players × 2 rounds = 6 total picks
    const picks = [
      makePick('p1', 'Pikachu', 1),
      makePick('p2', 'Charizard', 2),
      makePick('p3', 'Bulbasaur', 3),
      makePick('p3', 'Squirtle', 4),
      makePick('p2', 'Eevee', 5),
      makePick('p1', 'Gengar', 6),
    ];
    const state = computeDraftState(pool, picks, players, 2);
    expect(state.current_picker).toBeNull();
  });

  it('computes budgets for auction drafts', () => {
    const auctionPool = makePool({
      draft_type: 'auction',
      point_budget: 100,
    });
    const picks = [
      makePick('p1', 'Pikachu', 1, { points_spent: 15 }),
      makePick('p2', 'Charizard', 2, { points_spent: 25 }),
    ];
    const state = computeDraftState(auctionPool, picks, players, 3);
    expect(state.budgets).not.toBeNull();
    expect(state.budgets!['p1']).toBe(85);
    expect(state.budgets!['p2']).toBe(75);
    expect(state.budgets!['p3']).toBe(100);
  });

  it('has null budgets for snake drafts without point budget', () => {
    const state = computeDraftState(pool, [], players, 3);
    expect(state.budgets).toBeNull();
  });

  it('computes budgets for snake drafts with point_budget (EPB)', () => {
    const epbPool = makePool({ draft_type: 'snake', point_budget: 180 });
    const picks = [
      makePick('p1', 'Gastly', 1, { points_spent: 12 }),
      makePick('p2', 'Abra', 2, { points_spent: 8 }),
    ];
    const state = computeDraftState(epbPool, picks, players, 9);
    expect(state.budgets).not.toBeNull();
    expect(state.budgets!['p1']).toBe(168);
    expect(state.budgets!['p2']).toBe(172);
  });
});

// ── validatePick ─────────────────────────────────────────────────────

describe('validatePick', () => {
  const players = ['p1', 'p2', 'p3'];

  function buildState(overrides?: Partial<DraftPool>, picks: DraftPickWithPlayer[] = []): DraftState {
    return computeDraftState(makePool(overrides), picks, players, 3);
  }

  it('returns null for a valid pick', () => {
    const state = buildState();
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p1',
      pokemon_name: 'Pikachu',
    };
    expect(validatePick(state, input, true)).toBeNull();
  });

  it('returns POOL_NOT_ACTIVE when pool not in progress', () => {
    const state = buildState({ status: 'complete' });
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p1',
      pokemon_name: 'Pikachu',
    };
    const err = validatePick(state, input, true);
    expect(err?.code).toBe('POOL_NOT_ACTIVE');
  });

  it('returns NOT_YOUR_TURN when enforceOrder is true', () => {
    const state = buildState();
    // p1 is first to pick in snake; p2 trying to pick out of turn
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p2',
      pokemon_name: 'Pikachu',
    };
    const err = validatePick(state, input, true);
    expect(err?.code).toBe('NOT_YOUR_TURN');
    // The message reaches the client verbatim: it must not leak a player id.
    expect(err?.message).toBe('It is not your turn.');
    expect(err?.message).not.toContain('p1');
  });

  it('allows out-of-order pick when enforceOrder is false', () => {
    const state = buildState();
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p2',
      pokemon_name: 'Pikachu',
    };
    expect(validatePick(state, input, false)).toBeNull();
  });

  it('returns POKEMON_TAKEN when pokemon already drafted', () => {
    const picks = [makePick('p1', 'Pikachu', 1)];
    const state = buildState(undefined, picks);
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p2',
      pokemon_name: 'Pikachu',
    };
    const err = validatePick(state, input, false);
    expect(err?.code).toBe('POKEMON_TAKEN');
  });

  it('skips the name-taken check with skipNameTakenCheck (EPB branched base)', () => {
    // EPB stores the line's base as pokemon_name: the second branch of
    // Oshawott (→ Samurott-Hisui) shares the name with the first.
    const picks = [makePick('p1', 'Oshawott', 1)];
    const state = buildState(undefined, picks);
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p2',
      pokemon_name: 'Oshawott',
      stage3_pokemon: 'Samurott-Hisui',
    };
    expect(validatePick(state, input, true, { skipNameTakenCheck: true })).toBeNull();
    // Without the option the legacy name check still applies.
    expect(validatePick(state, input, true)?.code).toBe('POKEMON_TAKEN');
  });

  it('keeps every other check when skipNameTakenCheck is set', () => {
    const picks = [makePick('p1', 'Oshawott', 1)];
    const state = buildState(undefined, picks);
    const outOfTurn: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p3',
      pokemon_name: 'Oshawott',
    };
    expect(validatePick(state, outOfTurn, true, { skipNameTakenCheck: true })?.code).toBe('NOT_YOUR_TURN');
    const inactive = buildState({ status: 'complete' }, picks);
    expect(
      validatePick(inactive, { ...outOfTurn, player_id: 'p2' }, true, { skipNameTakenCheck: true })?.code,
    ).toBe('POOL_NOT_ACTIVE');
  });

  it('returns INSUFFICIENT_BUDGET when overspending', () => {
    const picks = [makePick('p1', 'Charizard', 1, { points_spent: 90 })];
    const state = computeDraftState(
      makePool({ draft_type: 'auction', point_budget: 100 }),
      picks,
      players,
      3,
    );
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p1',
      pokemon_name: 'Pikachu',
      points_spent: 15,
    };
    const err = validatePick(state, input, false);
    expect(err?.code).toBe('INSUFFICIENT_BUDGET');
  });

  it('returns DRAFT_COMPLETE when all picks made', () => {
    const picks = [
      makePick('p1', 'A', 1),
      makePick('p2', 'B', 2),
      makePick('p3', 'C', 3),
    ];
    // 3 players × 1 round = 3 picks → complete
    const state = computeDraftState(makePool(), picks, players, 1);
    const input: MakePickInput = {
      draft_pool_id: 'pool-1',
      player_id: 'p1',
      pokemon_name: 'D',
    };
    const err = validatePick(state, input, true);
    expect(err?.code).toBe('DRAFT_COMPLETE');
  });
});

// ── pick_order (turn order separate from pricing) ───────────────────

describe('getRoundOrder', () => {
  const seats = ['A', 'B', 'C'];

  it('snake reverses every even round; linear and free keep the seat order', () => {
    expect([1, 2, 3].map((r) => getRoundOrder(seats, r, 'snake'))).toEqual([
      ['A', 'B', 'C'],
      ['C', 'B', 'A'],
      ['A', 'B', 'C'],
    ]);
    expect([1, 2, 3].map((r) => getRoundOrder(seats, r, 'linear'))).toEqual([seats, seats, seats]);
    expect(getRoundOrder(seats, 2, 'free')).toEqual(seats);
  });
});

describe('computeDraftState — pick_order', () => {
  const seats = ['A', 'B', 'C'];
  /** The first `n` picks in seat order per the given order. */
  function picksInOrder(order: 'snake' | 'linear', n: number): DraftPickWithPlayer[] {
    return Array.from({ length: n }, (_, i) => {
      const round = Math.floor(i / seats.length) + 1;
      const player = getRoundOrder(seats, round, order)[i % seats.length];
      return makePick(player, `Mon${i}`, i + 1, { round });
    });
  }

  it('linear order: the same seat starts every round and turns are enforced', () => {
    const pool = makePool({ pick_order: 'linear' });
    const round2 = computeDraftState(pool, picksInOrder('linear', 3), seats, 3);
    expect(round2.current_round).toBe(2);
    expect(round2.pick_order).toEqual(['A', 'B', 'C']);
    expect(round2.current_picker).toBe('A');
    expect(round2.turn_enforced).toBe(true);
    expect(computeDraftState(pool, picksInOrder('linear', 5), seats, 3).current_picker).toBe('C');
  });

  it('snake order still reverses in round 2', () => {
    const state = computeDraftState(makePool({ pick_order: 'snake' }), picksInOrder('snake', 3), seats, 3);
    expect(state.pick_order).toEqual(['C', 'B', 'A']);
    expect(state.current_picker).toBe('C');
    expect(state.turn_enforced).toBe(true);
  });

  it('free order keeps a round-robin suggestion but enforces no turn', () => {
    const state = computeDraftState(makePool({ draft_type: 'budget', pick_order: 'free', point_budget: 100 }), [], seats, 3);
    expect(state.turn_enforced).toBe(false);
    expect(state.pick_order).toEqual(seats);
    expect(state.current_picker).toBe('A');
  });

  it('snake order with fixed costs tracks budgets and enforces turns', () => {
    const pool = makePool({ draft_type: 'budget', pick_order: 'snake', point_budget: 50 });
    const state = computeDraftState(pool, [makePick('A', 'Pikachu', 1, { points_spent: 20 })], seats, 3);
    expect(state.budgets).toEqual({ A: 30, B: 50, C: 50 });
    expect(state.current_picker).toBe('B');
    expect(validatePick(state, { draft_pool_id: 'pool-1', player_id: 'C', pokemon_name: 'Eevee' }, state.turn_enforced)?.code).toBe(
      'NOT_YOUR_TURN',
    );
  });

  it('the draft is over after players × rounds picks in every order', () => {
    for (const order of ['snake', 'linear'] as const) {
      expect(computeDraftState(makePool({ pick_order: order }), picksInOrder(order, 6), seats, 2).current_picker).toBeNull();
    }
  });
});

describe('rosterCompletionShortfall', () => {
  it('allows a pick that leaves enough for the cheapest remaining Pokémon', () => {
    // 100 points, this pick 60, 2 more picks, cheapest left 10 + 20 = 30 <= 40.
    expect(rosterCompletionShortfall({ remaining: 100, price: 60, slotsAfter: 2, otherPricesSorted: [10, 20, 50], fallbackPrice: 0 })).toBeNull();
  });

  it('refuses a pick that would stall the picker on a later turn', () => {
    // 100 points, this pick 80, 2 more picks need at least 10 + 20 = 30 > 20.
    expect(rosterCompletionShortfall({ remaining: 100, price: 80, slotsAfter: 2, otherPricesSorted: [10, 20, 50], fallbackPrice: 0 })).toEqual({
      slots: 2,
      min_cost: 30,
      remaining_after: 20,
    });
  });

  it('the last pick of a roster is never refused here (no slots after it)', () => {
    expect(rosterCompletionShortfall({ remaining: 10, price: 10, slotsAfter: 0, otherPricesSorted: [50], fallbackPrice: 0 })).toBeNull();
  });

  it('without a pool list, every remaining slot costs the default price', () => {
    expect(rosterCompletionShortfall({ remaining: 30, price: 10, slotsAfter: 3, otherPricesSorted: null, fallbackPrice: 7 })).toEqual({
      slots: 3,
      min_cost: 21,
      remaining_after: 20,
    });
    expect(rosterCompletionShortfall({ remaining: 31, price: 10, slotsAfter: 3, otherPricesSorted: null, fallbackPrice: 7 })).toBeNull();
  });

  it('counts only the Pokémon that are left when fewer remain than open slots', () => {
    expect(rosterCompletionShortfall({ remaining: 50, price: 10, slotsAfter: 3, otherPricesSorted: [5], fallbackPrice: 0 })).toBeNull();
  });
});

// ── legacySeatOrder ──────────────────────────────────────────────────

describe('legacySeatOrder', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `player-${i}`);

  it('does not depend on the order the participants were read in', () => {
    const order = legacySeatOrder('pool-1', ids);
    expect(legacySeatOrder('pool-1', [...ids].reverse())).toEqual(order);
    expect(legacySeatOrder('pool-1', [ids[3], ids[0], ...ids.slice(4), ids[2], ids[1]])).toEqual(order);
  });

  it('keeps every participant exactly once', () => {
    expect([...legacySeatOrder('pool-1', ids)].sort()).toEqual(ids);
  });

  it('draws again for another pool (no player sits first in every league)', () => {
    const firsts = new Set(Array.from({ length: 20 }, (_, i) => legacySeatOrder(`pool-${i}`, ids)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('a newcomer does not reorder the seats of the others', () => {
    const before = legacySeatOrder('pool-1', ids);
    const after = legacySeatOrder('pool-1', [...ids, 'player-new']).filter((id) => id !== 'player-new');
    expect(after).toEqual(before);
  });
});

// ── availablePricesSorted / legacyPickerStall ────────────────────────

describe('availablePricesSorted', () => {
  const entries = [
    { pokemon_name: 'Mewtwo', point_cost: 90 },
    { pokemon_name: 'Pikachu', point_cost: 20 },
    { pokemon_name: 'Ditto', point_cost: null },
  ];

  it('drops taken Pokémon (case-insensitive) and the excluded entry, prices missing costs at the fallback', () => {
    expect(availablePricesSorted(entries, ['PIKACHU'], 5)).toEqual([5, 90]);
    expect(availablePricesSorted(entries, [], 5, entries[0])).toEqual([5, 20]);
  });

  it('null without a pool list', () => {
    expect(availablePricesSorted([], [], 5)).toBeNull();
  });
});

describe('legacyPickerStall', () => {
  /** Snake order, fixed prices, 3 rounds; A picks first. */
  const stateOf = (overrides: { budgets?: Record<string, number> | null; rosters?: Record<string, string[]> } = {}) =>
    ({
      pool: makePool({ draft_type: 'budget', pick_order: 'snake', point_budget: 100 }),
      current_picker: 'A',
      turn_enforced: true,
      budgets: overrides.budgets === undefined ? { A: 40, B: 100 } : overrides.budgets,
      rosters: overrides.rosters ?? { A: ['Mew'], B: [] },
    }) as const;

  it('reports a picker whose open picks cost more than their points at the cheapest prices left', () => {
    // A has 2 open picks and 40 points; the cheapest two left cost 25 + 30.
    expect(
      legacyPickerStall({ state: stateOf(), totalRounds: 3, availablePrices: [25, 30, 80], fallbackPrice: 0 }),
    ).toEqual({ player_id: 'A', remaining: 40, open_slots: 2, min_cost: 55 });
  });

  it('is null while the cheapest completion still fits (exactly the budget is fine)', () => {
    expect(
      legacyPickerStall({ state: stateOf(), totalRounds: 3, availablePrices: [10, 30, 80], fallbackPrice: 0 }),
    ).toBeNull();
  });

  it('without a pool list prices every open pick at the fallback', () => {
    expect(
      legacyPickerStall({ state: stateOf(), totalRounds: 3, availablePrices: null, fallbackPrice: 25 }),
    ).toEqual({ player_id: 'A', remaining: 40, open_slots: 2, min_cost: 50 });
  });

  it('counts only the Pokémon that still exist when fewer are left than open picks; none left is not a budget stall', () => {
    expect(
      legacyPickerStall({ state: stateOf(), totalRounds: 3, availablePrices: [50], fallbackPrice: 0 }),
    ).toEqual({ player_id: 'A', remaining: 40, open_slots: 2, min_cost: 50 });
    expect(legacyPickerStall({ state: stateOf(), totalRounds: 3, availablePrices: [], fallbackPrice: 0 })).toBeNull();
  });

  it('a wildcard outside the pool list unsticks the picker when its price plus the cheapest rest fits', () => {
    // 2 open picks, 40 points, pool [25, 30, 80]: 55 > 40 from the pool alone.
    const base = { state: stateOf(), totalRounds: 3, availablePrices: [25, 30, 80], fallbackPrice: 10 };
    // Wildcard at 10 + cheapest one more (25) = 35 <= 40: a pick passes the picks route.
    expect(legacyPickerStall({ ...base, wildcardPrice: 10 })).toBeNull();
    // Wildcard at 20 + 25 = 45 > 40: still stuck, and the report keeps the pool-list numbers.
    expect(legacyPickerStall({ ...base, wildcardPrice: 20 })).toEqual({
      player_id: 'A',
      remaining: 40,
      open_slots: 2,
      min_cost: 55,
    });
    // No wildcard held: stuck.
    expect(legacyPickerStall({ ...base, wildcardPrice: null })).not.toBeNull();
  });

  it('is null in free order, without prices, for a full roster, or once the draft is not running', () => {
    const prices = { totalRounds: 3, availablePrices: [90], fallbackPrice: 0 };
    expect(legacyPickerStall({ ...prices, state: { ...stateOf(), turn_enforced: false } })).toBeNull();
    expect(legacyPickerStall({ ...prices, state: stateOf({ budgets: null }) })).toBeNull();
    expect(legacyPickerStall({ ...prices, state: stateOf({ rosters: { A: ['a', 'b', 'c'] } }) })).toBeNull();
    expect(
      legacyPickerStall({ ...prices, state: { ...stateOf(), pool: { ...stateOf().pool, status: 'complete' } } }),
    ).toBeNull();
    expect(
      legacyPickerStall({ ...prices, state: { ...stateOf(), pool: { ...stateOf().pool, draft_type: 'snake' } } }),
    ).toBeNull();
    expect(legacyPickerStall({ ...prices, state: { ...stateOf(), current_picker: null } })).toBeNull();
  });
});
