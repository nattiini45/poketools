import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { bulkCreateRoles } from '@/lib/supabase/queries/team-roles';
import { validateTeamRoleImport, type TeamRoleImportReport } from '@/lib/import/team-roles-xlsx';
import { fileToBuffer, assertXlsxMagicBytes, validateXlsxFile } from '@/lib/import/xlsx-upload';
import { expirePublicTags, publicTags } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';

interface ImportResponse {
  report: TeamRoleImportReport;
  dry_run: boolean;
  imported: number;
}

/**
 * POST /api/admin/import/team-roles
 * Import team roles from the league workbook's role sheets (format pack `workbook.teamRoles`).
 * Multipart fields: file (.xlsx), dry_run (optional "true")
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<ImportResponse>>> {
  try {
    await requireAdmin();

    const formData = await request.formData();
    const file = formData.get('file');
    const dryRun = formData.get('dry_run') === 'true';

    const fileErr = validateXlsxFile(file instanceof File ? file : null);
    if (fileErr) {
      return NextResponse.json<ApiResult<never>>({ success: false, ...fileErr }, { status: 400 });
    }

    const buffer = await fileToBuffer(file as File);
    const magicErr = assertXlsxMagicBytes(buffer);
    if (magicErr) {
      return NextResponse.json<ApiResult<never>>({ success: false, ...magicErr }, { status: 400 });
    }
    const { report, roles } = validateTeamRoleImport(buffer);

    if (report.errors.length > 0) {
      return NextResponse.json({
        success: true,
        data: { report, dry_run: true, imported: 0 },
      });
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        data: { report, dry_run: true, imported: 0 },
      });
    }

    const imported = await bulkCreateRoles(roles);
    // The league matchup page reads the role catalogue from the public read cache.
    expirePublicTags([publicTags.teamRoles]);
    return NextResponse.json({
      success: true,
      data: { report, dry_run: false, imported },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to import team roles');
  }
}
