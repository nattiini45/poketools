import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rulesetUpdateSchema, formatZodErrors } from '@/lib/validation';
import { getRulesetById, updateRuleset, deleteRuleset } from '@/lib/supabase/queries/rulesets';
import type { ApiResult } from '@/types/api';
import type { Ruleset } from '@/types/ruleset';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Public: no auth required
export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ruleset = await getRulesetById(id);

    if (!ruleset) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Ruleset not found', code: 'ruleset_not_found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResult<Ruleset>>({ success: true, data: ruleset });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch ruleset');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireAdmin();
    const rawBody = await request.json();
    const zodResult = rulesetUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const ruleset = await updateRuleset(id, zodResult.data);
    revalidatePath('/admin/rulesets');
    return NextResponse.json<ApiResult<Ruleset>>({ success: true, data: ruleset });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update ruleset');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireAdmin();
    await deleteRuleset(id);
    revalidatePath('/admin/rulesets');
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to delete ruleset');
  }
}
