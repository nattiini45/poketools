/**
 * "Create Redraft" body (`createAdminDraftActions(…).createRedraft`): a league with groups names the pool's group
 * (`POST /api/drafts` refuses a grouped Redraft without one, SEASON_GROUP_REQUIRED); a league without groups sends
 * exactly the body it sent before groups existed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminDraftActions } from '../admin-actions';

const SEASON = '11111111-1111-4111-8111-111111111111';
const POOL = '22222222-2222-4222-8222-222222222222';
const GROUP = '33333333-3333-4333-8333-333333333333';

function stubFetch() {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { pool_id: 'new-pool' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(call[0]).toBe('/api/drafts');
  expect(call[1].method).toBe('POST');
  return JSON.parse(String(call[1].body));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAdminDraftActions().createRedraft', () => {
  it('a league without groups: the body is unchanged (no season_group_id)', async () => {
    const fetchMock = stubFetch();
    const res = await createAdminDraftActions(POOL, SEASON).createRedraft(false);
    expect(res).toEqual({ ok: true, data: { pool_id: 'new-pool' } });
    expect(sentBody(fetchMock)).toEqual({ season_id: SEASON, kind: 'redraft' });
  });

  it('a league without groups, forced: adds only force', async () => {
    const fetchMock = stubFetch();
    await createAdminDraftActions(POOL, SEASON, null).createRedraft(true);
    expect(sentBody(fetchMock)).toEqual({ season_id: SEASON, kind: 'redraft', force: true });
  });

  it("a league with groups: names the pool's group", async () => {
    const fetchMock = stubFetch();
    await createAdminDraftActions(POOL, SEASON, GROUP).createRedraft(false);
    expect(sentBody(fetchMock)).toEqual({ season_id: SEASON, kind: 'redraft', season_group_id: GROUP });
  });

  it('a league with groups, forced: group and force', async () => {
    const fetchMock = stubFetch();
    await createAdminDraftActions(POOL, SEASON, GROUP).createRedraft(true);
    expect(sentBody(fetchMock)).toEqual({ season_id: SEASON, kind: 'redraft', force: true, season_group_id: GROUP });
  });
});

describe('createAdminDraftActions().deletePool', () => {
  it('sends DELETE /api/drafts/[id] without a body and accepts the route’s null data', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await createAdminDraftActions(POOL, SEASON, GROUP).deletePool();

    expect(res).toEqual({ ok: true, data: null });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`/api/drafts/${POOL}`);
    expect(call[1].method).toBe('DELETE');
    expect(call[1].body).toBeUndefined();
  });

  it('a 409 POOL_NOT_DELETABLE (the draft started meanwhile) is a failure carrying the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, error: 'not deletable', code: 'POOL_NOT_DELETABLE', detail: { phase: 'drafting' } }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const res = await createAdminDraftActions(POOL, SEASON).deletePool();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('POOL_NOT_DELETABLE');
  });

  it('a success without the null data is not accepted as a delete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, data: { state_version: 1 } }), { status: 200 })),
    );
    expect((await createAdminDraftActions(POOL, SEASON).deletePool()).ok).toBe(false);
  });
});

describe('createAdminDraftActions().rollOrder', () => {
  it('sends POST /api/drafts/[id]/roll-order with an empty body and accepts the state version', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { state_version: 7 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await createAdminDraftActions(POOL, SEASON, GROUP).rollOrder();

    expect(res).toEqual({ ok: true, data: { state_version: 7 } });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`/api/drafts/${POOL}/roll-order`);
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(String(call[1].body))).toEqual({});
  });

  it('a 409 DRAFT_ALREADY_STARTED (the draft started meanwhile) is a failure carrying the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, error: 'started', code: 'DRAFT_ALREADY_STARTED' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await createAdminDraftActions(POOL, SEASON).rollOrder();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('DRAFT_ALREADY_STARTED');
  });
});
