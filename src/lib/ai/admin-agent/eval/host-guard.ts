/**
 * The eval harness's host and egress guards (plan 7.2 "Harness and isolation", 6.2; AGENTS.md "Automation never spends the
 * Supabase quota").
 *
 * Two layers, both fail closed:
 *  - `assertLocalSupabaseEnv` refuses to start when any database variable names a host that is not this machine. It looks at the
 *    URL variables the route modules and the Supabase client read at import time, so it runs before any import that builds
 *    the singleton client. The error names the variable, never the value.
 *  - `installEgressGuard` wraps `fetch` so that a request to any other host throws instead of leaving the machine. Local
 *    hosts always pass; `api.anthropic.com` passes only when the caller says the run uses the real model.
 *
 * Pure apart from the `fetch` wrapper: callers pass the environment and the target.
 */

/** Hostnames that mean this machine (as `new URL().hostname` prints them). */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The only non-local host a run may reach, and only with the real model port. */
export const MODEL_API_HOST = 'api.anthropic.com';

/** Variables that carry a database or Supabase address. Each one that is set must be local. */
export const DATABASE_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_URL',
  'LOCAL_DB_URL',
  'DATABASE_URL',
  'SUPABASE_DB_URL',
  'POSTGRES_URL',
] as const;

export class EvalHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalHostError';
  }
}

/** Whether `hostname` (as `URL` prints it) is this machine. A `.localhost` name resolves to loopback too. */
export function isLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTS.has(host) || host.endsWith('.localhost');
}

/** Whether `value` is a URL (or connection string) that points at this machine. An unparsable value is not local. */
export function isLocalUrl(value: string): boolean {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Throws `EvalHostError` when a database variable is set to a non-local address. An unset variable is fine: the eval
 * defaults them to the local stack, and nothing without an address can reach a hosted project. A blank value counts as unset.
 */
export function assertLocalSupabaseEnv(env: Readonly<Record<string, string | undefined>>): void {
  const offenders = DATABASE_ENV_KEYS.filter((key) => {
    const value = env[key]?.trim();
    return value !== undefined && value !== '' && !isLocalUrl(value);
  });
  if (offenders.length > 0) {
    throw new EvalHostError(
      `admin-agent eval: refusing to run, ${offenders.join(', ')} ${offenders.length === 1 ? 'does' : 'do'} not point at this machine. ` +
        'The eval runs against the local Supabase stack only (supabase start); it never reaches a hosted project.',
    );
  }
}

export class EvalEgressError extends Error {
  readonly host: string;
  constructor(host: string) {
    super(`admin-agent eval: outbound request to ${host} blocked (only local hosts${host === MODEL_API_HOST ? '' : ' and the model API'} are reachable)`);
    this.name = 'EvalEgressError';
    this.host = host;
  }
}

type FetchLike = (input: never, init?: never) => Promise<unknown>;

/** The hostname a `fetch` input addresses; a relative URL addresses this machine. */
function hostOf(input: unknown): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as { url?: unknown } | null)?.url;
  if (typeof raw !== 'string') return '(unknown)';
  try {
    return new URL(raw, 'http://localhost').hostname.toLowerCase();
  } catch {
    return '(unparsable)';
  }
}

export interface EgressGuardOptions {
  /** True for a run that uses the real model port: `api.anthropic.com` then passes too. */
  allowModelApi: boolean;
  /** Called with the host of each blocked request (for the run summary). */
  onBlocked?: (host: string) => void;
}

/**
 * Wraps `target.fetch` so a request to a host outside the allow-list throws `EvalEgressError` before anything is sent.
 * Returns the function that restores the original. Covers `fetch` (the AI SDK, Supabase and the app's own clients use
 * it); it does not cover raw `node:http` or sockets, which nothing on this path uses.
 */
export function installEgressGuard(target: { fetch: unknown }, options: EgressGuardOptions): () => void {
  const original = target.fetch as FetchLike;
  const guarded: FetchLike = (input, init) => {
    const host = hostOf(input);
    const allowed = isLocalHostname(host) || (options.allowModelApi && host === MODEL_API_HOST);
    if (!allowed) {
      options.onBlocked?.(host);
      return Promise.reject(new EvalEgressError(host));
    }
    return original(input, init);
  };
  target.fetch = guarded;
  return () => {
    target.fetch = original;
  };
}

/**
 * Prepares the process environment of an eval run, before any module that builds the Supabase client is imported:
 * refuses a non-local database, points the unset database variables at the local stack, and switches the paid AI
 * forecast off (an AI call from inside a route would spend money and send league data; plan 7.2). Returns the keys it set.
 */
export function prepareEvalEnv(env: Record<string, string | undefined>): string[] {
  assertLocalSupabaseEnv(env);
  const set: string[] = [];
  const setDefault = (key: string, value: string): void => {
    if (env[key] === undefined || env[key]?.trim() === '') {
      env[key] = value;
      set.push(key);
    }
  };
  // Supabase CLI defaults for `supabase start`. The key is a placeholder: the plan stage never reaches the database.
  setDefault('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  setDefault('SUPABASE_SERVICE_ROLE_KEY', 'eval-local-placeholder-key');
  if (env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE !== 'false') {
    env.NEXT_PUBLIC_ENABLE_KALE_CABBAGE = 'false';
    set.push('NEXT_PUBLIC_ENABLE_KALE_CABBAGE');
  }
  return set;
}
