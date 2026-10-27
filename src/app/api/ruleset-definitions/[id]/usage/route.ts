import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import type { RulesetUsage } from '@/lib/ruleset-studio/library-types';
import { listUsage } from '@/lib/ruleset-studio/pins';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/ruleset-definitions/[id]/usage
 *
 * Admin tiers, for a definition the caller may view. Which versions leagues and phases pin: counts per version for everyone,
 * names (and ids) of the leagues and phases only for site admins and, for a league-owned ruleset, the admins of that league.
 * An owner of a shared ruleset learns how many leagues use it, not which ones.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { actor, definition } = await requireRulesetViewer(id);
    const usage = await listUsage(actor, definition);
    return NextResponse.json<ApiResult<RulesetUsage>>({ success: true, data: usage });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load ruleset usage');
  }
}
