import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLETE_POLL_INTERVAL_MS,
  LIVE_POLL_INTERVAL_MS,
  createVisiblePoller,
  outcomeForPoolStatus,
  type PollOutcome,
  type VisibilitySource,
} from '../use-visible-poll';

/** Minimal stand-in for `document` visibility (the test env is node). */
class FakeVisibility implements VisibilitySource {
  hidden = false;
  private listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener);
  }

  get listenerCount() {
    return this.listeners.size;
  }

  set(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of this.listeners) listener();
  }
}

function makeTick(outcomes: PollOutcome[] = []) {
  let call = 0;
  return vi.fn(async (_signal: AbortSignal): Promise<PollOutcome> => {
    const outcome = outcomes[Math.min(call, outcomes.length - 1)] ?? 'live';
    call += 1;
    return outcome;
  });
}

/** Let the in-flight tick's promise chain settle without moving the clock. */
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

let visibility: FakeVisibility;

beforeEach(() => {
  vi.useFakeTimers();
  visibility = new FakeVisibility();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createVisiblePoller: live cadence', () => {
  it('fetches immediately on start, then every 3 s while visible', async () => {
    const tick = makeTick(['live']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('never overlaps a slow request: the next wait starts when the tick lands', async () => {
    let resolveSlow: (outcome: PollOutcome) => void = () => {};
    const tick = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<PollOutcome>((resolve) => {
          resolveSlow = resolve;
        }),
    );
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(1);

    resolveSlow('live');
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('keeps polling after a tick throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tick = vi
      .fn(async (_signal: AbortSignal): Promise<PollOutcome> => 'live')
      .mockRejectedValueOnce(new Error('network down'));
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('[use-visible-poll] tick threw:', expect.any(Error));

    poller.stop();
    errorSpy.mockRestore();
  });
});

describe('createVisiblePoller: hidden tab', () => {
  it('pauses while document.hidden and refetches once on visibilitychange', async () => {
    const tick = makeTick(['live']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);

    visibility.set(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(tick).toHaveBeenCalledTimes(1);

    visibility.set(false);
    await flush();
    expect(tick).toHaveBeenCalledTimes(2);

    // The cadence resumes from the refetch.
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('skips a timer that fires while hidden, before the event is delivered', async () => {
    const tick = makeTick(['live']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    visibility.hidden = true; // no event yet
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS * 5);
    expect(tick).toHaveBeenCalledTimes(1);

    visibility.set(false);
    await flush();
    expect(tick).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('does not schedule the next tick when the tab hid during a request', async () => {
    let resolveTick: (outcome: PollOutcome) => void = () => {};
    const tick = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<PollOutcome>((resolve) => {
          resolveTick = resolve;
        }),
    );
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    visibility.set(true);
    resolveTick('live');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);

    poller.stop();
  });
});

describe('createVisiblePoller: completed draft', () => {
  it('stops scheduled polling when complete and completeIntervalMs is null', async () => {
    const tick = makeTick(['complete']);
    const poller = createVisiblePoller(tick, { completeIntervalMs: null }, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(tick).toHaveBeenCalledTimes(1);

    // A refocus still refetches once, and stays stopped while complete.
    visibility.set(true);
    visibility.set(false);
    await flush();
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(tick).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('slows to 60 s by default once complete', async () => {
    const tick = makeTick(['live', 'complete']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(2); // this read reports 'complete'

    await vi.advanceTimersByTimeAsync(COMPLETE_POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('never polls a complete draft faster than 60 s', async () => {
    const tick = makeTick(['complete']);
    const poller = createVisiblePoller(tick, { completeIntervalMs: 5_000 }, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(COMPLETE_POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('returns to the live cadence if a later read is live again', async () => {
    const tick = makeTick(['complete', 'live']);
    const poller = createVisiblePoller(tick, { completeIntervalMs: null }, { visibility });

    poller.start();
    await flush();
    await poller.refresh(); // e.g. an admin reopened the draft
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });
});

describe('createVisiblePoller: stop, refresh and teardown', () => {
  it("halts on 'stop' (auth blocked) and ignores refocus", async () => {
    const tick = makeTick(['stop']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    visibility.set(true);
    visibility.set(false);
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it('refresh() fetches now and restarts the wait from that read', async () => {
    const tick = makeTick(['live']);
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    await poller.refresh();
    expect(tick).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS - 1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('refresh() during a request runs one more read after it lands', async () => {
    const resolvers: ((outcome: PollOutcome) => void)[] = [];
    const tick = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<PollOutcome>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    let refreshed = false;
    const pending = poller.refresh().then(() => {
      refreshed = true;
    });
    expect(tick).toHaveBeenCalledTimes(1);

    resolvers[0]('live');
    await flush();
    expect(tick).toHaveBeenCalledTimes(2);
    expect(refreshed).toBe(false);

    resolvers[1]('live');
    await pending;
    expect(refreshed).toBe(true);

    poller.stop();
  });

  it('stop() cancels the timer, removes the listener and aborts the signal', async () => {
    const signals: AbortSignal[] = [];
    const tick = vi.fn(async (signal: AbortSignal): Promise<PollOutcome> => {
      signals.push(signal);
      return 'live';
    });
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    await flush();
    expect(visibility.listenerCount).toBe(1);

    poller.stop();
    expect(visibility.listenerCount).toBe(0);
    expect(signals[0].aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    visibility.set(false);
    await flush();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('a restarted poller is not blocked by a request from the previous run', async () => {
    const resolvers: ((outcome: PollOutcome) => void)[] = [];
    const tick = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<PollOutcome>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const poller = createVisiblePoller(tick, {}, { visibility });

    poller.start();
    poller.stop();
    poller.start();
    expect(tick).toHaveBeenCalledTimes(2);

    resolvers[0]('live'); // the aborted run lands late: no effect
    resolvers[1]('live');
    await flush();
    await vi.advanceTimersByTimeAsync(LIVE_POLL_INTERVAL_MS);
    expect(tick).toHaveBeenCalledTimes(3);

    poller.stop();
  });
});

describe('outcomeForPoolStatus', () => {
  it('maps complete to complete and everything else to live', () => {
    expect(outcomeForPoolStatus('complete')).toBe('complete');
    expect(outcomeForPoolStatus('in_progress')).toBe('live');
    expect(outcomeForPoolStatus('pending')).toBe('live');
  });
});
