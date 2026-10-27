import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { RulesetStudioError } from '@/lib/ruleset-studio/errors';
import { requireRulesetViewer } from '@/lib/ruleset-studio/guards';
import type { RulesetVersion } from '@/lib/ruleset-studio/library-types';
import { getRulesetVersion } from '@/lib/supabase/queries/ruleset-definitions';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string; no: string }>;
}

/**
 * GET /api/ruleset-definitions/[id]/versions/[no]
 *
 * Admin tiers, for a definition the caller may view. One published version with its document and its frozen effective rules
 * (for the diff against another version and for rebasing a copy). A version number that is not a positive integer names no
 * version.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id, no } = await params;
    const { definition } = await requireRulesetViewer(id);
    const versionNo = /^[1-9][0-9]{0,8}$/.test(no) ? Number(no) : null;
    if (versionNo === null) throw new RulesetStudioError('ruleset_not_found');
    const version = await getRulesetVersion(definition.id, versionNo);
    if (version === null) throw new RulesetStudioError('ruleset_not_found');
    return NextResponse.json<ApiResult<RulesetVersion>>({ success: true, data: version });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load ruleset version');
  }
}
