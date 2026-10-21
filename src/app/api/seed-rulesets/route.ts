import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/supabase/client';
import { AuthError, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { bootstrapEnvSchema, bootstrapModeEnvSchema, readEnv } from '@/lib/env';
import { FORMAT_DEFAULTS } from '@/lib/pkmn/formats';
import { secretsEqual } from '@/lib/utils/crypto';
import { checkRateLimit, getClientIp, rateLimitedResponse } from '@/lib/utils/rate-limit';
import type { BaseFormat } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';

/** Bootstrap-secret attempts per client IP; the same bucket, cap and fail-closed mode as `POST /api/bootstrap`. */
const BOOTSTRAP_RATE_LIMIT = { limit: 5, windowSeconds: 15 * 60, failMode: 'closed' } as const;

/** The bootstrap body: only the secret is read; a missing one is refused as an invalid secret. */
const seedBootstrapBodySchema = z.object({ secret: z.string().max(512).optional() });

/**
 * POST /api/seed-rulesets
 *
 * Seeds the rulesets table with standard Smogon formats from FORMAT_DEFAULTS.
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
    try {
      await requireAdmin();
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

      const rate = await checkRateLimit('bootstrap', getClientIp(request), BOOTSTRAP_RATE_LIMIT);
      if (!rate.allowed) return rateLimitedResponse(rate.retryAfterSeconds);

      const body = await readJsonBody(request);
      if (!body.ok) return body.response;
      const parsed = seedBootstrapBodySchema.safeParse(body.value);
      const secret = parsed.success ? (parsed.data.secret ?? '') : '';
      const expectedSecret = readEnv(bootstrapEnvSchema).BOOTSTRAP_SECRET;

      if (!expectedSecret || !secret || !secretsEqual(secret, expectedSecret)) {
        // Value-free: never log the submitted or the expected secret.
        console.warn('[seed-rulesets] rejected an invalid bootstrap secret');
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Invalid or missing bootstrap secret.', code: 'seed_rulesets_secret_invalid' },
          { status: 403 }
        );
      }
    }
    // Get existing ruleset names to avoid duplicates
    const { data: existing, error: fetchError } = await supabase
      .from('rulesets')
      .select('name');

    if (fetchError) throw fetchError;

    const existingNames = new Set((existing ?? []).map((r) => r.name));

    const toInsert = Object.entries(FORMAT_DEFAULTS)
      .filter(([key]) => key !== 'blank') // Skip the blank/custom template
      .filter(([, fmt]) => !existingNames.has(fmt.name))
      .map(([key, fmt]) => ({
        name: fmt.name,
        base_format: key as BaseFormat,
        is_doubles: fmt.is_doubles,
        clauses: fmt.clauses,
        banned_pokemon: fmt.banned_pokemon,
        banned_moves: fmt.banned_moves,
        banned_items: fmt.banned_items,
        added_pokemon: [] as string[],
        custom_rules_string: '',
        created_by: null,
      }));

    if (toInsert.length === 0) {
      return NextResponse.json<ApiResult<{ message: string }>>({
        success: true,
        data: { message: 'All standard rulesets already exist. Nothing to seed.' },
      });
    }

    const { data, error: insertError } = await supabase
      .from('rulesets')
      .insert(toInsert)
      .select();

    if (insertError) throw insertError;

    return NextResponse.json<ApiResult<{ message: string; count: number }>>({
      success: true,
      data: {
        message: `Seeded ${data.length} standard Smogon rulesets.`,
        count: data.length,
      },
    }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to seed rulesets');
  }
}
