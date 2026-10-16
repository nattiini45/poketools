import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase/client';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { FORMAT_DEFAULTS } from '@/lib/pkmn/formats';
import { timingSafeCompare } from '@/lib/utils/crypto';
import type { BaseFormat } from '@/types/ruleset';
import type { ApiResult } from '@/types/api';

/**
 * POST /api/seed-rulesets
 *
 * Seeds the rulesets table with standard Smogon formats from FORMAT_DEFAULTS.
 * Only inserts formats that don't already exist (matched by name).
 * Requires admin auth. Falls back to BOOTSTRAP_SECRET only when
 * BOOTSTRAP_MODE_ENABLED=true (for first-time setup before any admin exists).
 * Safe to call multiple times (idempotent).
 */
export async function POST(request: NextRequest) {
  try {
    // Primary auth: admin session
    let authenticated = false;
    try {
      await requireAdmin();
      authenticated = true;
    } catch {
      // Fall through to bootstrap secret check
    }

    // Fallback: bootstrap secret (only when explicitly enabled)
    if (!authenticated) {
      const bootstrapEnabled = process.env.BOOTSTRAP_MODE_ENABLED === 'true';
      if (!bootstrapEnabled) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'Admin authentication required.', code: 'seed_rulesets_admin_required' },
          { status: 403 }
        );
      }

      const body = await request.json().catch(() => ({})) as Record<string, unknown>;
      const secret = typeof body.secret === 'string' ? body.secret : '';
      const expectedSecret = process.env.BOOTSTRAP_SECRET;

      if (!expectedSecret || !secret || !timingSafeCompare(secret, expectedSecret)) {
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
