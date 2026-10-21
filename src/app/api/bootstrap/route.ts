import { NextRequest, NextResponse } from 'next/server';
import { auth, loadSessionPlayer } from '@/auth';
import { supabase } from '@/lib/supabase/client';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { bootstrapSchema, formatZodErrors } from '@/lib/validation';
import { secretsEqual } from '@/lib/utils/crypto';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/utils/rate-limit';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';
import { bootstrapEnvSchema, readEnv } from '@/lib/env';

/** Bootstrap attempts per client IP: a brute-force cap on BOOTSTRAP_SECRET (fails open, logged). */
const BOOTSTRAP_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60 };

/**
 * POST /api/bootstrap
 *
 * Public: no auth required (gated by BOOTSTRAP_SECRET and a signed-in session).
 *
 * First-time setup: promotes the CALLER'S EXISTING player row (created on
 * their first sign-in) to the first admin. Requires:
 *   1. a secret matching BOOTSTRAP_SECRET (constant-time digest compare);
 *   2. no admin exists yet.
 * The eligibility check and the promotion run atomically in
 * `bootstrap_first_admin` (supabase/migrations/20261018130400_bootstrap_first_admin.sql),
 * so concurrent callers cannot both become admin.
 *
 * Once any admin exists the route answers `bootstrap_admin_exists` BEFORE
 * looking at the secret, so it is no longer an oracle for the secret.
 * Attempts are capped per client IP by the request limiter (no fixed sleep).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (!body.ok) return body.response;
    const rawBody = body.value;
    const zodResult = bootstrapSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const expectedSecret = readEnv(bootstrapEnvSchema).BOOTSTRAP_SECRET;
    if (!expectedSecret) {
      console.error('[bootstrap] BOOTSTRAP_SECRET is not set; refusing to bootstrap');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'BOOTSTRAP_SECRET not configured on server.', code: 'bootstrap_not_configured' },
        { status: 500 }
      );
    }

    const rate = await checkRateLimit('bootstrap', getClientIp(request), BOOTSTRAP_RATE_LIMIT);
    if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

    // 1. Eligibility: bootstrap is over for good once any admin exists.
    const { data: admins, error: adminError } = await supabase
      .from('players')
      .select('id')
      .eq('is_admin', true)
      .limit(1);
    if (adminError) throw adminError;
    if ((admins ?? []).length > 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Bootstrap disabled — an admin already exists. Ask an admin to grant roles in the admin panel.',
          code: 'bootstrap_admin_exists',
        },
        { status: 403 }
      );
    }

    // 2. Secret.
    if (!secretsEqual(zodResult.data.secret, expectedSecret)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Invalid or missing bootstrap secret.', code: 'bootstrap_secret_invalid' },
        { status: 403 }
      );
    }

    // 3. The caller's own player row (sign-in creates it).
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'You must be signed in to bootstrap.', code: 'bootstrap_sign_in_required' },
        { status: 401 }
      );
    }
    const player = await loadSessionPlayer(session.provider ?? 'discord', session.user.id);
    if (!player) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Your player profile was not found. Sign out and back in, then try again.',
          code: 'bootstrap_player_missing',
        },
        { status: 409 }
      );
    }

    // 4. Atomic check-and-promote.
    const { data: outcome, error: rpcError } = await supabase.rpc('bootstrap_first_admin', {
      p_player_id: player.playerId,
    });
    if (rpcError) throw rpcError;

    if (outcome === 'admin_exists') {
      // Lost a race with a concurrent bootstrap.
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Bootstrap disabled — an admin already exists. Ask an admin to grant roles in the admin panel.',
          code: 'bootstrap_admin_exists',
        },
        { status: 403 }
      );
    }
    if (outcome === 'player_not_found') {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Your player profile was not found. Sign out and back in, then try again.',
          code: 'bootstrap_player_missing',
        },
        { status: 409 }
      );
    }
    if (outcome !== 'promoted') {
      throw new Error(`bootstrap_first_admin returned an unexpected outcome: ${String(outcome)}`);
    }

    logAuditEvent({
      actor_id: player.playerId,
      actor_name: player.name,
      action: 'player.role.assign',
      resource_type: 'player',
      resource_id: player.playerId,
      resource_name: player.name,
      changes: { is_admin: { before: false, after: true } },
      metadata: { via: 'bootstrap' },
      ip_address: getClientIp(request),
    });

    return NextResponse.json<ApiResult<{ message: string; playerId: string }>>({
      success: true,
      data: {
        message: `"${player.name}" is now the first admin! Sign out and back in for the session to update.`,
        playerId: player.playerId,
      },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Bootstrap failed');
  }
}
