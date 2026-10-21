/**
 * SQL-vs-TS parity of the draft quiet-hours clock (lead decision N-4, round 2). Opt-in and maintainer-only:
 * it runs only when LOCAL_DB_URL is set, and only against a LOCAL stack (`supabase start`).
 *
 *   LOCAL_DB_URL=http://127.0.0.1:54321 LOCAL_DB_SERVICE_ROLE_KEY=<local service_role key> \
 *     npx vitest run src/lib/draft/__tests__/quiet-hours-sql-parity.live-db.test.ts
 *
 * LOCAL_DB_URL is the local stack's API URL (`supabase status` -> API_URL); the helpers are called through PostgREST
 * with the service role (the only role they are granted to). Any host other than 127.0.0.1 / localhost / ::1 is
 * refused, so the hosted project is never reached. Never runs in CI. It reads no `.env`.
 *
 * It replays every vector of fixtures/quiet-hours-vectors.json through draft__quiet_window_end, draft__running_ms
 * and draft__add_running_ms (supabase/migrations/20261018140100_draft_quiet_hours.sql) and through the TS mirror
 * (src/lib/draft/time.ts), then compares both on a sweep across the two DST nights of the season
 * (2026-10-25 and 2027-03-28, Europe/Berlin 00-06).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import vectors from './fixtures/quiet-hours-vectors.json';
import { callRpc, connectLocalDb, inBatches, LOCAL_DB_OPTED_IN } from './local-db';
import { addRunningMs, quietWindowEnd, runningMsBetween, type QuietHours } from '../time';

type QuietKey = keyof typeof vectors.quiet;
const quietOf = (key: string | null): QuietHours | null => (key === null ? null : vectors.quiet[key as QuietKey]);

/** The three pool columns as the SQL helpers take them (NULL start hour = no quiet hours). */
function quietArgs(q: QuietHours | null): { p_start: number | null; p_end: number | null; p_tz: string | null } {
  return q === null ? { p_start: null, p_end: null, p_tz: null } : { p_start: q.startHour, p_end: q.endHour, p_tz: q.timeZone };
}

const toMs = (value: unknown, fn: string): number | null => {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${fn} returned ${JSON.stringify(value)}`);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${fn} returned an unparsable instant ${value}`);
  return parsed;
};

const toNumber = (value: unknown, fn: string): number => {
  if (typeof value !== 'number') throw new Error(`${fn} returned ${JSON.stringify(value)}`);
  return value;
};

let db: SupabaseClient;

const rpc = (fn: string, args: Record<string, unknown>): Promise<unknown> => callRpc(db, fn, args);

const sqlWindowEnd = async (at: number, q: QuietHours | null) =>
  toMs(await rpc('draft__quiet_window_end', { p_at: new Date(at).toISOString(), ...quietArgs(q) }), 'draft__quiet_window_end');

const sqlRunning = async (from: number, to: number, q: QuietHours | null) =>
  toNumber(
    await rpc('draft__running_ms', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(), ...quietArgs(q) }),
    'draft__running_ms',
  );

const sqlAdd = async (from: number, ms: number, q: QuietHours | null) =>
  toMs(await rpc('draft__add_running_ms', { p_from: new Date(from).toISOString(), p_ms: ms, ...quietArgs(q) }), 'draft__add_running_ms');

describe.skipIf(!LOCAL_DB_OPTED_IN)('quiet hours: SQL helpers vs TS mirror (local stack, LOCAL_DB_URL)', () => {
  beforeAll(() => {
    db = connectLocalDb();                                              // throws for a non-local URL
  });

  it.each(vectors.windowEnd.map((v) => [v.name, v] as const))('windowEnd vector: %s', async (_name, v) => {
    const q = quietOf(v.quiet);
    const at = Date.parse(v.at);
    const expected = v.expected === null ? null : Date.parse(v.expected);
    expect(await sqlWindowEnd(at, q)).toBe(expected);
    expect(quietWindowEnd(at, q)).toBe(expected);
  });

  it.each(vectors.running.map((v) => [v.name, v] as const))('running vector: %s', async (_name, v) => {
    const q = quietOf(v.quiet);
    const [from, to] = [Date.parse(v.from), Date.parse(v.to)];
    expect(await sqlRunning(from, to, q)).toBe(v.expected_ms);
    expect(runningMsBetween(from, to, q)).toBe(v.expected_ms);
  });

  it.each(vectors.add.map((v) => [v.name, v] as const))('add vector: %s', async (_name, v) => {
    const q = quietOf(v.quiet);
    const from = Date.parse(v.from);
    const expected = v.expected === null ? null : Date.parse(v.expected);
    expect(await sqlAdd(from, v.ms, q)).toBe(expected);
    expect(addRunningMs(from, v.ms, q)).toBe(expected);
  });

  // Every 37 minutes across each DST week (odd step: the starts hit many minutes of the hour), live and slow clocks.
  const SWEEP_WEEKS = ['2026-10-22T00:00:00Z', '2027-03-25T00:00:00Z'];
  const LENGTHS = [150_000, 5_400_000, 43_200_000, 172_800_000];
  const sweep = SWEEP_WEEKS.flatMap((week) => Array.from({ length: 280 }, (_, i) => Date.parse(week) + i * 37 * 60_000));

  it.each(Object.keys(vectors.quiet))('sweep across both DST nights agrees for window %s', async (key) => {
    const q = quietOf(key);
    const windowEnds = await inBatches(sweep.map((at) => () => sqlWindowEnd(at, q)));
    expect(windowEnds).toEqual(sweep.map((at) => quietWindowEnd(at, q)));

    const pairs = sweep.flatMap((from) => LENGTHS.map((len) => [from, len] as const));
    const deadlines = await inBatches(pairs.map(([from, len]) => () => sqlAdd(from, len, q)));
    expect(deadlines).toEqual(pairs.map(([from, len]) => addRunningMs(from, len, q)));

    const running = await inBatches(pairs.map(([from, len]) => () => sqlRunning(from, from + len, q)));
    expect(running).toEqual(pairs.map(([from, len]) => runningMsBetween(from, from + len, q)));
  }, 300_000);
});
