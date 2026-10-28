import 'server-only';

import { z } from 'zod';

/**
 * Server environment, validated with zod.
 *
 * Each module validates the group of variables it reads when it evaluates
 * (`readEnv(<group schema>)`), so a module only demands what it uses and a
 * build or test that never loads it does not need its keys. One call reports
 * EVERY missing or invalid key of its group at once, instead of stopping at
 * the first one. The message names keys and a fix, never a value.
 *
 * Request-time reads of a single key keep using `requireEnv`.
 */

/** A required string: unset, empty and whitespace-only all count as missing. The raw value is kept. */
const required = z.string().refine((value) => value.trim() !== '', { message: 'missing' });

/** An http(s) URL (the hosted project or the local `supabase start` stack). */
const httpUrl = required.pipe(z.url({ protocol: /^https?$/, message: 'not an http(s) URL' }));

/** Read by the service-role client (`src/lib/supabase/client.ts`) at import time. */
export const supabaseServerEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  SUPABASE_SERVICE_ROLE_KEY: required,
});

/** Read by the stateless GoTrue client (`src/lib/supabase/auth-client.ts`) per request. */
export const supabaseAuthEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required,
});

/** Read by the NextAuth Discord provider (`src/auth.ts`) at import time. */
export const discordOAuthEnvSchema = z.object({
  DISCORD_CLIENT_ID: required,
  DISCORD_CLIENT_SECRET: required,
});

/** Unset, empty and whitespace-only all count as unset; anything else is kept trimmed. */
const optionalTrimmed = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }, schema.optional());

/**
 * Read by the request rate limiter (`src/lib/utils/rate-limit.ts`) to pick its
 * store. `RATE_LIMIT_STORE` is `postgres` (the shared `rate_limit_hit` table)
 * or `memory` (per process, no database call); unset means `postgres` on a
 * Vercel deployment (`VERCEL=1`, set by the platform) and `memory` everywhere
 * else (dev, a local `next start`, the capture harness), so local automation
 * never spends the hosted Supabase quota.
 */
export const rateLimitEnvSchema = z.object({
  RATE_LIMIT_STORE: optionalTrimmed(
    z.enum(['postgres', 'memory'], { message: "must be 'postgres' or 'memory' (or unset)" })
  ),
  VERCEL: optionalTrimmed(z.string()),
});

/**
 * Read by Web Push (`src/lib/push/config.ts`): the VAPID key pair and the contact subject. All three optional on
 * purpose: unset, partial or invalid means push is DISABLED (the server sends nothing and logs one warning), never a
 * boot failure, because most deployments run without it. `config.ts` validates the values themselves (key lengths,
 * that the private key matches the public one, a `mailto:` or https subject) and never logs one.
 */
export const pushEnvSchema = z.object({
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: optionalTrimmed(z.string()),
  VAPID_PRIVATE_KEY: optionalTrimmed(z.string()),
  VAPID_SUBJECT: optionalTrimmed(z.string()),
});

/**
 * The optional variables whose INVALID value must stop the server at boot
 * (lead ruling round 5): `src/instrumentation.ts` runs `assertBootEnv()` when
 * a Node.js server instance starts, so a bad value fails the deployment once,
 * loudly, instead of answering every request that reads it with a 500. Unset
 * stays valid for each of them. The modules keep reading their own group per
 * call (`rateLimitStore`); this only moves the first failure to boot.
 */
export const bootEnvSchemas = [rateLimitEnvSchema] as const;

/** Validate every `bootEnvSchemas` group; throws one `MissingEnvError` listing every failing key. */
export function assertBootEnv(source: EnvSource = process.env): void {
  const problems: Array<{ key: string; reason: string }> = [];
  for (const schema of bootEnvSchemas) {
    try {
      readEnv(schema, source);
    } catch (err) {
      if (!(err instanceof MissingEnvError)) throw err;
      problems.push(...err.problems);
    }
  }
  if (problems.length > 0) throw new MissingEnvError(problems);
}

/**
 * Read by `POST /api/bootstrap` per request. `BOOTSTRAP_SECRET` is optional by
 * design: unset (or empty / whitespace-only) means bootstrap is not configured,
 * which the route answers with 500 `bootstrap_not_configured`. A set value is
 * kept exactly as written (no trimming): it is compared with the caller's
 * secret byte for byte.
 */
export const bootstrapEnvSchema = z.object({
  BOOTSTRAP_SECRET: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().optional()
  ),
});

/**
 * Read by `POST /api/seed-rulesets`: `BOOTSTRAP_MODE_ENABLED=true` lets a
 * caller without an admin session seed the rulesets with `BOOTSTRAP_SECRET`
 * (first-time setup). Unset or `false` disables that path; any other value is
 * a misconfiguration and throws `MissingEnvError` (never guessed around).
 */
export const bootstrapModeEnvSchema = z.object({
  BOOTSTRAP_MODE_ENABLED: optionalTrimmed(
    z.enum(['true', 'false'], { message: "must be 'true' or 'false' (or unset)" })
  ),
});

/** Thrown when required environment variables are missing or invalid. */
export class MissingEnvError extends Error {
  /** Each failing key with its reason (`missing` or why the value is invalid). Never a value. */
  readonly problems: ReadonlyArray<{ key: string; reason: string }>;

  constructor(problems: ReadonlyArray<{ key: string; reason: string }>) {
    const list = problems.map((p) => `${p.key} (${p.reason})`).join(', ');
    // Keeps the `requireEnv` wording, which scripts/run-season-audit.ts classifies.
    super(
      `Missing required environment variables or invalid values: ${list}. ` +
        "Copy .env.example to .env.local and fill them in (README, 'Environment variables')."
    );
    this.name = 'MissingEnvError';
    this.problems = problems;
  }
}

type EnvSource = Record<string, string | undefined>;

/**
 * Validate `schema` against `source` (default `process.env`) and return the
 * typed values unchanged. Throws one `MissingEnvError` listing every failing
 * key of the schema.
 */
export function readEnv<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
  source: EnvSource = process.env
): z.infer<z.ZodObject<Shape>> {
  // Copy only the schema's own keys: `process.env` is an exotic object, and no
  // other variable should reach the parser (or an error message).
  const input: EnvSource = {};
  for (const key of Object.keys(schema.shape)) input[key] = source[key];

  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  const problems = new Map<string, string>();
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0]);
    if (problems.has(key)) continue;
    const value = input[key];
    problems.set(key, value === undefined || value.trim() === '' ? 'missing' : issue.message);
  }
  throw new MissingEnvError([...problems].map(([key, reason]) => ({ key, reason })));
}

/** One required variable, read at request time. Throws when it is unset or empty. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
