/**
 * `listPlayers` and `findPlayerIdsForMatchSearch` against a real supabase-js
 * client (its postgrest query builder) with a stubbed `fetch`: these tests read the request URL the
 * library actually builds, so a library change in how repeated `or()` calls
 * or `order()` calls are serialised cannot silently change what is queried.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchStub } = vi.hoisted(() => ({ fetchStub: vi.fn() }));

vi.mock('@/lib/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient('http://postgrest.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchStub },
  });
  return { supabase };
});

import { listPlayers } from '../players';
import { findPlayerIdsForMatchSearch } from '../matches';

function requestedUrl(): URL {
  expect(fetchStub).toHaveBeenCalledTimes(1);
  return new URL(String(fetchStub.mock.calls[0][0]));
}

beforeEach(() => {
  fetchStub.mockReset();
  fetchStub.mockImplementation(
    async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-range': '*/0' },
      }),
  );
});

describe('listPlayers request URL', () => {
  it('sends the search and the registered-only login filter as two separate or= parameters', async () => {
    await listPlayers({ search: 'Ash', registeredOnly: true });

    const url = requestedUrl();
    // PostgREST ANDs repeated top-level or= parameters; one overwriting the other would drop the search.
    expect(url.searchParams.getAll('or')).toEqual([
      '(name.ilike."%Ash%",ps_username.ilike."%Ash%")',
      '(discord_id.not.is.null,auth_user_id.not.is.null)',
    ]);
    expect(url.searchParams.get('is_guest')).toBe('eq.false');
    expect(url.searchParams.get('status')).toBe('eq.active');
  });

  it('orders by name, then id, by default', async () => {
    await listPlayers();

    expect(requestedUrl().searchParams.get('order')).toBe('name.asc,id.asc');
  });

  it('orders by the requested column, falling back to name and id', async () => {
    await listPlayers({ sort: { column: 'status', direction: 'desc' } });

    expect(requestedUrl().searchParams.get('order')).toBe('status.desc,name.asc,id.asc');
  });

  it('restricts to active, non-test accounts with visibleOnly', async () => {
    await listPlayers({ search: 'Ash', visibleOnly: true });

    const url = requestedUrl();
    expect(url.searchParams.get('status')).toBe('eq.active');
    expect(url.searchParams.get('is_test_account')).toBe('eq.false');
    expect(url.searchParams.getAll('or')).toHaveLength(1);
  });

  it('puts a hostile search term inside one quoted pattern', async () => {
    await listPlayers({ search: 'a,b)"c.d*' });

    const filters = requestedUrl().searchParams.getAll('or');
    expect(filters).toEqual(['(name.ilike."%a,b)\\"c.d*%",ps_username.ilike."%a,b)\\"c.d*%")']);
  });
});

describe('findPlayerIdsForMatchSearch request URL', () => {
  it('searches name and Showdown username with an escaped, quoted pattern', async () => {
    await findPlayerIdsForMatchSearch('50%_a,"b"');

    const url = requestedUrl();
    expect(url.searchParams.getAll('or')).toEqual([
      String.raw`(name.ilike."%50\\%\\_a,\"b\"%",ps_username.ilike."%50\\%\\_a,\"b\"%")`,
    ]);
    expect(url.searchParams.get('select')).toBe('id');
  });

  it('builds the same filter as the player directory search', async () => {
    await findPlayerIdsForMatchSearch('mara');
    const matchFilter = requestedUrl().searchParams.get('or');

    fetchStub.mockClear();
    await listPlayers({ search: 'mara' });

    expect(requestedUrl().searchParams.get('or')).toBe(matchFilter);
  });
});
