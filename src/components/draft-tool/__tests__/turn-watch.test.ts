import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisiblePoller } from '@/lib/draft/use-visible-poll';
import { TURN_WATCH_INTERVAL_MS } from '@/lib/draft-ui/constants';
import type { MyTurnDTO } from '@/lib/draft-ui/snapshot-types';
import { createHttpDataSource, type MyTurnResult } from '@/components/draft-tool/data-source';
import { alertsFor, createTurnWatchTick, myTurnRemainingMs } from '../hooks/use-turn-watch';

function myTurn(overrides: Partial<MyTurnDTO> = {}): MyTurnDTO {
  return {
    state_version: 7,
    server_now: '2026-10-09T12:00:00.000Z',
    status: 'in_progress',
    mode: 'live',
    paused: false,
    on_clock: true,
    up_next: false,
    slot_id: 'slot-3',
    deadline_at: '2026-10-09T12:04:00.000Z',
    remaining_ms_at_pause: null,
    league_name: 'EvoLiga',
    quiet_hours: null,
    ...overrides,
  };
}

/** The watch exactly as `useTurnWatch` builds it, with an injectable visibility. */
function watch(visible: () => boolean, answer: MyTurnResult = { kind: 'ok', dto: myTurn() }) {
  const fetchMyTurn = vi.fn(async (signal: AbortSignal): Promise<MyTurnResult> => {
    void signal;
    return answer;
  });
  const onResult = vi.fn();
  const poller = createVisiblePoller(
    createTurnWatchTick({ fetchMyTurn, isVisible: visible, onResult }),
    { liveIntervalMs: TURN_WATCH_INTERVAL_MS, completeIntervalMs: null },
    { visibility: null },
  );
  return { poller, fetchMyTurn, onResult };
}

describe('turn watch (draft-frontend §5.8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('skips the request while the tab is visible (the 3 s snapshot poll covers it)', async () => {
    const { poller, fetchMyTurn } = watch(() => true);
    poller.start();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 3 + 10);
    expect(fetchMyTurn).not.toHaveBeenCalled();
    poller.stop();
  });

  it('fetches every 60 s while the tab is hidden, and only then', async () => {
    const { poller, fetchMyTurn, onResult } = watch(() => false);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS - 1);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMyTurn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS);
    expect(fetchMyTurn).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('keeps running across visibility changes: hidden ticks fetch, visible ticks do not', async () => {
    let visible = true;
    const { poller, fetchMyTurn } = watch(() => visible);
    poller.start();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS);
    expect(fetchMyTurn).not.toHaveBeenCalled();
    visible = false;
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('stops once the pool is complete', async () => {
    const { poller, fetchMyTurn } = watch(() => false, { kind: 'ok', dto: myTurn({ status: 'complete', on_clock: false, slot_id: null }) });
    poller.start();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 5);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('stops on a stop answer (401/403/404/409) instead of polling every 60 s forever', async () => {
    const { poller, fetchMyTurn, onResult } = watch(() => false, { kind: 'stop' });
    poller.start();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 10);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    poller.stop();
  });

  it('keeps ticking through transient errors (network, 5xx)', async () => {
    const { poller, fetchMyTurn } = watch(() => false, { kind: 'error' });
    poller.start();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 2);
    expect(fetchMyTurn).toHaveBeenCalledTimes(3);
    poller.stop();
  });

  it('end to end over HTTP: no fetch follows a 401/403/404/409, a 503 keeps the watch alive', async () => {
    const make = (status: number) =>
      new Response(JSON.stringify({ success: false, error: 'x' }), { status, headers: { 'Content-Type': 'application/json' } });
    for (const [status, expected] of [[403, 1], [401, 1], [404, 1], [409, 1], [503, 3]] as const) {
      const fetchSpy = vi.fn(async () => make(status));
      vi.stubGlobal('fetch', fetchSpy);
      try {
        const source = createHttpDataSource('pool-1');
        const poller = createVisiblePoller(
          createTurnWatchTick({ fetchMyTurn: (signal) => source.fetchMyTurn(signal), isVisible: () => false, onResult: vi.fn() }),
          { liveIntervalMs: TURN_WATCH_INTERVAL_MS, completeIntervalMs: null },
          { visibility: null },
        );
        poller.start();
        await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 2);
        expect(fetchSpy, `status ${status}`).toHaveBeenCalledTimes(expected);
        poller.stop();
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('stops fetching after stop()', async () => {
    const { poller, fetchMyTurn } = watch(() => false);
    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 3);
    expect(fetchMyTurn).toHaveBeenCalledTimes(1);
  });
});

describe('turn alerts', () => {
  it('computes the remaining time on the server clock, frozen while paused', () => {
    expect(myTurnRemainingMs(myTurn())).toBe(240_000);
    expect(myTurnRemainingMs(myTurn({ deadline_at: null, remaining_ms_at_pause: 83_000, paused: true }))).toBe(83_000);
    expect(myTurnRemainingMs(myTurn({ deadline_at: null }))).toBeNull();
  });

  it('alerts the turn once per slot and nothing while paused or off the clock', () => {
    const sent = new Set<string>();
    const already = (slot: string, kind: string) => sent.has(`${slot}:${kind}`);
    expect(alertsFor(myTurn(), 'pool-1', already)).toEqual(['turn']);
    sent.add('slot-3:turn');
    expect(alertsFor(myTurn(), 'pool-1', already)).toEqual([]);
    expect(alertsFor(myTurn({ slot_id: 'slot-9' }), 'pool-1', already)).toEqual(['turn']);
    expect(alertsFor(myTurn({ paused: true }), 'pool-1', () => false)).toEqual([]);
    expect(alertsFor(myTurn({ on_clock: false }), 'pool-1', () => false)).toEqual([]);
  });

  describe('quiet hours', () => {
    const quiet_hours = { startHour: 0, endHour: 6, timeZone: 'Europe/Berlin' };
    // 01:00 Berlin; deadline 06:15 Berlin = 15 running minutes left, although 5 h 15 min of wall time.
    const night = myTurn({
      mode: 'slow',
      server_now: '2026-10-17T23:00:00.000Z',
      deadline_at: '2026-10-18T04:15:00.000Z',
      quiet_hours,
    });

    it('counts running time only', () => {
      expect(myTurnRemainingMs(night)).toBe(900_000);
      expect(myTurnRemainingMs({ ...night, quiet_hours: null })).toBe(18_900_000);
    });

    it('sends no browser alert inside the window and the turn + most urgent reminder after it', () => {
      expect(alertsFor(night, 'pool-1', () => false)).toEqual([]);
      const morning = { ...night, server_now: '2026-10-18T04:01:00.000Z' };
      expect(alertsFor(morning, 'pool-1', () => false)).toEqual(['turn', 'remind-1h']);
    });

    it('a paused answer is never "held" (paused already sends nothing)', () => {
      expect(alertsFor({ ...night, paused: true, deadline_at: null, remaining_ms_at_pause: 1000 }, 'pool-1', () => false)).toEqual([]);
    });
  });

  it('adds the most urgent slow-draft reminder only', () => {
    const slow = myTurn({ mode: 'slow', deadline_at: '2026-10-09T12:50:00.000Z' });
    expect(alertsFor(slow, 'pool-1', () => false)).toEqual(['turn', 'remind-1h']);
  });
});
