/**
 * `useMinuteClock`: the request time on the server and during hydration, then
 * the wall clock, re-ticked every 60 s by one interval that every subscriber
 * (this hook, `<RelativeTime>`) shares and that stops with the last one.
 * `useSyncExternalStore` is stubbed to expose the store the hook subscribes to
 * (vitest 'node' env, no DOM).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Store = {
  subscribe: (cb: () => void) => () => void;
  getSnapshot: () => number;
};

const probe = vi.hoisted(() => ({ server: true, store: null as Store | null }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useSyncExternalStore: (
      subscribe: (cb: () => void) => () => void,
      getSnapshot: () => number,
      getServerSnapshot?: () => number,
    ): number => {
      probe.store = { subscribe, getSnapshot };
      return probe.server && getServerSnapshot ? getServerSnapshot() : getSnapshot();
    },
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { useMinuteClock } from '../LocalTime';
import { renderWithI18n } from '@/test/i18n';

const REQUEST_TIME = Date.UTC(2026, 9, 9, 12);
const START = Date.UTC(2026, 9, 9, 12, 30);

function Now() {
  return <>{useMinuteClock()}</>;
}

/** Renders the hook and returns the store it subscribed to. */
function storeOf(): Store {
  renderToStaticMarkup(<Now />);
  if (!probe.store) throw new Error('the hook did not read a store');
  return probe.store;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useMinuteClock', () => {
  it('is the provider request time on the server and during hydration', () => {
    probe.server = true;
    expect(renderWithI18n(<Now />, { requestTime: REQUEST_TIME })).toBe(String(REQUEST_TIME));
  });

  it('follows the wall clock on the client', () => {
    probe.server = false;
    expect(renderWithI18n(<Now />, { requestTime: REQUEST_TIME })).toBe(String(START));
  });

  it('ticks every 60 seconds and notifies its subscribers', () => {
    const store = storeOf();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    vi.advanceTimersByTime(59_999);
    expect(listener).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(START + 60_000);

    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBe(START + 120_000);

    unsubscribe();
  });

  it('shares one interval between subscribers and stops it with the last one', () => {
    const store = storeOf();
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = store.subscribe(first);
    const offSecond = store.subscribe(second);
    expect(vi.getTimerCount()).toBe(1);

    offFirst();
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    offSecond();
    expect(vi.getTimerCount()).toBe(0);
  });
});
