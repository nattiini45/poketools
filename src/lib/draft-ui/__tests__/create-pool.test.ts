import { describe, expect, it, vi } from 'vitest';
import { postDraftCreate } from '../create-pool';

const BODY = { season_id: '00000000-0000-4000-a000-000000000001', kind: 'initial' };

/** A fetch stub answering with `status` and a body that `json()` resolves or throws. */
function reply(status: number, body: unknown | (() => never)) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'function' ? (body as () => never)() : body),
  })) as unknown as typeof fetch;
}

const notJson = () => {
  throw new SyntaxError('Unexpected token < in JSON');
};

describe('postDraftCreate', () => {
  it('POSTs the body as JSON to /api/drafts', async () => {
    const fetchImpl = reply(201, { success: true, data: { pool_id: 'p1' } });
    await postDraftCreate(BODY, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    });
  });

  it('a success body: created', async () => {
    expect(await postDraftCreate(BODY, reply(201, { success: true, data: {} }))).toEqual({ created: true });
  });

  it('an API refusal: its error and code', async () => {
    const outcome = await postDraftCreate(
      BODY,
      reply(409, { success: false, error: 'This season already has a draft pool', code: 'POOL_EXISTS' }),
    );
    expect(outcome).toEqual({
      created: false,
      error: { kind: 'api', error: { error: 'This season already has a draft pool', code: 'POOL_EXISTS' } },
    });
  });

  it('a request that never reached the server: network_error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await postDraftCreate(BODY, fetchImpl)).toEqual({
      created: false,
      error: { kind: 'api', error: { code: 'network_error' } },
    });
  });

  it('a 2xx reply with an unreadable body: created (the draft exists; a retry would hit POOL_EXISTS)', async () => {
    expect(await postDraftCreate(BODY, reply(201, notJson))).toEqual({ created: true });
  });

  it('a non-2xx reply with an unreadable body: unreadable', async () => {
    expect(await postDraftCreate(BODY, reply(502, notJson))).toEqual({
      created: false,
      error: { kind: 'unreadable' },
    });
  });

  it.each([
    ['an empty object', {}],
    ['null', null],
    ['an array', []],
    ['a gateway-shaped object', { message: 'OK' }],
  ])('a 2xx reply whose JSON is %s: created (only `success: false` refuses)', async (_label, body) => {
    expect(await postDraftCreate(BODY, reply(201, body))).toEqual({ created: true });
  });

  it('a 2xx reply that says `success: false`: refused', async () => {
    expect(await postDraftCreate(BODY, reply(200, { success: false, error: 'No', code: 'POOL_EXISTS' }))).toEqual({
      created: false,
      error: { kind: 'api', error: { error: 'No', code: 'POOL_EXISTS' } },
    });
  });

  it('never throws, even without a global fetch', async () => {
    vi.stubGlobal('fetch', undefined);
    try {
      const outcome = await postDraftCreate(BODY);
      expect(outcome.created).toBe(false);
      expect(outcome).toMatchObject({ error: { kind: 'api' } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
