/**
 * The request logic behind every "update to the newest version" button (`runPinMove`), apart from React: what it shows while
 * the request runs, when it refreshes the page, and what it leaves on screen. A pin that a concurrent change moved
 * (`ruleset_pin_moved`, 409) is a conflict: the page is stale, so it is refreshed and the message stays beside the fresh state.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { FetchLike } from '@/lib/studio-core/request';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { runPinMove } from '../use-pin-move';

const TARGETS = [{ kind: 'season' as const, id: 's1' }];

function setup(data: unknown, status: number) {
  const log: string[] = [];
  const errors: Array<ApiErrorLike | null> = [];
  const requests: Array<{ url: string; body: unknown }> = [];
  const f: FetchLike = async (url, init) => {
    log.push('request');
    requests.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: 'no', ...(data as object) }), { status });
  };
  const effects = {
    setBusy: (busy: boolean) => log.push(`busy:${busy}`),
    setError: (error: ApiErrorLike | null) => {
      errors.push(error);
      log.push(error === null ? 'error:none' : `error:${error.code}`);
    },
    close: () => log.push('close'),
    refresh: () => log.push('refresh'),
  };
  return { f, effects, log, errors, requests };
}

describe('runPinMove', () => {
  it('sends the move, then closes the dialog and refreshes the page on success, returning the answer', async () => {
    const { f, effects, log, requests } = setup({ version_no: 3, moved: 1 }, 200);
    const outcome = await runPinMove('def-ou', 3, TARGETS, ['s1'], effects, f);
    expect(outcome).toEqual({ version_no: 3, moved: 1 });
    expect(requests).toEqual([{ url: '/api/ruleset-definitions/def-ou/pins', body: { to_version_no: 3, targets: TARGETS, confirm_started: ['s1'] } }]);
    expect(log).toEqual(['busy:true', 'error:none', 'request', 'busy:false', 'close', 'refresh']);
  });

  it('a pin that moved meanwhile refreshes the page and keeps the message, so the admin can retry from the current state', async () => {
    const { f, effects, log, errors } = setup({ code: 'ruleset_pin_moved', params: { target: 'Summer League' } }, 409);
    const outcome = await runPinMove('def-ou', 3, TARGETS, [], effects, f);
    expect(outcome).toBeNull();
    expect(errors.at(-1)).toMatchObject({ code: 'ruleset_pin_moved', params: { target: 'Summer League' } });
    expect(log).toEqual(['busy:true', 'error:none', 'request', 'busy:false', 'close', 'error:ruleset_pin_moved', 'refresh']);
  });

  it.each([
    ['a refusal that a retry cannot fix', { code: 'ruleset_pin_confirm_required', params: { targets: 'Summer League' } }, 409],
    ['a rate limit', { code: 'rate_limited', params: { seconds: 30 } }, 429],
    ['a request that never arrived', { code: 'network_error' }, 0],
  ])('%s shows its message and leaves the page as it is', async (_name, body, status) => {
    const { f, effects, log } = setup(body, status);
    // Status 0 means no response at all.
    const send: FetchLike = status === 0 ? async () => Promise.reject(new Error('offline')) : f;
    expect(await runPinMove('def-ou', 3, TARGETS, [], effects, send)).toBeNull();
    expect(log).not.toContain('refresh');
    expect(log.at(-1)).toBe(`error:${(body as { code: string }).code}`);
  });
});
