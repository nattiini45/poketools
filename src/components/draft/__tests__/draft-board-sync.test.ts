import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectEvolutionEvents,
  draftBoardStateUrl,
  makeDraftBoardTick,
  pickerOf,
  pollDraftBoard,
  shouldOfferTokenAllocator,
  type DraftBoardSink,
  type DraftBoardState,
  type FetchLike,
  type TrackersByPlayer,
} from '../draft-board-sync';
import {
  COMPLETE_POLL_INTERVAL_MS,
  LIVE_POLL_INTERVAL_MS,
  createVisiblePoller,
} from '@/lib/draft/use-visible-poll';
import type { EvolutionEvent, EvolutionTrackerWithTier } from '@/types/evolution';

// ─── Fixtures ──────────────────────────────────────────────────────

function tracker(
  playerId: string,
  base: string,
  form: string,
  stage = 1,
  totalKos = 0,
): EvolutionTrackerWithTier {
  return {
    id: `t-${playerId}-${base}`,
    season_id: 's1',
    player_id: playerId,
    base_pokemon: base,
    current_form: form,
    total_kos: totalKos,
    current_stage: stage,
    evolved_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    real_kills: totalKos,
    draft_tokens: 0,
    kill_tokens: 0,
    cosmo_points: 0,
    suspended_until_matchday: null,
    evolution_points_awarded: 0,
    locked_stage3_pokemon: null,
    line_id: null,
    transferred_evo_progress: 0,
    redraft_slot_id: null,
    tier: {
      id: `tier-${base}`,
      season_id: 's1',
      player_id: null,
      base_pokemon: base,
      stage2_pokemon: `${base}-2`,
      stage2_kos: 3,
      stage3_pokemon: null,
      stage3_kos: null,
      power_tier: 'B',
      created_at: '2026-01-01',
    },
  };
}

function stateWith(
  trackers: TrackersByPlayer | null,
  status: DraftBoardState['pool']['status'] = 'in_progress',
): DraftBoardState {
  return {
    pool: {
      id: 'pool-1',
      season_id: 's1',
      draft_type: 'snake',
      pick_order: 'snake',
      point_budget: 180,
      status,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    picks: [],
    rosters: { p1: ['Eevee'], p2: ['Gastly'] },
    budgets: { p1: 120, p2: 140 },
    pick_order: ['p1', 'p2'],
    current_picker: 'p1',
    turn_enforced: true,
    next_pick_number: 3,
    current_round: 2,
    taken_pokemon: ['Eevee', 'Gastly'],
    ...(trackers ? { evolution: { is_evo_league: true, trackers_by_player: trackers } } : {}),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch that answers each call with the next queued payload. */
function queuedFetch(...payloads: { body: unknown; status?: number }[]) {
  let call = 0;
  return vi.fn<FetchLike>(async () => {
    const next = payloads[Math.min(call, payloads.length - 1)];
    call += 1;
    return jsonResponse(next.body, next.status ?? 200);
  });
}

const ok = (state: DraftBoardState) => ({ body: { success: true, data: state } });

// ─── One request per tick ──────────────────────────────────────────

describe('pollDraftBoard: one HTTP request per tick', () => {
  it('an EPB board asks /state for trackers and makes no other request', async () => {
    const fetchImpl = queuedFetch(ok(stateWith({ p1: [tracker('p1', 'Eevee', 'Eevee')] })));

    const result = await pollDraftBoard({
      fetchImpl,
      poolId: 'pool-1',
      withTrackers: true,
      previousTrackers: {},
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/drafts/pool-1/state?include=trackers');
    expect(result.kind).toBe('state');
  });

  it('a non-EPB board asks for the plain state', async () => {
    const fetchImpl = queuedFetch(ok(stateWith(null)));

    await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: false, previousTrackers: {} });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/drafts/pool-1/state');
    expect(draftBoardStateUrl('pool-1', true)).toBe('/api/drafts/pool-1/state?include=trackers');
  });
});

// ─── Poll results → outcome ────────────────────────────────────────

describe('pollDraftBoard: outcomes', () => {
  it('a complete pool reports complete (poller slows to 60 s)', async () => {
    const fetchImpl = queuedFetch(ok(stateWith(null, 'complete')));
    const result = await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: false, previousTrackers: {} });
    expect(result).toMatchObject({ kind: 'state', outcome: 'complete' });
  });

  it('401/403 surface the server error and stop polling', async () => {
    const fetchImpl = queuedFetch({ body: { success: false, error: 'Not authenticated' }, status: 401 });
    const result = await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: false, previousTrackers: {} });
    expect(result).toEqual({ kind: 'error', error: 'Not authenticated', outcome: 'stop' });
  });

  it('a server error keeps the cadence and keeps its message', async () => {
    const fetchImpl = queuedFetch({ body: { success: false, error: 'Draft pool not found' }, status: 404 });
    const result = await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: false, previousTrackers: {} });
    expect(result).toEqual({ kind: 'error', error: 'Draft pool not found', outcome: 'live' });
  });

  it('a network failure is logged and reported', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: false, previousTrackers: {} });
    expect(result).toEqual({ kind: 'error', error: 'Failed to load draft state', outcome: 'live' });
    expect(errorSpy).toHaveBeenCalledWith('[DraftBoard] fetch state failed:', expect.any(TypeError));
    errorSpy.mockRestore();
  });

  it('an aborted request (unmount) is not reported as an error', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const result = await pollDraftBoard({
      fetchImpl,
      poolId: 'pool-1',
      withTrackers: false,
      previousTrackers: {},
      signal: controller.signal,
    });
    expect(result).toEqual({ kind: 'aborted' });
  });

  it('a season without evolution tiers yields no evolution update', async () => {
    const state = { ...stateWith(null), evolution: { is_evo_league: false, trackers_by_player: {} } };
    const fetchImpl = queuedFetch(ok(state));
    const result = await pollDraftBoard({ fetchImpl, poolId: 'pool-1', withTrackers: true, previousTrackers: {} });
    expect(result).toMatchObject({ kind: 'state', evolution: null });
  });
});

// ─── Evolution events ──────────────────────────────────────────────

describe('detectEvolutionEvents', () => {
  it('reports evolutions and de-evolutions, not unchanged or new lines', () => {
    const previous: TrackersByPlayer = {
      p1: [tracker('p1', 'Eevee', 'Eevee'), tracker('p1', 'Dratini', 'Dragonair', 2, 4)],
      p2: [tracker('p2', 'Gastly', 'Gastly')],
    };
    const next: TrackersByPlayer = {
      p1: [
        tracker('p1', 'Eevee', 'Vaporeon', 2, 3),
        tracker('p1', 'Dratini', 'Dratini', 1, 2),
        tracker('p1', 'Larvitar', 'Larvitar'),
      ],
      p2: [tracker('p2', 'Gastly', 'Gastly')],
    };

    expect(detectEvolutionEvents(previous, next)).toEqual<EvolutionEvent[]>([
      {
        player_id: 'p1',
        base_pokemon: 'Eevee',
        previous_form: 'Eevee',
        new_form: 'Vaporeon',
        new_stage: 2,
        total_kos: 3,
        is_devolution: false,
      },
      {
        player_id: 'p1',
        base_pokemon: 'Dratini',
        previous_form: 'Dragonair',
        new_form: 'Dratini',
        new_stage: 1,
        total_kos: 2,
        is_devolution: true,
      },
    ]);
  });

  it('the first poll has nothing to compare against', () => {
    expect(detectEvolutionEvents({}, { p1: [tracker('p1', 'Eevee', 'Vaporeon', 2)] })).toEqual([]);
  });
});

// ─── The DraftBoard tick under the real poller ─────────────────────

describe('makeDraftBoardTick under the visible poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeSink() {
    return {
      onState: vi.fn<DraftBoardSink['onState']>(),
      onError: vi.fn<DraftBoardSink['onError']>(),
      onEvolution: vi.fn<DraftBoardSink['onEvolution']>(),
    };
  }

  it('fires an evolution event when a tracker changes between two polls, 1 request per tick', async () => {
    const before = { p1: [tracker('p1', 'Eevee', 'Eevee')], p2: [tracker('p2', 'Gastly', 'Gastly')] };
    const after = {
      p1: [tracker('p1', 'Eevee', 'Vaporeon', 2, 3)],
      p2: [tracker('p2', 'Gastly', 'Gastly')],
    };
    const fetchImpl = queuedFetch(ok(stateWith(before)), ok(stateWith(after)), ok(stateWith(after)));
    const trackersRef = { current: {} as TrackersByPlayer };
    const sink = makeSink();
    const poller = createVisiblePoller(
      makeDraftBoardTick({ fetchImpl, poolId: 'pool-1', withTrackers: true, trackersRef, sink }),
      {},
      { visibility: null },
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sink.onEvolution).toHaveBeenLastCalledWith(before, []);

    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sink.onEvolution).toHaveBeenLastCalledWith(after, [
      {
        player_id: 'p1',
        base_pokemon: 'Eevee',
        previous_form: 'Eevee',
        new_form: 'Vaporeon',
        new_stage: 2,
        total_kos: 3,
        is_devolution: false,
      },
    ]);
    expect(trackersRef.current).toEqual(after);

    // A third identical poll diffs against the second: no repeat event.
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sink.onEvolution).toHaveBeenLastCalledWith(after, []);
    expect(sink.onState).toHaveBeenCalledTimes(3);
    expect(sink.onError).not.toHaveBeenCalled();

    poller.stop();
  });

  it('keeps the previous trackers across a failed poll', async () => {
    const before = { p1: [tracker('p1', 'Eevee', 'Eevee')] };
    const after = { p1: [tracker('p1', 'Eevee', 'Jolteon', 2, 3)] };
    const fetchImpl = queuedFetch(
      ok(stateWith(before)),
      { body: { success: false, error: 'Failed to compute draft state' }, status: 500 },
      ok(stateWith(after)),
    );
    const trackersRef = { current: {} as TrackersByPlayer };
    const sink = makeSink();
    const poller = createVisiblePoller(
      makeDraftBoardTick({ fetchImpl, poolId: 'pool-1', withTrackers: true, trackersRef, sink }),
      {},
      { visibility: null },
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(sink.onError).toHaveBeenCalledWith('Failed to compute draft state');
    expect(trackersRef.current).toEqual(before);

    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(sink.onEvolution).toHaveBeenLastCalledWith(after, [
      expect.objectContaining({ previous_form: 'Eevee', new_form: 'Jolteon' }),
    ]);

    poller.stop();
  });
});

// ─── Draft-token allocation (EPB, complete pool) ───────────────────

/** A complete EPB pool as the viewer p1 sees it. */
function completeEpbState({
  allocated,
  remaining,
  purchasable,
}: {
  allocated: boolean;
  remaining: number;
  purchasable: number;
}): DraftBoardState {
  return {
    ...stateWith(null, 'complete'),
    current_picker: null,
    budgets: { p1: remaining, p2: 140 },
    epb: {
      draft_budget: 180,
      draft_picks: 9,
      token_ratio: 3,
      token_max: 2,
      picks_by_player: { p1: 9, p2: 9 },
      purchasable_tokens_by_player: { p1: purchasable, p2: 2 },
      tokens_allocated_by_player: { p1: allocated, p2: false },
    },
  };
}

describe('shouldOfferTokenAllocator', () => {
  const open = completeEpbState({ allocated: false, remaining: 7, purchasable: 2 });
  const base = { state: open, viewerId: 'p1', seasonId: 's1', isEpb: true };

  it('offers the allocator on a complete EPB pool with purchasable tokens', () => {
    expect(shouldOfferTokenAllocator(base)).toBe(true);
  });

  it('hides it when the server says the viewer allocated, or has nothing to buy', () => {
    const allocated = completeEpbState({ allocated: true, remaining: 1, purchasable: 0 });
    const nothingToBuy = completeEpbState({ allocated: false, remaining: 2, purchasable: 0 });
    expect(shouldOfferTokenAllocator({ ...base, state: allocated })).toBe(false);
    expect(shouldOfferTokenAllocator({ ...base, state: nothingToBuy })).toBe(false);
  });

  it('hides it on a live pool, a non-EPB board, or without a season', () => {
    const live = { ...open, pool: { ...open.pool, status: 'in_progress' as const } };
    expect(shouldOfferTokenAllocator({ ...base, state: live })).toBe(false);
    expect(shouldOfferTokenAllocator({ ...base, isEpb: false })).toBe(false);
    expect(shouldOfferTokenAllocator({ ...base, seasonId: undefined })).toBe(false);
  });
});

describe('draft-token allocation under the visible poller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a confirmed allocation refreshes a complete board at once, not on the 60 s tick', async () => {
    const before = completeEpbState({ allocated: false, remaining: 7, purchasable: 2 });
    const after = completeEpbState({ allocated: true, remaining: 1, purchasable: 0 });
    const fetchImpl = queuedFetch(ok(before), ok(after));
    const sink = {
      onState: vi.fn<DraftBoardSink['onState']>(),
      onError: vi.fn<DraftBoardSink['onError']>(),
      onEvolution: vi.fn<DraftBoardSink['onEvolution']>(),
    };
    const poller = createVisiblePoller(
      makeDraftBoardTick({
        fetchImpl,
        poolId: 'pool-1',
        withTrackers: false,
        trackersRef: { current: {} },
        sink,
      }),
      {},
      { visibility: null },
    );
    const offer = (state: DraftBoardState) =>
      shouldOfferTokenAllocator({ state, viewerId: 'p1', seasonId: 's1', isEpb: true });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(offer(sink.onState.mock.lastCall![0])).toBe(true);

    // After an allocation (token centre) the board refreshes now.
    await poller.refresh();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const refreshed = sink.onState.mock.lastCall![0];
    expect(refreshed.budgets?.p1).toBe(1);
    expect(refreshed.epb?.purchasable_tokens_by_player.p1).toBe(0);
    expect(offer(refreshed)).toBe(false);

    // The complete cadence restarts from the refresh.
    await vi.advanceTimersByTimeAsync(COMPLETE_POLL_INTERVAL_MS - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    poller.stop();
  });
});

describe('pickerOf (whose pick the board makes)', () => {
  const rosters = { p1: [], p2: [], p3: [] };
  const viewer = (over: Partial<{ currentPlayerId: string; isAdmin: boolean; pickFor: string | null }> = {}) => ({
    currentPlayerId: 'p3',
    isAdmin: false,
    pickFor: null,
    ...over,
  });

  it('snake and linear order: always the player whose turn it is (an admin picks for them)', () => {
    const state = { turn_enforced: true, current_picker: 'p2', rosters };
    expect(pickerOf(state, viewer())).toBe('p2');
    expect(pickerOf(state, viewer({ isAdmin: true, pickFor: 'p1' }))).toBe('p2');
  });

  it('free order: a participant picks for themselves, an admin for the chosen player', () => {
    const state = { turn_enforced: false, current_picker: 'p1', rosters };
    expect(pickerOf(state, viewer())).toBe('p3');
    // An admin who plays picks for themselves until they choose someone else.
    expect(pickerOf(state, viewer({ isAdmin: true }))).toBe('p3');
    expect(pickerOf(state, viewer({ isAdmin: true, pickFor: 'p2' }))).toBe('p2');
    // An admin who does not play starts at the suggestion; a stale choice falls back the same way.
    expect(pickerOf(state, viewer({ currentPlayerId: 'admin', isAdmin: true }))).toBe('p1');
    expect(pickerOf(state, viewer({ currentPlayerId: 'admin', isAdmin: true, pickFor: 'gone' }))).toBe('p1');
  });

  it('nobody once the draft is over', () => {
    expect(pickerOf({ turn_enforced: false, current_picker: null, rosters }, viewer({ isAdmin: true, pickFor: 'p2' }))).toBeNull();
  });
});
