/**
 * Sends Web Push messages to a player's devices (docs/push.md, "Sending"). Server only.
 *
 * `sendPushToPlayer` / `sendPushToPlayers` NEVER throw: a missing configuration, a failed read or a failing push
 * service is logged and counted, because a notification must not break the write path or the cron that claimed it.
 * Disabled configuration (`readPushConfig() === null`) sends nothing and reads nothing.
 *
 * Per device:
 * - the payload is built for the device's stored language by the caller's `payloadFor(locale)`;
 * - TTL and urgency come from the caller's spec; `topic` is a 32 character hash of the pool so a newer alert
 *   replaces an older one the device has not received yet;
 * - 404 / 410: the endpoint is gone, the row is deleted;
 * - any other failure (push service 4xx/5xx, network, timeout): the failure streak grows and the row is deleted
 *   once it reaches {@link PUSH_FAILURE_LIMIT}; a success clears the streak and stamps `last_success_at`.
 * Logs carry the push service HOST and the status code, never an endpoint, key or payload.
 */
import 'server-only';

import { createHash } from 'node:crypto';
import { sendNotification, type PushSubscription } from 'web-push';
import type { Locale } from '@/i18n/config';
import {
  deletePushSubscriptionsByIds,
  listPushTargets,
  markPushFailure,
  markPushSuccess,
  type PushTarget,
} from '@/lib/supabase/queries/push-subscriptions';
import { readPushConfig, type PushConfig } from './config';
import { pushEndpointHost } from './endpoint';
import type { PushPayload } from './payload';

/** Consecutive failed sends after which a device is forgotten. */
export const PUSH_FAILURE_LIMIT = 5;
/** Parallel requests to push services per fan-out. */
export const PUSH_CONCURRENCY = 8;
/** Socket timeout per request (ms). */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000;
/** Longest a push service keeps an undelivered message (s). */
export const PUSH_MAX_TTL_SECONDS = 24 * 60 * 60;
/** Shortest TTL: a message that expires before the push service can try is pointless. */
export const PUSH_MIN_TTL_SECONDS = 60;

export interface PushSpec {
  /** The message for a device's language. */
  payloadFor(locale: Locale): PushPayload;
  /** Seconds the push service may hold the message (clamped to 60 s .. 24 h). */
  ttlSeconds: number;
  urgency: 'normal' | 'high';
  /** Replaces an undelivered message with the same topic (e.g. the pool id); hashed into a valid Topic header. */
  topicKey: string;
}

export interface PushSendSummary {
  /** Devices a message was attempted for. */
  attempted: number;
  delivered: number;
  /** Devices removed (gone, or past the failure limit). */
  removed: number;
  /** Devices whose send failed (counted, kept or removed). */
  failed: number;
}

const EMPTY: PushSendSummary = Object.freeze({ attempted: 0, delivered: 0, removed: 0, failed: 0 });

/** TTL for an alert that stops mattering at `deadlineAt`: until then, within the clamp. */
export function ttlUntil(deadlineAt: string, now: number = Date.now()): number {
  const deadline = Date.parse(deadlineAt);
  const seconds = Number.isFinite(deadline) ? Math.floor((deadline - now) / 1000) : PUSH_MAX_TTL_SECONDS;
  return Math.min(PUSH_MAX_TTL_SECONDS, Math.max(PUSH_MIN_TTL_SECONDS, seconds));
}

/** A `Topic` header value: URL-safe base64, at most 32 characters (RFC 8030). */
export function pushTopic(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 32);
}

function statusOf(err: unknown): number | null {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const code = (err as { statusCode: unknown }).statusCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

type Outcome =
  | { kind: 'delivered'; id: string }
  | { kind: 'gone'; id: string }
  | { kind: 'failed'; target: PushTarget };

async function sendOne(target: PushTarget, spec: PushSpec, config: PushConfig): Promise<Outcome> {
  const subscription: PushSubscription = { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } };
  try {
    await sendNotification(subscription, JSON.stringify(spec.payloadFor(target.locale)), {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      TTL: Math.min(PUSH_MAX_TTL_SECONDS, Math.max(PUSH_MIN_TTL_SECONDS, Math.floor(spec.ttlSeconds))),
      urgency: spec.urgency,
      topic: pushTopic(spec.topicKey),
      timeout: PUSH_REQUEST_TIMEOUT_MS,
    });
    return { kind: 'delivered', id: target.id };
  } catch (err) {
    const status = statusOf(err);
    if (status === 404 || status === 410) return { kind: 'gone', id: target.id };
    console.error(
      `[push] send failed (${pushEndpointHost(target.endpoint)}, ${status ?? 'no status'}, streak ${target.failureCount + 1}):`,
      err instanceof Error ? err.name : 'unknown error',
    );
    return { kind: 'failed', target };
  }
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * Sends `spec` to every device of the given players. One read for all devices, then a concurrency-limited fan-out,
 * then the bookkeeping writes. Never throws.
 */
export async function sendPushToPlayers(playerIds: readonly string[], spec: PushSpec): Promise<PushSendSummary> {
  try {
    const config = readPushConfig();
    if (!config || playerIds.length === 0) return EMPTY;

    const targets = await listPushTargets([...new Set(playerIds)]);
    if (targets.length === 0) return EMPTY;

    const outcomes = await mapLimited(targets, PUSH_CONCURRENCY, (target) => sendOne(target, spec, config));

    const delivered: string[] = [];
    const remove: string[] = [];
    const bump: PushTarget[] = [];
    for (const outcome of outcomes) {
      if (outcome.kind === 'delivered') delivered.push(outcome.id);
      else if (outcome.kind === 'gone') remove.push(outcome.id);
      else if (outcome.target.failureCount + 1 >= PUSH_FAILURE_LIMIT) remove.push(outcome.target.id);
      else bump.push(outcome.target);
    }

    // Bookkeeping must not fail the caller; each write is logged on its own and the rest still runs.
    const settled = await Promise.allSettled([
      markPushSuccess(delivered),
      deletePushSubscriptionsByIds(remove),
      ...bump.map((target) => markPushFailure(target.id, target.failureCount + 1)),
    ]);
    for (const result of settled) {
      if (result.status === 'rejected') console.error('[push] updating subscription bookkeeping failed:', result.reason);
    }

    return {
      attempted: targets.length,
      delivered: delivered.length,
      removed: remove.length,
      failed: outcomes.filter((o) => o.kind !== 'delivered').length,
    };
  } catch (err) {
    console.error('[push] sending push messages failed:', err);
    return EMPTY;
  }
}

/** Sends `spec` to every device of one player. Never throws. */
export function sendPushToPlayer(playerId: string, spec: PushSpec): Promise<PushSendSummary> {
  return sendPushToPlayers([playerId], spec);
}
