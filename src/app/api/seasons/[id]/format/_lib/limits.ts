/**
 * The rate-limit buckets of the live-format routes (`/api/seasons/[id]/format/{me,actions,challenges,adjustments,checks,
 * relations}`): one constant per bucket, the only helper the routes share. Windows follow the sibling routes
 * (`format/route.ts`, `format/engine/route.ts`). The identity is the session player, except `READ_LEAGUE` (the league id).
 *
 * `challenge-make` and `adjust` fail closed: both write rows after a full context load, so an unavailable limiter must
 * not turn them into an unthrottled write path (precedent: the mail routes in `auth/rate-limits.ts`). Every other bucket
 * fails open, availability first.
 */
import type { RateLimitOptions } from '@/lib/utils/rate-limit';

export interface FormatRouteLimit extends RateLimitOptions {
  bucket: string;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/** `GET .../me`: each call loads the whole kit context, so a player gets 30 a minute. */
export const READ_LIMIT: FormatRouteLimit = { bucket: 'format-runtime-read', limit: 30, windowSeconds: MINUTE };
/** `GET .../me`: a league-level ceiling (keyed by the season id), so many accounts cannot add up. */
export const READ_LEAGUE_LIMIT: FormatRouteLimit = { bucket: 'format-runtime-read-league', limit: 300, windowSeconds: MINUTE };
/** The admin reads: adjustment and check lists, the audited unmask. */
export const ADMIN_READ_LIMIT: FormatRouteLimit = { bucket: 'format-runtime-admin-read', limit: 60, windowSeconds: MINUTE };
/** `PUT .../actions/[actionId]` (a draft save). */
export const ACTION_SAVE_LIMIT: FormatRouteLimit = { bucket: 'format-action-save', limit: 60, windowSeconds: 10 * MINUTE };
/** `POST .../actions/[actionId]/submit`. */
export const ACTION_SUBMIT_LIMIT: FormatRouteLimit = { bucket: 'format-action-submit', limit: 30, windowSeconds: HOUR };
/** `POST .../challenges` (the database also caps `max_open`). Fails closed. */
export const CHALLENGE_MAKE_LIMIT: FormatRouteLimit = { bucket: 'format-challenge-make', limit: 20, windowSeconds: HOUR, failMode: 'closed' };
/** `POST .../challenges/[challengeId]/answer` and `DELETE .../challenges/[challengeId]`. */
export const CHALLENGE_WRITE_LIMIT: FormatRouteLimit = { bucket: 'format-challenge-write', limit: 60, windowSeconds: HOUR };
/** `POST .../adjustments`. Fails closed. */
export const ADJUST_LIMIT: FormatRouteLimit = { bucket: 'format-adjust', limit: 120, windowSeconds: HOUR, failMode: 'closed' };
/** `POST .../checks/[checkId]/resolve`. */
export const CHECK_RESOLVE_LIMIT: FormatRouteLimit = { bucket: 'format-check-resolve', limit: 120, windowSeconds: HOUR };
