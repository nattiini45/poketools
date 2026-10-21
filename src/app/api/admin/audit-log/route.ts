import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { auditLogQuerySchema, formatZodErrors } from '@/lib/validation';
import { listAuditLogEntries } from '@/lib/audit/queries';
import type { ApiResult } from '@/types/api';

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const rawQuery = Object.fromEntries(request.nextUrl.searchParams.entries());
    const parsed = auditLogQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const result = await listAuditLogEntries(parsed.data);
    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load audit log');
  }
}