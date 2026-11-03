/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBroadcastPoll } from '../polling';

describe('useBroadcastPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not stay in the loading state when polling is disabled during the first request', async () => {
    let release: (res: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            release = resolve;
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );
    const { result, rerender } = renderHook(({ enabled }) => useBroadcastPoll<{ n: number }>('/x', 1000, { enabled }), {
      initialProps: { enabled: true },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(true);

    rerender({ enabled: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    release(new Response('{}'));
  });

  it('drops the answer of a superseded request instead of showing it', async () => {
    const pending: Array<(res: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
    );
    const { result, rerender } = renderHook(({ url }) => useBroadcastPoll<{ id: string }>(url, 1000), {
      initialProps: { url: '/a' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({ url: '/b' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      pending[0](Response.json({ id: 'a' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toBeNull();
    await act(async () => {
      pending[1](Response.json({ id: 'b' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual({ id: 'b' });
  });
});
