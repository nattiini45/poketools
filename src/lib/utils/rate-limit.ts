/**
 * Request rate limiting (code review H8; lead decision 2026-10-18).
 *
 * Two stores, chosen by {@link rateLimitStore} from `RATE_LIMIT_STORE`
 * (validated by `rateLimitEnvSchema` in `src/lib/env.ts`):
 *   - `postgres`: every check is one atomic Postgres call,
 *     `rate_limit_hit(key, window_seconds, max)`
 *     (supabase/migrations/20261018130300_rate_limits.sql), a fixed window per
 *     key shared by every serverless instance and kept across cold starts.
 *     Used when `RATE_LIMIT_STORE=postgres`, or when it is unset on a Vercel
 *     deployment (`VERCEL=1`, production and preview);
 *   - `memory`: a bounded per-process fixed-window counter, no database call.
 *     Used when `RATE_LIMIT_STORE=memory`, and when it is unset anywhere else:
 *     `next dev`, a local `next start` and the capture harness that drives it
 *     (sprites through `/api/proxy-image`, replay frames, calc) must never
 *     spend the hosted Supabase quota (AGENTS.md "Automation never spends the
 *     Supabase quota"). NODE_ENV alone does not decide: a local production
 *     build is still local.
 *
 * Keys are `<bucket>:<sha256(identity), first 32 hex chars>`, so no raw IP or
 * email address is stored. The hash is unsalted: it keeps identities out of
 * plain sight in `rate_limit_buckets` (service_role only), but an IPv4 key can
 * be reversed by brute force (2^32 candidates) by anyone who can read that
 * table. Treat the table as personal data of the same class as request logs,
 * not as anonymised. Pick the identity per route:
 *   - signed-in routes: the player id;
 *   - public routes: {@link getClientIp};
 *   - email-sending auth routes: the client IP and, separately, the normalized
 *     email (two checks), so neither one IP nor one inbox can be flooded.
 *
 * Limiter infra failures (RPC error, malformed reply, no reply within
 * {@link RATE_LIMIT_RPC_TIMEOUT_MS}) are always logged. The
 * route chooses what happens next with `failMode`:
 *   - `'open'` (default): the request proceeds (availability first);
 *   - `'closed'`: {@link RateLimitUnavailableError} (503) is thrown, for routes
 *     whose abuse is worse than an outage (signup / forgot-password send email).
 *
 * The AI and avatar routes keep their own per-player daily RPC limiters
 * (`src/lib/ai/rate-limit.ts`, `src/lib/avatar/rate-limit.ts`).
 */
import 'server-only';

import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { rateLimitEnvSchema, readEnv } from '@/lib/env';
import type { ApiResult } from '@/types/api';

export interface RateLimitResult {
  allowed: boolean;
  /** Hits left in the current window (0 once the limit is reached). */
  remaining: number;
  /** 0 when allowed; otherwise whole seconds until the window resets (at least 1). */
  retryAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Maximum hits per window. */
  limit: number;
  /** Window length in seconds (1 .. 7 days). */
  windowSeconds: number;
  /** What a limiter failure does: `'open'` lets the request through (default), `'closed'` throws a 503. */
  failMode?: 'open' | 'closed';
}

/** The limiter could not be consulted and the route fails closed (503, `errors/common.rate_limit_unavailable`). */
export class RateLimitUnavailableError extends UserFacingError<'rate_limit_unavailable'> {
  constructor() {
    super('This action is temporarily unavailable. Try again in a minute.', {
      code: 'rate_limit_unavailable',
      status: 503,
    });
    this.name = 'RateLimitUnavailableError';
  }
}

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const MAX_WINDOW_SECONDS = 7 * 24 * 60 * 60;

/**
 * Longest wait for `rate_limit_hit` before the limiter counts as unavailable
 * (then `failMode` applies). The limiter sits on the request path of public
 * routes; a slow database must not stall them for the full client timeout.
 */
export const RATE_LIMIT_RPC_TIMEOUT_MS = 1500;

/** Most keys the in-memory store holds before it evicts. */
export const MEMORY_STORE_MAX_KEYS = 10_000;

export type RateLimitStore = 'postgres' | 'memory';

/**
 * The store for this process: `RATE_LIMIT_STORE` when set, else `postgres` on
 * a Vercel deployment (`VERCEL=1`) and `memory` everywhere else. An invalid
 * `RATE_LIMIT_STORE` stops the server at boot (`assertBootEnv` from
 * `src/instrumentation.ts`, lead ruling round 5), so a running server never
 * sees one; this per-call read keeps throwing `MissingEnvError` as the
 * backstop (a misconfiguration is never guessed around).
 */
export function rateLimitStore(source: Record<string, string | undefined> = process.env): RateLimitStore {
  const env = readEnv(rateLimitEnvSchema, source);
  if (env.RATE_LIMIT_STORE) return env.RATE_LIMIT_STORE;
  return env.VERCEL === '1' ? 'postgres' : 'memory';
}

/** Database key for one bucket + identity: the identity is hashed, never stored in clear. */
export function rateLimitKey(bucket: string, identity: string): string {
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `${bucket}:${digest}`;
}

function assertValidCall(bucket: string, options: RateLimitOptions): void {
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new Error(`rate-limit: invalid bucket name "${bucket}"`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error(`rate-limit: limit must be a positive integer (bucket ${bucket})`);
  }
  if (
    !Number.isInteger(options.windowSeconds) ||
    options.windowSeconds < 1 ||
    options.windowSeconds > MAX_WINDOW_SECONDS
  ) {
    throw new Error(`rate-limit: windowSeconds must be 1..${MAX_WINDOW_SECONDS} (bucket ${bucket})`);
  }
}

function limiterUnavailable(
  bucket: string,
  options: RateLimitOptions,
  cause: unknown,
): RateLimitResult {
  const failMode = options.failMode ?? 'open';
  // The identity is never logged (it can be an email or IP address).
  console.error(`[rate-limit] limiter unavailable for bucket "${bucket}" (fail ${failMode}):`, cause);
  if (failMode === 'closed') throw new RateLimitUnavailableError();
  return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
}

function callRateLimitHit(key: string, options: RateLimitOptions) {
  return supabase.rpc('rate_limit_hit', {
    p_key: key,
    p_window_seconds: options.windowSeconds,
    p_max: options.limit,
  });
}

class RateLimitTimeoutError extends Error {
  constructor() {
    super(`rate_limit_hit did not answer within ${RATE_LIMIT_RPC_TIMEOUT_MS} ms`);
    this.name = 'RateLimitTimeoutError';
  }
}

/** `promise`, or a {@link RateLimitTimeoutError} rejection once the timeout passes. */
async function withTimeout<T>(promise: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RateLimitTimeoutError()), RATE_LIMIT_RPC_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve(promise), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── In-memory store (local runs, RATE_LIMIT_STORE=memory) ───────────────

interface MemoryWindow {
  hits: number;
  resetAtMs: number;
}

const memoryWindows = new Map<string, MemoryWindow>();

/** Evicted down to this size, so a full store does not rescan on every new key. */
const MEMORY_STORE_EVICT_TO = Math.floor(MEMORY_STORE_MAX_KEYS * 0.9);

/** Drop expired windows; if the store is still too full, drop the oldest-inserted ones. */
function evictMemoryWindows(nowMs: number): void {
  for (const [key, window] of memoryWindows) {
    if (window.resetAtMs <= nowMs) memoryWindows.delete(key);
  }
  for (const key of memoryWindows.keys()) {
    if (memoryWindows.size <= MEMORY_STORE_EVICT_TO) break;
    memoryWindows.delete(key);
  }
}

function memoryHit(key: string, options: RateLimitOptions): RateLimitResult {
  const nowMs = Date.now();
  let window = memoryWindows.get(key);
  if (!window || window.resetAtMs <= nowMs) {
    memoryWindows.delete(key);
    if (memoryWindows.size >= MEMORY_STORE_MAX_KEYS) evictMemoryWindows(nowMs);
    window = { hits: 0, resetAtMs: nowMs + options.windowSeconds * 1000 };
    memoryWindows.set(key, window);
  }
  window.hits += 1;
  const allowed = window.hits <= options.limit;
  return {
    allowed,
    remaining: Math.max(options.limit - window.hits, 0),
    retryAfterSeconds: allowed ? 0 : Math.max(Math.ceil((window.resetAtMs - nowMs) / 1000), 1),
  };
}

/** Test hook: empty the in-memory store; returns how many keys it held. */
export function resetMemoryRateLimits(): number {
  const size = memoryWindows.size;
  memoryWindows.clear();
  return size;
}

/**
 * Count one hit for `identity` in `bucket` and say whether it is allowed.
 * Programming errors (bad bucket name or options) throw; limiter failures
 * follow `options.failMode` (see the module comment).
 */
export async function checkRateLimit(
  bucket: string,
  identity: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  assertValidCall(bucket, options);
  const key = rateLimitKey(bucket, identity);

  if (rateLimitStore() === 'memory') return memoryHit(key, options);

  let reply: Awaited<ReturnType<typeof callRateLimitHit>>;
  try {
    reply = await withTimeout(callRateLimitHit(key, options));
  } catch (thrown) {
    // A rejected fetch (network failure, request timeout) or no answer within
    // RATE_LIMIT_RPC_TIMEOUT_MS is a limiter failure too.
    return limiterUnavailable(bucket, options, thrown);
  }
  const { data, error } = reply;

  if (error) return limiterUnavailable(bucket, options, error);

  const row = Array.isArray(data) ? data[0] : undefined;
  if (
    !row ||
    typeof row.allowed !== 'boolean' ||
    typeof row.hits !== 'number' ||
    typeof row.retry_after_seconds !== 'number'
  ) {
    return limiterUnavailable(
      bucket,
      options,
      new Error('rate_limit_hit returned no row or a malformed row'),
    );
  }

  return {
    allowed: row.allowed,
    remaining: Math.max(options.limit - row.hits, 0),
    retryAfterSeconds: row.allowed ? 0 : Math.max(row.retry_after_seconds, 1),
  };
}

/** Shared identity of every request without a client address header. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/**
 * The client address as seen by the closest proxy: the LAST `X-Forwarded-For`
 * hop, else `X-Real-IP`, else null. The first hop is whatever the client sent
 * and can be forged per request; the last one is appended by the platform
 * (Vercel always sets the header and overwrites it with the client address,
 * so there the list has one entry).
 */
export function findClientIp(request: Pick<Request, 'headers'>): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter(Boolean);
    const last = hops[hops.length - 1];
    if (last) return last.slice(0, 64);
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  return null;
}

/**
 * {@link findClientIp}, or {@link UNKNOWN_CLIENT_IP} (one shared bucket, for
 * example in local dev without a proxy). A fail-closed limit should use
 * {@link findClientIp} and decide explicitly what a missing address means,
 * instead of putting every such request into one site-wide bucket.
 */
export function getClientIp(request: Pick<Request, 'headers'>): string {
  return findClientIp(request) ?? UNKNOWN_CLIENT_IP;
}

/** The eight hextets of an IPv6 address, or null when it is not one. */
function ipv6Hextets(address: string): string[] | null {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0];
  if (!bare.includes(':') || !/^[0-9a-fA-F:.]+$/.test(bare)) return null;
  const halves = bare.split('::');
  if (halves.length > 2) return null;
  const part = (text: string): string[] => (text === '' ? [] : text.split(':'));
  const head = part(halves[0]);
  const tail = halves.length === 2 ? part(halves[1]) : [];
  // An embedded IPv4 tail (`::ffff:1.2.3.4`) counts as two hextets.
  const last = (halves.length === 2 ? tail : head).at(-1);
  const v4 = last !== undefined && last.includes('.') ? 1 : 0;
  const missing = 8 - head.length - tail.length - v4;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const all = [...head, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...tail];
  return all.every((hextet) => hextet.includes('.') || /^[0-9a-fA-F]{1,4}$/.test(hextet)) ? all : null;
}

/**
 * The identity a per-IP limit is keyed on (issue #33). One IPv6 host commonly holds a whole /64, so keying on the full
 * address lets it reset a limit by changing the low bits: an IPv6 address counts as its /64 prefix. IPv4, an IPv4-mapped
 * IPv6 address and anything that does not parse stay as they are. Audit fields keep the raw address (`findClientIp`).
 */
export function rateLimitIpIdentity(ip: string): string {
  const hextets = ipv6Hextets(ip);
  if (hextets === null) return ip;
  if (hextets.at(-1)?.includes('.')) return ip;
  return `${hextets
    .slice(0, 4)
    .map((hextet) => hextet.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** {@link getClientIp} as a rate-limit identity ({@link rateLimitIpIdentity}). */
export function getClientRateLimitIp(request: Pick<Request, 'headers'>): string {
  const ip = findClientIp(request);
  return ip === null ? UNKNOWN_CLIENT_IP : rateLimitIpIdentity(ip);
}

/**
 * Per-IP limit of a public route (`/api/proxy-image`, `/api/replay-frames`,
 * `/api/broadcast/recap`, the `/api/calc/*` routes).
 * Keyed on {@link findClientIp}. A request without a client address header
 * never happens on the production host (it always sets one); it is a local
 * run without a proxy: `next dev`, a local `next start` or the capture
 * harness driving it. There, with the in-memory store, one shared "unknown"
 * bucket would throttle the harness's own sprite and frame fetches (60 / 30
 * per minute for the whole run) while protecting nothing, so the check is
 * skipped and the request allowed. With the Postgres store (a deployment, or
 * `RATE_LIMIT_STORE=postgres` on purpose) a missing header still shares the
 * `unknown` bucket, with a warning: a deployment that loses the header must
 * not switch the limit off.
 */
export async function checkPublicRateLimit(
  bucket: string,
  request: Pick<Request, 'headers'>,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const ip = findClientIp(request);
  if (ip !== null) return checkRateLimit(bucket, rateLimitIpIdentity(ip), options);
  if (rateLimitStore() === 'memory') {
    assertValidCall(bucket, options);
    return { allowed: true, remaining: options.limit, retryAfterSeconds: 0 };
  }
  console.warn(`[rate-limit] ${bucket}: request has no client IP header; using the shared "${UNKNOWN_CLIENT_IP}" bucket`);
  return checkRateLimit(bucket, UNKNOWN_CLIENT_IP, options);
}

const DOTLESS_DOMAINS: Readonly<Record<string, string>> = { 'gmail.com': 'gmail.com', 'googlemail.com': 'gmail.com' };

/**
 * The inbox an address delivers to, for per-inbox limits (issue #33): trimmed and lower-cased, a `+tag` dropped, and for
 * Gmail the dots of the local part dropped and `googlemail.com` folded into `gmail.com`. Only the limiter key changes; the
 * address itself is stored and mailed as the person typed it.
 */
export function emailIdentity(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf('@');
  if (at <= 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  const folded = DOTLESS_DOMAINS[domain];
  if (folded !== undefined) {
    domain = folded;
    local = local.replaceAll('.', '');
  }
  return `${local}@${domain}`;
}

export interface RateLimitCheck {
  bucket: string;
  identity: string;
  options: RateLimitOptions;
}

/**
 * Run several checks in order (for example per IP, then per email) and return
 * the first denial, or null when every check allows the request. Checks after
 * a denial are not counted.
 */
export async function firstRateLimitDenial(checks: RateLimitCheck[]): Promise<RateLimitResult | null> {
  for (const check of checks) {
    const result = await checkRateLimit(check.bucket, check.identity, check.options);
    if (!result.allowed) return result;
  }
  return null;
}

/**
 * The standard 429 body (`errors/common.rate_limited`) with a `Retry-After`
 * header.
 */
export function rateLimitedResponse(retryAfterSeconds: number): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    {
      success: false,
      error: `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
      code: 'rate_limited',
      params: { seconds: retryAfterSeconds },
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}
