/**
 * Rate limits of the public auth endpoints (code review H8; lead decision 2026-10-18).
 *
 * Each endpoint is limited per client IP and, where the request names an email
 * address, per normalized email as well, so neither one IP nor one inbox can be
 * flooded. The routes that send email to an arbitrary address (signup,
 * forgot-password, resend-verification) fail CLOSED when the limiter is down
 * (503 `rate_limit_unavailable`): an unthrottled SMTP path can exhaust the
 * project-wide email quota and lock every user out of confirmations and
 * resets. Everything else fails open.
 *
 * GoTrue keeps its own per-IP limits, but server-side calls reach it from the
 * app's egress address, so those buckets are shared by every visitor and are
 * not a per-client control.
 */
import {
  emailIdentity,
  findClientIp,
  firstRateLimitDenial,
  UNKNOWN_CLIENT_IP,
  type RateLimitCheck,
  type RateLimitOptions,
  type RateLimitResult,
} from '@/lib/utils/rate-limit';

const HOUR = 60 * 60;
const QUARTER_HOUR = 15 * 60;

export type AuthRateLimitedAction =
  | 'signup'
  | 'forgot-password'
  | 'resend-verification'
  | 'reset-password'
  | 'confirm-email'
  | 'signin';

interface AuthLimitProfile {
  ip: RateLimitOptions;
  /** Present when the action carries an email address. */
  email?: RateLimitOptions;
}

export const AUTH_RATE_LIMITS: Readonly<Record<AuthRateLimitedAction, AuthLimitProfile>> = {
  signup: {
    ip: { limit: 10, windowSeconds: HOUR, failMode: 'closed' },
    email: { limit: 3, windowSeconds: HOUR, failMode: 'closed' },
  },
  'forgot-password': {
    ip: { limit: 10, windowSeconds: HOUR, failMode: 'closed' },
    email: { limit: 3, windowSeconds: HOUR, failMode: 'closed' },
  },
  'resend-verification': {
    ip: { limit: 10, windowSeconds: HOUR, failMode: 'closed' },
    email: { limit: 3, windowSeconds: HOUR, failMode: 'closed' },
  },
  'reset-password': {
    ip: { limit: 10, windowSeconds: QUARTER_HOUR },
  },
  'confirm-email': {
    ip: { limit: 10, windowSeconds: QUARTER_HOUR },
  },
  // Password sign-in (NextAuth Credentials): brute-force surface, per IP only.
  // No per-email bucket on purpose: anyone who knows an address could spend
  // it and lock the owner out of password sign-in. GoTrue's own password
  // checks remain the per-account control. A request without a client IP
  // header (never on the production host, which always sets it; only a local
  // run without a proxy) shares the one "unknown" bucket: skipping the check
  // there would switch the brute-force brake off for exactly the requests
  // whose origin is unknown. The same holds for reset-password and
  // confirm-email.
  signin: {
    ip: { limit: 30, windowSeconds: QUARTER_HOUR },
  },
};

/**
 * Count one attempt of `action` for the request's client IP (and `email`,
 * when given and the action has an email limit). Returns the first denial,
 * or null when the attempt is allowed. A fail-closed limiter outage throws
 * `RateLimitUnavailableError` (503 through `safeErrorResponse`).
 */
export async function checkAuthRateLimit(
  action: AuthRateLimitedAction,
  request: Pick<Request, 'headers'>,
  email?: string,
): Promise<RateLimitResult | null> {
  const profile = AUTH_RATE_LIMITS[action];
  const emailCheck: RateLimitCheck | null =
    profile.email && email
      ? { bucket: `${action}-email`, identity: emailIdentity(email), options: profile.email }
      : null;
  const ip = findClientIp(request);
  const checks: RateLimitCheck[] = [];

  if (ip !== null) {
    checks.push({ bucket: `${action}-ip`, identity: ip, options: profile.ip });
  } else if (emailCheck) {
    // No client address header (the production host always sets one). Do not
    // put every such request into one site-wide IP bucket: with a 10/hour
    // fail-closed limit that would cap signups for everyone. The per-email
    // check below still applies.
    console.warn(`[rate-limit] ${action}: request has no client IP header; per-IP check skipped, per-email check applies`);
  } else {
    console.warn(`[rate-limit] ${action}: request has no client IP header; using the shared "${UNKNOWN_CLIENT_IP}" bucket`);
    checks.push({ bucket: `${action}-ip`, identity: UNKNOWN_CLIENT_IP, options: profile.ip });
  }
  if (emailCheck) checks.push(emailCheck);
  return firstRateLimitDenial(checks);
}
