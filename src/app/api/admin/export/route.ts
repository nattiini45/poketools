import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminExportSchema, formatZodErrors, type AdminExportInput } from '@/lib/validation';
import { supabase } from '@/lib/supabase/client';
import { logAuditEvent } from '@/lib/audit/log';
import { checkAndRecordAdminExport } from '@/lib/admin/export-rate-limit';
import { recordsToCsv } from '@/lib/utils/csv';
import type { ApiResult } from '@/types/api';

type ExportResource = AdminExportInput['resource'];

const TABLE_MAP = {
  players: 'players',
  tournaments: 'tournaments',
  matches: 'matches',
  seasons: 'seasons',
  games: 'games',
  battle_stats: 'battle_stats',
} as const satisfies Record<ExportResource, ExportResource>;

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await request.json().catch(() => null);

    const zodResult = adminExportSchema.safeParse(body);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const { resource, format, limit } = zodResult.data;

    const rateLimit = await checkAndRecordAdminExport(admin.playerId);
    if (!rateLimit.allowed) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `Export rate limit reached. Try again after ${rateLimit.reset_at}.`,
          code: 'admin_export_rate_limited',
          params: { resetAt: rateLimit.reset_at },
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimit.reset_at,
          },
        }
      );
    }

    const { data, error } = await supabase
      .from(TABLE_MAP[resource])
      .select('*')
      .limit(limit);

    if (error) throw error;

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'admin.export',
      resource_type: resource,
      resource_id: null,
      metadata: { format, count: data?.length ?? 0, limit },
    });

    if (format === 'csv') {
      const csv = recordsToCsv(data as Record<string, unknown>[]);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${resource}_export.csv"`,
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': rateLimit.reset_at,
        },
      });
    }

    return NextResponse.json<ApiResult<Record<string, unknown>[]>>({
      success: true,
      data: data as Record<string, unknown>[],
    }, {
      headers: {
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': rateLimit.reset_at,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to export data');
  }
}