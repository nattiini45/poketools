/**
 * Connection of the opt-in SQL parity tests of src/lib/draft (quiet hours, pool completability). Test-only.
 *
 *   LOCAL_DB_URL=http://127.0.0.1:54321 LOCAL_DB_SERVICE_ROLE_KEY=<local service_role key> npx vitest run <file>
 *
 * LOCAL_DB_URL is the local stack's API URL (`supabase status` -> API_URL); the SQL helpers are called through
 * PostgREST with the service role, the only role they are granted to. Any host other than 127.0.0.1 / localhost / ::1
 * is refused, so the hosted project is never reached (AGENTS.md "Automation never spends the Supabase quota"). The
 * tests never run in CI and read no `.env`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Whether the opt-in is set (and this is not CI). The suites `describe.skipIf(!LOCAL_DB_OPTED_IN)`. */
export const LOCAL_DB_OPTED_IN = Boolean(process.env.LOCAL_DB_URL) && process.env.CI !== 'true';

function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
}

/** The service-role client of the local stack; throws for a non-local URL or a missing key. */
export function connectLocalDb(): SupabaseClient {
  const url = process.env.LOCAL_DB_URL;
  const key = process.env.LOCAL_DB_SERVICE_ROLE_KEY;
  if (!url) throw new Error('LOCAL_DB_URL is not set');
  if (!isLocalHost(url)) throw new Error(`SQL parity tests refuse to run against ${new URL(url).host}: local stack only`);
  if (!key) throw new Error('LOCAL_DB_SERVICE_ROLE_KEY is required with LOCAL_DB_URL (the local service_role key)');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Calls an RPC and throws its error with the function name and code (never a silent null). */
export async function callRpc(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code ?? ''} ${error.message}`);
  return data;
}

/** Runs `tasks` with at most `width` requests in flight (a local PostgREST, not a load test). */
export async function inBatches<T>(tasks: (() => Promise<T>)[], width = 16): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += width) out.push(...(await Promise.all(tasks.slice(i, i + width).map((t) => t()))));
  return out;
}
