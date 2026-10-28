import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisiblePoller } from '@/lib/draft/use-visible-poll';
import { TURN_WATCH_INTERVAL_MS } from '@/lib/draft-ui/constants';
import type { MyTurnDTO } from '@/lib/draft-ui/snapshot-types';
import { createHttpDataSource, type MyTurnResult } from '@/components/draft-tool/data-source';
import { createTurnWatchTick } from '../hooks/use-turn-watch';

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

  it('raises no browser notification itself: alerts are Web Push messages sent by the server', async () => {
    const NotificationSpy = vi.fn();
    vi.stubGlobal('Notification', Object.assign(NotificationSpy, { permission: 'granted' }));
    try {
      const fetchMyTurn = vi.fn(async (): Promise<MyTurnResult> => ({ kind: 'ok', dto: myTurn() }));
      const poller = createVisiblePoller(
        createTurnWatchTick({ fetchMyTurn, isVisible: () => false }),
        { liveIntervalMs: TURN_WATCH_INTERVAL_MS, completeIntervalMs: null },
        { visibility: null },
      );
      poller.start();
      await vi.advanceTimersByTimeAsync(TURN_WATCH_INTERVAL_MS * 2);
      // The request itself (it lets the server resolve a due timeout) still happens every minute ...
      expect(fetchMyTurn).toHaveBeenCalledTimes(3);
      // ... but nothing is shown locally.
      expect(NotificationSpy).not.toHaveBeenCalled();
      poller.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


