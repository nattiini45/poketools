import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { resolvePresetRules } from '@/lib/pkmn/preset-rules.server';
import type { PresetRules } from '@/lib/pkmn/preset-rules';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/pkmn/presets/[id]/rules
 *
 * Public: no auth required. The rules a catalog preset implies (clauses, the lists it bans or restricts to, the rule facts),
 * resolved for its mod and universe. Static per deploy, so a CDN may cache it for an hour. The browser needs it to compute
 * the effective rules of a ruleset document exactly as the server does; it never imports the dex.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const rules = resolvePresetRules(id);
    if (rules === null) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Rule preset not found', code: 'ruleset_preset_unknown' },
        { status: 404 },
      );
    }
    return NextResponse.json<ApiResult<PresetRules>>(
      { success: true, data: rules },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400' } },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to resolve the rule preset');
  }
}
