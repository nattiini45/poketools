/**
 * The one decision point for every suite and script that talks to a real database (AGENTS.md "Automation never
 * spends the Supabase quota"). A real-database suite runs only against a local stack, only on an explicit opt-in, and
 * never loads `.env`.
 *
 * - `localStackOptIn(flag)`: the suite's own flag (`LOCAL_RULESETS=1`) or the shared `LOCAL_STACK=1` that
 *   `npm run test:db` sets. On a CI runner it also needs `LOCAL_STACK_CI=1`, which only the advisory workflow jobs set
 *   after starting their own ephemeral stack, so a stray `CI=true` run on a machine with a real `.env` stays off.
 * - `assertLoopbackUrl(url)`: refuses every host that is not the loopback interface, so the hosted project is never
 *   reached whatever the environment holds.
 *
 * Test-only: it imports nothing from the app.
 */

import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const LOOPBACK_HOSTNAMES: readonly string[] = ['127.0.0.1', 'localhost', '[::1]'];

type Env = Readonly<Record<string, string | undefined>>;

function hostnameOf(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for an http(s) URL whose host is exactly 127.0.0.1, localhost or ::1. */
export function isLoopbackUrl(raw: string | undefined): boolean {
  const host = hostnameOf(raw);
  return host !== null && LOOPBACK_HOSTNAMES.includes(host);
}

/** Throws unless `raw` points at the loopback interface. The message names the variable and the host, never the path. */
export function assertLoopbackUrl(raw: string | undefined, name: string): void {
  const host = hostnameOf(raw);
  if (host === null) {
    throw new Error(`[local-stack] refusing to run: ${name} is not a valid URL`);
  }
  if (!LOOPBACK_HOSTNAMES.includes(host)) {
    throw new Error(`[local-stack] refusing to run: ${name} host "${host}" is not the loopback interface (127.0.0.1, localhost, ::1)`);
  }
}

/** CI runs a local-stack suite only when the workflow declares its own ephemeral stack with `LOCAL_STACK_CI=1`. */
export function ciAllowsLocalStack(env: Env = process.env): boolean {
  return env.CI !== 'true' || env.LOCAL_STACK_CI === '1';
}

/** Whether a local-stack suite runs: its own flag or `LOCAL_STACK=1`, and CI only with `LOCAL_STACK_CI=1`. */
export function localStackOptIn(flag: string, env: Env = process.env): boolean {
  const requested = env[flag] === '1' || env.LOCAL_STACK === '1';
  return requested && ciAllowsLocalStack(env);
}

/**
 * Load a `.env` file over the current environment, for a suite that refuses any non-loopback URL afterwards: the file
 * is the developer's own local stack, never the hosted project. A missing file is not an error (CI has none, and the
 * caller's `assertLoopbackUrl` still decides whether the run may proceed); every other read error is rethrown.
 *
 * `parseEnv` from `node:util` replaces the `dotenv` package these suites used to pick up transitively. Like dotenv's
 * `config({ override: true })`, it sets what the file holds over what is already there and expands no variables.
 */
export function loadLocalStackEnv(file = '.env'): void {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return;
    throw err;
  }
  Object.assign(process.env, parseEnv(content));
}

/** A key passed in the environment, never the vitest placeholder. */
export function requireLocalKey(name: string, env: Env = process.env): string {
  const value = env[name];
  if (!value || value === 'dummy-service-role-key') {
    throw new Error(`[local-stack] refusing to run: pass the LOCAL ${name} (supabase status -o env)`);
  }
  return value;
}
