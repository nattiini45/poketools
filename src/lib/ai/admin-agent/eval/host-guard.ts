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

// ─── The local-stack stages (`--stage exec|e2e`) ─────────────────────

/** What the stack stages need from `supabase status -o json`: the API address and the service-role key. */
export interface LocalStackStatus {
  readonly apiUrl: string;
  readonly serviceRoleKey: string;
}

/**
 * Reads `supabase status -o json` (text, as the CLI printed it; warnings may come before and after the JSON object). The
 * address must be this machine, or the run is refused before a key is looked at. The error names no value. The stack's keys
 * are the only database credentials a run uses: nothing is read from an env file.
 */
export function parseLocalStackStatus(text: string): LocalStackStatus {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed: unknown;
  try {
    parsed = JSON.parse(start === -1 || end < start ? '' : text.slice(start, end + 1));
  } catch {
    throw new EvalHostError('admin-agent eval: could not read the local Supabase stack (run `npx supabase start`, then try again).');
  }
  const row = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const apiUrl = typeof row.API_URL === 'string' ? row.API_URL.trim() : '';
  const key = typeof row.SERVICE_ROLE_KEY === 'string' ? row.SERVICE_ROLE_KEY.trim() : typeof row.SECRET_KEY === 'string' ? row.SECRET_KEY.trim() : '';
  if (apiUrl === '' || key === '') {
    throw new EvalHostError('admin-agent eval: the local Supabase stack did not report its API address and service key (is it running? `npx supabase start`).');
  }
  if (!isLocalUrl(apiUrl)) {
    throw new EvalHostError('admin-agent eval: refusing to run, the Supabase API address of this checkout does not point at this machine. The stack stages run against the local stack only.');
  }
  return { apiUrl, serviceRoleKey: key };
}

/** The approval-token secret of a run. It exists only for the harness (a derived token needs a server secret of at least 16 characters). */
export const EVAL_TOKEN_SECRET = 'admin-agent-eval-local-token-secret';

/**
 * Sets the process environment of an `exec` or `e2e` run, before any module that builds the Supabase client is imported:
 * the local stack's address and key (replacing whatever the shell held), the assistant switched on at phase 1 with the
 * Go-live flag, the audience wide open, and nothing that could reach a hosted project or a paid forecast. Refuses a
 * production build and the hosted-database override. Returns the keys it set.
 */
export function applyStackEnv(env: Record<string, string | undefined>, status: LocalStackStatus): string[] {
  assertLocalSupabaseEnv(env);
  if (env.NODE_ENV === 'production') throw new EvalHostError('admin-agent eval: refusing to run with NODE_ENV=production (a production build skips the hosted-database guard).');
  if (['1', 'true'].includes((env.ADMIN_AGENT_ALLOW_HOSTED ?? '').trim().toLowerCase())) {
    throw new EvalHostError('admin-agent eval: refusing to run with ADMIN_AGENT_ALLOW_HOSTED set; the stack stages never reach a hosted project.');
  }
  const values: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: status.apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    NEXTAUTH_SECRET: EVAL_TOKEN_SECRET,
    NEXT_PUBLIC_ENABLE_KALE_CABBAGE: 'false',
    ADMIN_AGENT_ENABLED: '1',
    ADMIN_AGENT_MAX_PHASE: '1',
    ADMIN_AGENT_GOLIVE: '1',
    ADMIN_AGENT_ROLES: 'any',
    ADMIN_AGENT_BUDGET_CONVERSATION_USD: '5',
    // The usage ledger and the limiters outlive a run (the database is reused until it is reset): a suite of many cases must not
    // meet yesterday's spend or the hourly limits. The run's own dollar ceiling is `--max-cost-usd`.
    ADMIN_AGENT_BUDGET_ADMIN_DAY_USD: '10000',
    ADMIN_AGENT_BUDGET_ADMIN_MONTH_USD: '100000',
    ADMIN_AGENT_BUDGET_GLOBAL_DAY_USD: '100000',
    ADMIN_AGENT_TURNS_PER_HOUR: '1000',
    ADMIN_AGENT_WRITES_PER_HOUR: '1000',
  };
  const set: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    env[key] = value;
    set.push(key);
  }
  // A shell that carries an allow-list or a hosted-looking database variable must not shape the run.
  delete env.ADMIN_AGENT_ALLOWED_PLAYER_IDS;
  return set;
}
