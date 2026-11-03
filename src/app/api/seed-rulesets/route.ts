import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuthError, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { bootstrapEnvSchema, bootstrapModeEnvSchema, readEnv } from '@/lib/env';
import { logAuditEvent } from '@/lib/audit/log';
import { logger } from '@/lib/logger';
import { seedStandardRulesets } from '@/lib/ruleset-studio/seed-standard';
import { secretsEqual } from '@/lib/utils/crypto';
import { checkRateLimit, getClientRateLimitIp, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { SessionPlayer } from '@/types/auth';
import type { ApiResult } from '@/types/api';

/** Bootstrap-secret attempts per client IP; the same bucket, cap and fail-closed mode as `POST /api/bootstrap`. */
const BOOTSTRAP_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60, failMode: 'closed' } as const;

/** The bootstrap body: only the secret is read; a missing one is refused as an invalid secret. */
const seedBootstrapBodySchema = z.object({ secret: z.string().max(512).optional() });

/**
 * POST /api/seed-rulesets
 *
 * Seeds the site rulesets: one `gallery` ruleset definition (kind `preset`) per standard Smogon format of
 * `SEED_FORMAT_IDS` (88 ids), based on the catalog preset of the same id and published as version 1. The other presets of the catalog (the draft formats, the rest of the National Dex family, the
 * doubles Ubers and Little Cup formats) are starting points, not site rulesets, and are never seeded.
 * Only inserts formats that don't already exist (matched by name).
 * Requires admin auth. Falls back to BOOTSTRAP_SECRET only when
 * BOOTSTRAP_MODE_ENABLED=true (for first-time setup before any admin exists).
 * Safe to call multiple times (idempotent).
 *
 * Only an auth refusal (`AuthError`) falls through to the bootstrap path; any
 * other failure of the admin check (a database error, a timeout) is answered
 * as itself. A body that is not JSON is a 400 `invalid_json`.
 */
export async function POST(request: NextRequest) {
  try {
    // Primary auth: admin session
    let authenticated = false;
    let seeder: SessionPlayer | null = null;
    try {
      seeder = await requireAdmin();
      authenticated = true;
    } catch (err) {
      if (!(err instanceof AuthError)) throw err;
      // Not an admin (or not signed in): fall through to the bootstrap secret check.
    }

    // Fallback: bootstrap secret (only when explicitly enabled)
    if (!authenticated) {
      if (readEnv(bootstrapModeEnvSchema).BOOTSTRAP_MODE_ENABLED !== 'true') {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Admin authentication required.', code: 'seed_rulesets_admin_required' },
          { status: 403 }
        );
      }

      const rate = await checkRateLimit('bootstrap', getClientRateLimitIp(request), BOOTSTRAP_RATE_LIMIT);
      if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

      const body = await readJsonBody(request);
      if (!body.ok) return body.response;
      const parsed = seedBootstrapBodySchema.safeParse(body.value);
      const secret = parsed.success ? (parsed.data.secret ?? '') : '';
      const expectedSecret = readEnv(bootstrapEnvSchema).BOOTSTRAP_SECRET;

      if (!expectedSecret || !secret || !secretsEqual(secret, expectedSecret)) {
        // Value-free: never log the submitted or the expected secret.
        logger.warn('seed-rulesets', 'rejected an invalid bootstrap secret');
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid or missing bootstrap secret.', code: 'seed_rulesets_secret_invalid' },
          { status: 403 }
        );
      }
    }
    const { count } = await seedStandardRulesets();

    if (count === 0) {
      return NextResponse.json<ApiResult<{ message: string }>>({
        success: true,
        data: { message: 'All standard rulesets already exist. Nothing to seed.' },
      });
    }
    revalidatePath('/admin/rulesets');
    logAuditEvent({
      action: 'ruleset.seed',
      actor_id: seeder?.playerId ?? null,
      actor_name: seeder?.name ?? 'bootstrap',
      resource_type: 'ruleset',
      resource_id: null,
      metadata: { count },
    });

    return NextResponse.json<ApiResult<{ message: string; count: number }>>({
      success: true,
      data: {
        message: `Seeded ${count} standard Smogon rulesets.`,
        count,
      },
    }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to seed rulesets');
  }
}
