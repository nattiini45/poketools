import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getActiveRoles, bulkCreateRoles } from '@/lib/supabase/queries/team-roles';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { TeamRole } from '@/types/format-rules';
import { teamRoleImportSchema } from '@/lib/validation/schemas';

/**
 * GET /api/team-roles
 * Get all active team roles. Optionally filter by species_form query param.
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<ApiResult<TeamRole[]>>> {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const speciesForm = searchParams.get('species_form');

    let roles: TeamRole[];
    if (speciesForm) {
      const { getRolesForSpecies } = await import('@/lib/supabase/queries/team-roles');
      roles = await getRolesForSpecies(speciesForm);
    } else {
      roles = await getActiveRoles();
    }

    return NextResponse.json({ success: true, data: roles });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch team roles');
  }
}

/**
 * POST /api/team-roles
 * Bulk import team roles. Admin only.
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiResult<{ imported: number }>>> {
  try {
    await requireAdmin();

    const body = await request.json();
    const parsed = teamRoleImportSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `Validation failed: ${issues}`, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const imported = await bulkCreateRoles(parsed.data.roles);
    // The league matchup page reads the role catalogue from the public read cache.
    expirePublicTags([publicTags.teamRoles]);
    return NextResponse.json({ success: true, data: { imported } }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import team roles');
  }
}
