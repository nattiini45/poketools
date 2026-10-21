import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTimeoutFetch,
  isSupabaseTimeoutError,
  SUPABASE_REQUEST_TIMEOUT_MS,
  SUPABASE_STORAGE_TIMEOUT_MS,
  SupabaseTimeoutError,
  supabaseService,
  supabaseTimeoutFor,
} from '@/lib/supabase/timeout-fetch';

const BASE = 'http://127.0.0.1:54321';

/** An inner fetch that never answers and rejects with the signal's reason once aborted. */
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason));
      })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('supabaseService / supabaseTimeoutFor', () => {
  it.each([
    [`${BASE}/rest/v1/players?select=id`, 'rest', SUPABASE_REQUEST_TIMEOUT_MS],
    [`${BASE}/auth/v1/token?grant_type=password`, 'auth', SUPABASE_REQUEST_TIMEOUT_MS],
    [`${BASE}/storage/v1/object/avatars/a.png`, 'storage', SUPABASE_STORAGE_TIMEOUT_MS],
    [`${BASE}/functions/v1/x`, 'other', SUPABASE_REQUEST_TIMEOUT_MS],
    ['not a url', 'other', SUPABASE_REQUEST_TIMEOUT_MS],
  ])('%s is %s with a %d ms budget', (url, service, ms) => {
    expect(supabaseService(url)).toBe(service);
    expect(supabaseTimeoutFor(url)).toBe(ms);
  });

  it('uses 10 s for PostgREST/GoTrue and 30 s for Storage', () => {
    expect(SUPABASE_REQUEST_TIMEOUT_MS).toBe(10_000);
    expect(SUPABASE_STORAGE_TIMEOUT_MS).toBe(30_000);
  });
});

describe('createTimeoutFetch', () => {
  it('passes a signal and keeps method, headers and body', async () => {
    const response = new Response('[]', { status: 201, statusText: 'Created', headers: { 'content-range': '0-0/1' } });
    const inner = vi.fn(async () => response);
    const timed = createTimeoutFetch(inner);

    const res = await timed(`${BASE}/rest/v1/players`, {
      method: 'POST',
      headers: { apikey: 'k' },
      body: '{"a":1}',
    });

    expect(res.status).toBe(201);
    expect(res.statusText).toBe('Created');
    expect(res.headers.get('content-range')).toBe('0-0/1');
    expect(await res.text()).toBe('[]');
    expect(inner).toHaveBeenCalledWith(`${BASE}/rest/v1/players`, {
      method: 'POST',
      headers: { apikey: 'k' },
      body: '{"a":1}',
      signal: expect.any(AbortSignal),
    });
  });

  it('picks the per-service budget from the URL', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const timed = createTimeoutFetch(vi.fn(async () => new Response('')));

    await timed(`${BASE}/rest/v1/players`);
    await timed(new URL(`${BASE}/storage/v1/object/social-images/a.png`));
    await timed(new Request(`${BASE}/auth/v1/user`));

    expect(timeoutSpy.mock.calls.map((c) => c[0])).toEqual([
      SUPABASE_REQUEST_TIMEOUT_MS,
      SUPABASE_STORAGE_TIMEOUT_MS,
      SUPABASE_REQUEST_TIMEOUT_MS,
    ]);
  });

  it('rejects a stalled request with SupabaseTimeoutError once the budget passes', async () => {
    const timed = createTimeoutFetch(hangingFetch(), { timeoutMs: 20 });
    const started = Date.now();

    const err = await timed(`${BASE}/rest/v1/players?select=id&token=secret`, { method: 'get' }).catch(
      (e: unknown) => e
    );

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(err).toBeInstanceOf(SupabaseTimeoutError);
    const timeout = err as SupabaseTimeoutError;
    expect(timeout.name).toBe('SupabaseTimeoutError');
    expect(timeout.message).toBe('Supabase rest request timed out after 20 ms: GET /rest/v1/players');
    expect(timeout.message).not.toContain('secret');
    expect(timeout.service).toBe('rest');
    expect(timeout.timeoutMs).toBe(20);
    expect((timeout.cause as Error).name).toBe('TimeoutError');
  });

  it("propagates a caller's abort unchanged and does not label it a timeout", async () => {
    const timed = createTimeoutFetch(hangingFetch());
    const controller = new AbortController();

    const pending = timed(`${BASE}/rest/v1/players`, { signal: controller.signal }).catch((e: unknown) => e);
    controller.abort();
    const err = await pending;

    expect(err).not.toBeInstanceOf(SupabaseTimeoutError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('honours an already-aborted caller signal', async () => {
    const inner = hangingFetch();
    const timed = createTimeoutFetch(inner);
    const signal = AbortSignal.abort();

    await expect(timed(`${BASE}/rest/v1/players`, { signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect((inner.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('combines the caller signal of a Request input with the deadline', async () => {
    const inner = hangingFetch();
    const timed = createTimeoutFetch(inner);
    const controller = new AbortController();

    const pending = timed(new Request(`${BASE}/rest/v1/players`, { signal: controller.signal })).catch(
      (e: unknown) => e
    );
    controller.abort();
    const err = await pending;

    expect((err as Error).name).toBe('AbortError');
    expect((inner.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('propagates network errors unchanged', async () => {
    const network = new TypeError('fetch failed');
    const timed = createTimeoutFetch(vi.fn(async () => Promise.reject(network)));
    await expect(timed(`${BASE}/rest/v1/players`)).rejects.toBe(network);
  });

  it('uses the global fetch at call time by default', async () => {
    const response = new Response('ok');
    const stub = vi.fn(async () => response);
    vi.stubGlobal('fetch', stub);

    const res = await createTimeoutFetch()(`${BASE}/rest/v1/players`);

    expect(await res.text()).toBe('ok');
    expect(stub).toHaveBeenCalledWith(`${BASE}/rest/v1/players`, { signal: expect.any(AbortSignal) });
  });

  // A deadline that fires after the headers arrived, while the body is being
  // read, must be labelled the same way as one that fires before them.
  describe('body read', () => {
    /** An inner fetch that answers 200 with one chunk, then stalls the body until the signal aborts. */
    function stallingBodyFetch(firstChunk = '[{"id":') {
      return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(firstChunk));
            signal?.addEventListener('abort', () => controller.error(signal.reason));
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
      });
    }

    it('turns a deadline during the body read into SupabaseTimeoutError', async () => {
      const timed = createTimeoutFetch(stallingBodyFetch(), { timeoutMs: 20 });

      const res = await timed(`${BASE}/rest/v1/players?select=id&token=secret`);
      expect(res.status).toBe(200);
      const err = await res.text().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SupabaseTimeoutError);
      expect((err as Error).message).toBe('Supabase rest request timed out after 20 ms: GET /rest/v1/players');
      expect(((err as Error).cause as Error).name).toBe('TimeoutError');
    });

    it("leaves a caller's abort during the body read unlabelled", async () => {
      const timed = createTimeoutFetch(stallingBodyFetch());
      const controller = new AbortController();

      const res = await timed(`${BASE}/rest/v1/players`, { signal: controller.signal });
      const pending = res.text().catch((e: unknown) => e);
      controller.abort();
      const err = await pending;

      expect(err).not.toBeInstanceOf(SupabaseTimeoutError);
      expect((err as Error).name).toBe('AbortError');
    });

    it('propagates a stream error that is not the deadline unchanged', async () => {
      const broken = new Error('socket hang up');
      const timed = createTimeoutFetch(
        vi.fn(
          async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                pull(controller) {
                  controller.error(broken);
                },
              })
            )
        )
      );

      const res = await timed(`${BASE}/rest/v1/players`);
      await expect(res.text()).rejects.toBe(broken);
    });

    it('keeps the response url', async () => {
      const response = new Response('[]');
      Object.defineProperty(response, 'url', { value: `${BASE}/rest/v1/players` });
      const res = await createTimeoutFetch(vi.fn(async () => response))(`${BASE}/rest/v1/players`);

      expect(res.url).toBe(`${BASE}/rest/v1/players`);
    });

    it.each([204, 304])('returns a %d response (no body) as it is', async (status) => {
      const response = new Response(null, { status });
      const res = await createTimeoutFetch(vi.fn(async () => response))(`${BASE}/rest/v1/players`);

      expect(res).toBe(response);
    });
  });
});

describe('isSupabaseTimeoutError', () => {
  const timeout = new SupabaseTimeoutError('auth', 'POST', '/auth/v1/token', 50, new Error('aborted'));

  it('accepts the instance, a copied message and a cause / originalError chain', () => {
    expect(isSupabaseTimeoutError(timeout)).toBe(true);
    expect(isSupabaseTimeoutError({ message: `SupabaseTimeoutError: ${timeout.message}` })).toBe(true);
    expect(isSupabaseTimeoutError({ name: 'StorageUnknownError', message: 'x', originalError: timeout })).toBe(true);
    expect(isSupabaseTimeoutError(new Error('outer', { cause: new Error('mid', { cause: timeout }) }))).toBe(true);
  });

  it('rejects other errors, primitives and cyclic chains without looping', () => {
    const cyclic: { message: string; cause?: unknown } = { message: 'loop' };
    cyclic.cause = cyclic;

    expect(isSupabaseTimeoutError(new Error('canceling statement due to statement timeout'))).toBe(false);
    expect(isSupabaseTimeoutError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(false);
    expect(isSupabaseTimeoutError('Supabase rest request timed out after 5 ms: GET /x')).toBe(false);
    expect(isSupabaseTimeoutError(null)).toBe(false);
    expect(isSupabaseTimeoutError(cyclic)).toBe(false);
  });
});
