import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { logAuditEvent } from '@/lib/audit/log';
import { createLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { toPublicRuleset, type PublicRuleset } from '@/lib/ruleset-studio/view';
import { rulesetCreateSchema, formatZodErrors } from '@/lib/validation';
import { listRulesets } from '@/lib/supabase/queries/rulesets';
import type { ApiResult } from '@/types/api';

/**
 * GET /api/rulesets
 *
 * Public: no auth required. The ruleset API keeps its URL and its flat shape (names in `bans`, `additions`, `clauses`), plus
 * the members the studio added (`gen`, `universe`, `allow`, `version`). Each entry is the HEAD version of a ruleset shared
 * with everyone (`league` or `gallery` visibility; private rulesets are not listed), and its `id` is that version's id: the
 * id a league pins. The frozen `rules` are left out (they double the payload and nothing public reads them).
 */
// Public: no auth required
export async function GET() {
  try {
    const rulesets = await listRulesets();
    return NextResponse.json<ApiResult<PublicRuleset[]>>({ success: true, data: rulesets.map(toPublicRuleset) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch rulesets');
  }
}

/**
 * POST /api/rulesets
 *
 * Site admins only: the body of the old ruleset builder (flat names). Creates a gallery ruleset and publishes version 1. The
 * ruleset studio uses `POST /api/ruleset-definitions`.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const rawBody = await request.json();
    const zodResult = rulesetCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const ruleset = await createLegacyRuleset(admin.playerId, zodResult.data);
    revalidatePath('/admin/rulesets');
    logAuditEvent({
      action: 'ruleset.create',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'ruleset',
      resource_id: ruleset.version?.definition_id ?? ruleset.id,
      resource_name: ruleset.name,
      metadata: { via: 'builder', version_id: ruleset.id },
    });
    return NextResponse.json<ApiResult<PublicRuleset>>({ success: true, data: toPublicRuleset(ruleset) }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create ruleset');
  }
}
