import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { logAuditEvent } from '@/lib/audit/log';
import { leagueTrashBlockError } from '@/lib/league-trash/errors';
import { readExposedRuleset } from '@/lib/ruleset-studio/exposure';
import { deleteLegacyRuleset, updateLegacyRuleset } from '@/lib/ruleset-studio/legacy-bridge';
import { toPublicRuleset, type PublicRuleset } from '@/lib/ruleset-studio/view';
import { rulesetUpdateSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/rulesets/[id]
 *
 * Public: no auth required. `id` is the id of a published ruleset VERSION (what `seasons.ruleset_id` and
 * `tournaments.ruleset_id` hold; a converted ruleset keeps its old id as version 1). The flat shape of the old API, plus the
 * members the studio added; the frozen `rules` are left out. A version is immutable, so the answer for an id never changes.
 *
 * A version of a PRIVATE ruleset is served only while a league or phase pins it (a league's page shows its rules to the
 * public); until then the id is not a capability and the answer is 404.
 */
// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(id, 'INVALID_RULESET_ID');
    if (invalidId) return invalidId;

    const ruleset = await readExposedRuleset(id);

    if (!ruleset) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Ruleset not found', code: 'ruleset_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json<ApiResult<PublicRuleset>>({ success: true, data: toPublicRuleset(ruleset) });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch ruleset');
  }
}

/**
 * PATCH /api/rulesets/[id]
 *
 * Site admins only: the old builder's partial flat body. Publishes the edit as a NEW version of the ruleset `id` belongs to
 * and answers with it (a new id); leagues and phases that pin an older version keep it (`POST
 * /api/ruleset-definitions/[id]/pins` moves them).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_RULESET_ID');
    if (invalidId) return invalidId;
    const rawBody = await request.json();
    const zodResult = rulesetUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    const ruleset = await updateLegacyRuleset(admin.playerId, id, zodResult.data);
    revalidatePath('/admin/rulesets');
    logAuditEvent({
      action: 'ruleset.publish',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'ruleset',
      resource_id: ruleset.version?.definition_id ?? ruleset.id,
      resource_name: ruleset.name,
      metadata: { via: 'builder', version_id: ruleset.id, version_no: ruleset.version?.version_no ?? null },
    });
    return NextResponse.json<ApiResult<PublicRuleset>>({ success: true, data: toPublicRuleset(ruleset) });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update ruleset');
  }
}

/**
 * DELETE /api/rulesets/[id]
 *
 * Site admins only. Deletes the ruleset (all its versions) that `id` belongs to when no league or phase pins one of them
 * (409 `ruleset_in_use` otherwise; a league in the trash that still uses it answers its own 409).
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const admin = await requireAdmin();
    const invalidId = rejectInvalidPathId(id, 'INVALID_RULESET_ID');
    if (invalidId) return invalidId;
    try {
      await deleteLegacyRuleset(admin, id);
    } catch (err) {
      // A league in the trash that still uses the ruleset (its junction table) answers a precise 409.
      throw leagueTrashBlockError(err) ?? err;
    }
    revalidatePath('/admin/rulesets');
    logAuditEvent({
      action: 'ruleset.delete',
      actor_id: admin.playerId,
      actor_name: admin.name,
      resource_type: 'ruleset',
      resource_id: id,
      metadata: { via: 'builder' },
    });
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete ruleset');
  }
}
