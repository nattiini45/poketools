import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { safeErrorResponse } from '@/lib/api/error-response';
import { createTimeoutFetch } from '@/lib/supabase/timeout-fetch';

/**
 * Real supabase-js against a loopback server that accepts requests and never
 * answers (or, for the `stall_body` table, sends the headers and part of the
 * body, then stalls): the deadline must end each call quickly and surface as
 * an explicit SupabaseTimeoutError message. Nothing leaves 127.0.0.1.
 */

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/rest/v1/stall_body')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('[{"id":');
    }
    // Otherwise never respond; the stall_body response never ends.
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client() {
  return createClient(baseUrl, 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createTimeoutFetch(undefined, { timeoutMs: 50 }) },
  });
}

describe('Supabase deadline against a hung server', () => {
  it('PostgREST returns { error } naming the timeout instead of hanging', async () => {
    const started = Date.now();
    const { data, error } = await client().from('players').select('id');

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(data).toBeNull();
    expect(error?.message).toMatch(/^SupabaseTimeoutError: Supabase rest request timed out after 50 ms: GET \/rest\/v1\/players/);
  });

  it('GoTrue reports the timeout as an error', async () => {
    const started = Date.now();
    const { error } = await client().auth.signInWithPassword({ email: 'a@example.com', password: 'x' });

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error?.name).toBe('AuthRetryableFetchError');
    expect(error?.message).toBe('Supabase auth request timed out after 50 ms: POST /auth/v1/token');
  });

  it('Storage reports the timeout as an error', async () => {
    const started = Date.now();
    const { error } = await client().storage.from('avatars').download('a.png');

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(error?.name).toBe('StorageUnknownError');
    expect(error?.message).toBe('Supabase storage request timed out after 50 ms: GET /storage/v1/object/avatars/a.png');
  });

  it('PostgREST names the timeout when the deadline fires while the body is being read', async () => {
    const started = Date.now();
    const { data, error } = await client().from('stall_body').select('id');

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(data).toBeNull();
    expect(error?.message).toMatch(
      /^SupabaseTimeoutError: Supabase rest request timed out after 50 ms: GET \/rest\/v1\/stall_body/
    );
  });

  it('a rethrown PostgREST deadline answers 504 upstream_timeout through safeErrorResponse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { error } = await client().from('players').select('id');

    const res = safeErrorResponse(error, 'Failed to fetch players');

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to fetch players', code: 'upstream_timeout' });
    vi.restoreAllMocks();
  });
});
