/** @vitest-environment jsdom */
/**
 * `useRuntimeAction`: the one place that keeps an error and reloads. A conflict reloads before `run` returns, other
 * failures do not, a second call while one is in flight is ignored, the error is the server's object (not text), and
 * a throwing request ends as a network error instead of leaving the buttons off.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ActionApiError } from '@/lib/format-engine/runtime/client-api';
import type { ApiOutcome } from '@/lib/studio-core/request';
import { useRuntimeAction } from '../useRuntimeAction';

const fail = (status: number, error: ActionApiError): ApiOutcome<string, ActionApiError> => ({ ok: false, status, error });

describe('useRuntimeAction', () => {
  it('returns a success without touching the error or the view', async () => {
    const reload = vi.fn(async () => {});
    const { result } = renderHook(() => useRuntimeAction(reload));
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run(async () => ({ ok: true as const, data: 'done' }));
    });
    expect(outcome).toEqual({ ok: true, data: 'done' });
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the server error object and reloads once on a conflict', async () => {
    const reload = vi.fn(async () => {});
    const { result } = renderHook(() => useRuntimeAction(reload));
    await act(async () => {
      await result.current.run(async () => fail(409, { code: 'action_locked' }));
    });
    expect(result.current.error).toEqual({ code: 'action_locked' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [422, { code: 'format_action_invalid', issues: [{ code: 'wrong_count' as const, step: 0 }] }],
    [403, { code: 'format_not_participant' }],
    [429, { code: 'rate_limited' }],
    [0, { code: 'network_error' }],
  ])('does not reload on a %s answer', async (status, error) => {
    const reload = vi.fn(async () => {});
    const { result } = renderHook(() => useRuntimeAction(reload));
    await act(async () => {
      await result.current.run(async () => fail(status, error));
    });
    expect(result.current.error).toEqual(error);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores a second call while one is in flight, and clears the error when the next one starts', async () => {
    const reload = vi.fn(async () => {});
    const { result } = renderHook(() => useRuntimeAction(reload));
    await act(async () => {
      await result.current.run(async () => fail(400, { code: 'validation_failed' }));
    });
    expect(result.current.error).not.toBeNull();

    let release: (value: ApiOutcome<string, ActionApiError>) => void = () => {};
    const slow = vi.fn(() => new Promise<ApiOutcome<string, ActionApiError>>((resolve) => (release = resolve)));
    const second = vi.fn(async () => ({ ok: true as const, data: 'second' }));
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.run(slow);
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    expect(result.current.error).toBeNull();

    let skipped: unknown;
    await act(async () => {
      skipped = await result.current.run(second);
    });
    expect(skipped).toBeNull();
    expect(second).not.toHaveBeenCalled();

    await act(async () => {
      release({ ok: true, data: 'first' });
      await first;
    });
    expect(result.current.pending).toBe(false);
  });

  it('turns a throwing request into a network error and frees the hook', async () => {
    const { result } = renderHook(() => useRuntimeAction(async () => {}));
    let outcome: ApiOutcome<string, ActionApiError> | null = null;
    await act(async () => {
      outcome = await result.current.run<string, ActionApiError>(async () => {
        throw new TypeError('Failed to fetch');
      });
    });
    expect(outcome).toEqual({ ok: false, status: 0, error: { code: 'network_error' } });
    expect(result.current.error).toEqual({ code: 'network_error' });
    expect(result.current.pending).toBe(false);
  });
});
