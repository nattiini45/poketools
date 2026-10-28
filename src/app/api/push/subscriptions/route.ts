import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requirePlayer } from '@/lib/auth/helpers';
import { getRequestLocale } from '@/i18n/server';
import { readPushConfig } from '@/lib/push/config';
import { isAllowedPushEndpoint, pushEndpointHost } from '@/lib/push/endpoint';
import { deviceLabelFromUserAgent } from '@/lib/push/user-agent';
import { PUSH_BODY_MAX_BYTES, subscribeBodySchema, unsubscribeBodySchema } from '@/lib/push/validation';
import {
  deletePushSubscriptionByEndpoint,
  deletePushSubscriptionById,
  endpointFingerprint,
  listPushDevices,
  upsertPushSubscription,
  type PushDevice,
} from '@/lib/supabase/queries/push-subscriptions';
import { checkRateLimit, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { ApiResult } from '@/types/api';

// Web Push device registration (docs/push.md, "API"). Every method is authorized by the live `requirePlayer()`
// guard and acts on the guard's player id, never an id from the body.
//
//  GET     the caller's devices { enabled, devices } (label, dates, a fingerprint; never keys or endpoints)
//  POST    subscribe or refresh this browser { endpoint, keys, locale?, replaces? }; an endpoint already stored for
//          another player is re-bound to the caller (one browser, one signed-in player at a time)
//  DELETE  remove one of the caller's own devices { endpoint } or { id }
//
// POST and DELETE refuse a cross-origin request and share a rate limit of 30 per player per 10 minutes. POST also
// refuses (503 push_disabled) while the server has no valid VAPID configuration, and refuses a push service that
// is not on the allow-list (400 push_endpoint_not_allowed): the endpoint is a URL the server later requests.

const PUSH_RATE_BUCKET = 'push-subscription';
const PUSH_RATE_LIMIT = { limit: 30, windowSeconds: 600 } as const;

type DevicesData = { enabled: boolean; devices: PushDevice[] };
type SubscribedData = { subscribed: true; fingerprint: string; dropped: number };
type RemovedData = { removed: true };

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;
  return origin === request.nextUrl.origin;
}

function crossOriginResponse(request: NextRequest): NextResponse<ApiResult<never>> {
  console.error('[api/push/subscriptions] cross-origin push subscription change refused:', request.headers.get('origin'));
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: 'Cross-origin push subscription change refused.', code: 'push_cross_origin' },
    { status: 403 },
  );
}

function invalidResponse(status = 400): NextResponse<ApiResult<never>> {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: 'The push subscription is invalid.', code: 'push_subscription_invalid' },
    { status },
  );
}

/** The parsed JSON body, or `undefined` when it is missing, malformed or larger than {@link PUSH_BODY_MAX_BYTES}. */
async function readBody(request: NextRequest): Promise<unknown> {
  const text = await request.text().catch(() => null);
  if (text === null || text.length === 0 || text.length > PUSH_BODY_MAX_BYTES) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function GET(): Promise<NextResponse<ApiResult<DevicesData>>> {
  try {
    const player = await requirePlayer();
    const devices = await listPushDevices(player.playerId);
    return NextResponse.json<ApiResult<DevicesData>>(
      { success: true, data: { enabled: readPushConfig() !== null, devices } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load push devices', 500, 'push_list_failed');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<SubscribedData>>> {
  try {
    const player = await requirePlayer();
    if (!sameOrigin(request)) return crossOriginResponse(request);

    if (readPushConfig() === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Push alerts are not set up on this site.', code: 'push_disabled' },
        { status: 503 },
      );
    }

    const rate = await checkRateLimit(PUSH_RATE_BUCKET, player.playerId, PUSH_RATE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const raw = await readBody(request);
    const parsed = subscribeBodySchema.safeParse(raw);
    if (!parsed.success) return invalidResponse();
    const body = parsed.data;

    // A distinct code per cause: a valid-looking subscription on a push service we do not accept is not "invalid".
    if (!isAllowedPushEndpoint(body.endpoint) || (body.replaces !== undefined && !isAllowedPushEndpoint(body.replaces))) {
      console.error(
        '[api/push/subscriptions] push service not on the allow-list was refused:',
        pushEndpointHost(body.endpoint),
      );
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'This browser’s push service is not supported.', code: 'push_endpoint_not_allowed' },
        { status: 400 },
      );
    }

    const { dropped } = await upsertPushSubscription({
      playerId: player.playerId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      locale: body.locale ?? getRequestLocale(request),
      userAgentLabel: deviceLabelFromUserAgent(request.headers.get('user-agent')),
    });

    // A re-subscribe replaces its predecessor. Best effort: a stale row is cleaned up by the push service's 410 anyway.
    if (body.replaces !== undefined && body.replaces !== body.endpoint) {
      try {
        await deletePushSubscriptionByEndpoint(player.playerId, body.replaces);
      } catch (err) {
        console.error('[api/push/subscriptions] removing the replaced push subscription failed:', err);
      }
    }

    return NextResponse.json<ApiResult<SubscribedData>>({
      success: true,
      data: { subscribed: true, fingerprint: endpointFingerprint(body.endpoint), dropped },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to save the push subscription', 500, 'push_subscribe_failed');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse<ApiResult<RemovedData>>> {
  try {
    const player = await requirePlayer();
    if (!sameOrigin(request)) return crossOriginResponse(request);

    const rate = await checkRateLimit(PUSH_RATE_BUCKET, player.playerId, PUSH_RATE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    const parsed = unsubscribeBodySchema.safeParse(await readBody(request));
    if (!parsed.success) return invalidResponse();

    const removed =
      'endpoint' in parsed.data
        ? await deletePushSubscriptionByEndpoint(player.playerId, parsed.data.endpoint)
        : await deletePushSubscriptionById(player.playerId, parsed.data.id);
    if (removed === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Push device not found', code: 'push_device_not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResult<RemovedData>>({ success: true, data: { removed: true } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to remove the push device', 500, 'push_unsubscribe_failed');
  }
}
