import { describe, expect, it, vi } from 'vitest';
import {
  METER_RECORD_PREFIX,
  UNSCOPED_REQUEST_ID,
  createLogMeterSink,
  createMeteredFetch,
  currentMeterRequestId,
  formatMeterLine,
  isMeterEnabled,
  parseSupabaseTarget,
  runWithMeterRequest,
  summarizeMeterRecords,
  type MeterRecord,
} from '@/lib/supabase/metering';

/**
 * DATA-PLAN §4 metering. Stub `inner` fetches return canned Responses only:
 * no network, no Supabase.
 */

const BASE = 'http://127.0.0.1:54321';

function collector() {
  const records: MeterRecord[] = [];
  return { records, sink: { record: (entry: MeterRecord) => void records.push(entry) } };
}

function stubFetch(respond: (url: string) => Response) {
  return vi.fn(async (input: RequestInfo | URL) => respond(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)) as unknown as typeof fetch;
}

function clock(...times: number[]) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

describe('isMeterEnabled', () => {
  it('is on only with SUPABASE_METER=1 outside production', () => {
    expect(isMeterEnabled({ SUPABASE_METER: '1', NODE_ENV: 'development' })).toBe(true);
    expect(isMeterEnabled({ SUPABASE_METER: '1', NODE_ENV: 'test' })).toBe(true);
    expect(isMeterEnabled({ SUPABASE_METER: '1', NODE_ENV: 'production' })).toBe(false);
    expect(isMeterEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(isMeterEnabled({ SUPABASE_METER: 'true', NODE_ENV: 'development' })).toBe(false);
    expect(isMeterEnabled({ SUPABASE_METER: '0', NODE_ENV: 'development' })).toBe(false);
  });
});

describe('parseSupabaseTarget', () => {
  it('parses tables, RPCs, storage buckets and auth', () => {
    expect(parseSupabaseTarget(`${BASE}/rest/v1/season_participants?select=*&season_id=eq.1`)).toEqual({ kind: 'table', name: 'season_participants' });
    expect(parseSupabaseTarget(`${BASE}/rest/v1/rpc/process_aggregate_jobs`)).toEqual({ kind: 'rpc', name: 'process_aggregate_jobs' });
    expect(parseSupabaseTarget(`${BASE}/storage/v1/object/public/world-assets/models/regular/1.glb`)).toEqual({ kind: 'storage', name: 'world-assets' });
    expect(parseSupabaseTarget(`${BASE}/storage/v1/object/avatars/p.png`)).toEqual({ kind: 'storage', name: 'avatars' });
    expect(parseSupabaseTarget(`${BASE}/storage/v1/bucket/avatars`)).toEqual({ kind: 'storage', name: null });
    expect(parseSupabaseTarget(`${BASE}/auth/v1/user`)).toEqual({ kind: 'auth', name: null });
    expect(parseSupabaseTarget(`${BASE}/something/else`)).toEqual({ kind: 'other', name: null });
    expect(parseSupabaseTarget('not a url')).toEqual({ kind: 'other', name: null });
  });

  it('decodes percent-encoded names', () => {
    expect(parseSupabaseTarget(`${BASE}/rest/v1/battle%5Fstats`)).toEqual({ kind: 'table', name: 'battle_stats' });
  });
});

describe('createMeteredFetch', () => {
  it('records method, table, status, content-length bytes and ms, and returns the inner response', async () => {
    const { records, sink } = collector();
    const original = new Response('[{"id":1}]', { status: 200, headers: { 'content-length': '1234' } });
    const inner = stubFetch(() => original);
    const metered = createMeteredFetch(inner, sink, clock(100, 112));
    const res = await metered(`${BASE}/rest/v1/players?select=id`, { method: 'get' });
    expect(res).toBe(original);
    expect(inner).toHaveBeenCalledTimes(1);
    expect(records).toEqual([
      { requestId: UNSCOPED_REQUEST_ID, method: 'GET', kind: 'table', name: 'players', status: 200, bytes: 1234, bytesSource: 'content-length', startMs: 100, ms: 12 },
    ]);
  });

  it('measures the body of a clone when content-length is absent, leaving the caller\'s body readable', async () => {
    const { records, sink } = collector();
    const body = JSON.stringify([{ id: 1, name: 'Ash' }, { id: 2, name: 'Misty' }]);
    const metered = createMeteredFetch(stubFetch(() => new Response(body, { status: 200 })), sink, clock(0, 5));
    const res = await metered(`${BASE}/rest/v1/rpc/get_standings`, { method: 'POST', body: '{}' });
    expect(await res.text()).toBe(body);
    await metered.idle();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ method: 'POST', kind: 'rpc', name: 'get_standings', status: 200, bytes: new TextEncoder().encode(body).length, bytesSource: 'body', ms: 5 });
  });

  it('records a bodiless response as 0 bytes and keeps error statuses', async () => {
    const { records, sink } = collector();
    const metered = createMeteredFetch(stubFetch(() => new Response(null, { status: 404 })), sink);
    const res = await metered(new URL(`${BASE}/rest/v1/games?id=eq.x`), { method: 'HEAD' });
    expect(res.status).toBe(404);
    expect(records[0]).toMatchObject({ method: 'HEAD', kind: 'table', name: 'games', status: 404, bytes: 0 });
  });

  it('reads the method and URL from a Request input', async () => {
    const { records, sink } = collector();
    const metered = createMeteredFetch(stubFetch(() => new Response('ok', { headers: { 'content-length': '2' } })), sink);
    await metered(new Request(`${BASE}/rest/v1/teams`, { method: 'PATCH', body: '{}' }));
    expect(records[0]).toMatchObject({ method: 'PATCH', kind: 'table', name: 'teams', bytes: 2 });
  });

  it('records a thrown fetch as status 0 and rethrows the same error', async () => {
    const { records, sink } = collector();
    const boom = new TypeError('fetch failed');
    const inner = vi.fn(async () => {
      throw boom;
    }) as unknown as typeof fetch;
    const metered = createMeteredFetch(inner, sink);
    await expect(metered(`${BASE}/rest/v1/players`)).rejects.toBe(boom);
    expect(records[0]).toMatchObject({ kind: 'table', name: 'players', status: 0, bytes: null, bytesSource: 'none', error: 'fetch failed' });
  });

  it('never lets a broken sink break the request, and reports it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sink = {
      record: () => {
        throw new Error('sink down');
      },
    };
    const metered = createMeteredFetch(stubFetch(() => new Response('x', { headers: { 'content-length': '1' } })), sink);
    const res = await metered(`${BASE}/rest/v1/players`);
    expect(res.status).toBe(200);
    expect(error).toHaveBeenCalledWith('[meter] sink failed to record a request:', expect.any(Error));
    error.mockRestore();
  });

  it('attributes requests to the AsyncLocalStorage request id', async () => {
    const { records, sink } = collector();
    const metered = createMeteredFetch(stubFetch(() => new Response('x', { headers: { 'content-length': '1' } })), sink);
    await Promise.all([
      runWithMeterRequest('/leagues/a', async () => {
        await metered(`${BASE}/rest/v1/seasons`);
        await metered(`${BASE}/rest/v1/season_stages`);
      }),
      runWithMeterRequest('/leagues/b', () => metered(`${BASE}/rest/v1/aggregates`)),
    ]);
    await metered(`${BASE}/rest/v1/players`);
    expect(currentMeterRequestId()).toBe(UNSCOPED_REQUEST_ID);
    const by = (id: string) => records.filter((r) => r.requestId === id).map((r) => r.name);
    expect(by('/leagues/a')).toEqual(['seasons', 'season_stages']);
    expect(by('/leagues/b')).toEqual(['aggregates']);
    expect(by(UNSCOPED_REQUEST_ID)).toEqual(['players']);
  });
});

function rec(partial: Partial<MeterRecord>): MeterRecord {
  return { requestId: 'r', method: 'GET', kind: 'table', name: 't', status: 200, bytes: 100, bytesSource: 'content-length', startMs: 0, ms: 10, ...partial };
}

describe('summaries', () => {
  it('counts queries, sequential waves, bytes and the top targets', () => {
    const summary = summarizeMeterRecords([
      rec({ name: 'season_participants', startMs: 0, ms: 10, bytes: 1000 }),
      rec({ name: 'season_participants', startMs: 2, ms: 10, bytes: 1000 }),
      rec({ name: 'seasons', startMs: 15, ms: 5, bytes: 200 }),
      rec({ kind: 'rpc', name: 'get_x', startMs: 21, ms: 5, bytes: null, bytesSource: 'none' }),
      rec({ name: 'battle_stats', startMs: 22, ms: 1, status: 500, bytes: 50 }),
    ]);
    expect(summary).toMatchObject({ queries: 5, waves: 3, bytes: 2250, unknownBytes: 1, errors: 1 });
    expect(summary.top[0]).toEqual({ name: 'season_participants', count: 2, bytes: 2000 });
    expect(summary.top.map((t) => t.name)).toContain('rpc:get_x');
    expect(formatMeterLine('/leagues/abc', summary)).toBe(
      '[meter] /leagues/abc  q=5 waves≈3 bytes=2.2KB (+1 unmeasured) errors=1  top: season_participants×2, seasons×1, battle_stats×1, rpc:get_x×1',
    );
  });

  it('the log sink prints one record line per request and a summary per request id', () => {
    const lines: string[] = [];
    const sink = createLogMeterSink({ log: (line) => lines.push(line), idleMs: 60_000 });
    sink.record(rec({ requestId: '/a', name: 'seasons' }));
    sink.record(rec({ requestId: '/a', name: 'players', startMs: 20 }));
    sink.record(rec({ requestId: '/b', name: 'aggregates' }));
    expect(lines.filter((l) => l.startsWith(METER_RECORD_PREFIX))).toHaveLength(3);
    expect(JSON.parse(lines[0].slice(METER_RECORD_PREFIX.length))).toMatchObject({ requestId: '/a', name: 'seasons' });
    sink.flush();
    const summaries = lines.filter((l) => l.startsWith('[meter] '));
    expect(summaries).toEqual([expect.stringContaining('[meter] /a  q=2 waves≈2'), expect.stringContaining('[meter] /b  q=1 waves≈1')]);
  });

  it('the log sink summarises a request id once it has been idle', () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const sink = createLogMeterSink({ log: (line) => lines.push(line), idleMs: 500, emitRecords: false });
      sink.record(rec({ requestId: '/a' }));
      vi.advanceTimersByTime(400);
      sink.record(rec({ requestId: '/a', startMs: 30 }));
      vi.advanceTimersByTime(400);
      expect(lines).toEqual([]);
      vi.advanceTimersByTime(200);
      expect(lines).toEqual([expect.stringContaining('[meter] /a  q=2')]);
    } finally {
      vi.useRealTimers();
    }
  });
});
