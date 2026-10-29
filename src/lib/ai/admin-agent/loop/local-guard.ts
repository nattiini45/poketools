/**
 * The hosted-database guard (plan 6.2 "Automation never spends hosted Supabase quota"; AGENTS.md hard rule). The loop, the
 * approve route and every eval entry point run it before they import a route module: outside a production build the
 * database must be local, or `ADMIN_AGENT_ALLOW_HOSTED` must say otherwise out loud. Without it, `npm run dev` against a
 * hosted `.env.local` with the assistant switched on would run Build on the hosted project.
 *
 * Pure: the caller passes the values (the loop's modules do not read the environment themselves). It fails closed: a missing
 * or unparsable URL is not local. The error text names no host and no URL.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class AdminAgentHostedDatabaseError extends Error {
  constructor() {
    super('admin-agent: refusing to run against a non-local database outside a production build (set ADMIN_AGENT_ALLOW_HOSTED to override)');
    this.name = 'AdminAgentHostedDatabaseError';
  }
}

export interface LocalGuardInput {
  /** `NEXT_PUBLIC_SUPABASE_URL`. */
  url: string | undefined;
  /** `NODE_ENV`. */
  nodeEnv: string | undefined;
  /** `ADMIN_AGENT_ALLOW_HOSTED` (parsed). */
  allowHosted: boolean;
}

/** Whether `url` points at this machine. */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Throws `AdminAgentHostedDatabaseError` unless this is a production build, an explicit opt-in, or a local database. */
export function assertLocalDatabase(input: LocalGuardInput): void {
  if (input.nodeEnv === 'production' || input.allowHosted) return;
  if (!isLocalDatabaseUrl(input.url)) throw new AdminAgentHostedDatabaseError();
}
