/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePollLoop } from '../poll-loop';

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('usePollLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls at once, then at the base interval', async () => {
    const tick = vi.fn(async () => ({ ok: true }));
    renderHook(() => usePollLoop('a', 5000, tick));
    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(tick).toHaveBeenCalledTimes(2);
    await advance(5000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('waits out Retry-After and backs off while the server answers 429, then recovers', async () => {
    let limited = true;
    const tick = vi.fn(async () => (limited ? { ok: false, retryAfterMs: 10_000 } : { ok: true }));
    renderHook(() => usePollLoop('a', 1000, tick));

    await advance(0);
    expect(tick).toHaveBeenCalledTimes(1);
    // Base is 1 s, so without the fix this window would hold ~30 calls.
    await advance(29_999);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(3);

    limited = false;
    const before = tick.mock.calls.length;
    await advance(30_000);
    expect(tick.mock.calls.length).toBeGreaterThan(before);
    const settled = tick.mock.calls.length;
    await advance(1000);
    await advance(1000);
    expect(tick.mock.calls.length).toBe(settled + 2);
  });

  it('treats a throwing tick as a failure and backs off', async () => {
    const tick = vi.fn(async () => {
      throw new Error('network');
    });
    renderHook(() => usePollLoop('a', 2000, tick));
    await advance(0);
    await advance(4000);
    await advance(8000);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it('stops on unmount and when disabled', async () => {
    const tick = vi.fn(async () => ({ ok: true }));
    const { unmount, rerender } = renderHook(({ enabled }) => usePollLoop('a', 1000, tick, enabled), {
      initialProps: { enabled: true },
    });
    await advance(0);
    rerender({ enabled: false });
    const calls = tick.mock.calls.length;
    await advance(5000);
    expect(tick).toHaveBeenCalledTimes(calls);
    rerender({ enabled: true });
    await advance(0);
    unmount();
    const afterUnmount = tick.mock.calls.length;
    await advance(5000);
    expect(tick).toHaveBeenCalledTimes(afterUnmount);
  });

  it('restarts for a new key and uses the latest tick closure', async () => {
    const first = vi.fn(async () => ({ ok: true }));
    const second = vi.fn(async () => ({ ok: true }));
    const { rerender } = renderHook(({ key, tick }) => usePollLoop(key, 1000, tick), {
      initialProps: { key: 'a', tick: first },
    });
    await advance(0);
    rerender({ key: 'a', tick: second });
    await advance(1000);
    expect(second).toHaveBeenCalledTimes(1);
    rerender({ key: 'b', tick: second });
    await advance(0);
    expect(second).toHaveBeenCalledTimes(2);
  });
});
