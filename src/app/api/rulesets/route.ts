import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rulesetCreateSchema, formatZodErrors } from '@/lib/validation';
import { listRulesets, createRuleset } from '@/lib/supabase/queries/rulesets';
import type { ApiResult } from '@/types/api';
import type { Ruleset } from '@/types/ruleset';

// Public: no auth required
export async function GET() {
  try {
    const rulesets = await listRulesets();
    return NextResponse.json<ApiResult<Ruleset[]>>({ success: true, data: rulesets });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch rulesets');
  }
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const rawBody = await request.json();
    const zodResult = rulesetCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const ruleset = await createRuleset(zodResult.data, admin.playerId);
    revalidatePath('/admin/rulesets');
    return NextResponse.json<ApiResult<Ruleset>>({ success: true, data: ruleset }, { status: 201 });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to create ruleset');
  }
}
