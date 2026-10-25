import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { adminExportSchema, formatZodErrors, type AdminExportInput } from '@/lib/validation';
import { supabase } from '@/lib/supabase/client';
import { logAuditEvent } from '@/lib/audit/log';
import { checkAndRecordAdminExport } from '@/lib/admin/export-rate-limit';
import { recordsToCsv } from '@/lib/utils/csv';
import { readExportRows } from '@/lib/admin/export-rows';
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

    // Paged under PostgREST `max_rows`, in a total order (`created_at`, then `id`) so pages neither
    // overlap nor skip. All exportable tables carry both columns.
    const result = await readExportRows(
      (from, to, withCount) =>
        supabase
          .from(TABLE_MAP[resource])
          .select('*', withCount ? { count: 'exact' } : undefined)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      limit,
    );
    const data = result.rows;
    const countHeaders = {
      'X-Export-Count': String(data.length),
      'X-Export-Total': String(result.total),
    };

    logAuditEvent({
      actor_id: admin.playerId,
      actor_name: admin.name,
      action: 'admin.export',
      resource_type: resource,
      resource_id: null,
      metadata: { format, count: data.length, total: result.total, limit, truncated: result.limited },
    });

    if (format === 'csv') {
      const csv = recordsToCsv(data);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${resource}_export.csv"`,
          ...countHeaders,
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': rateLimit.reset_at,
        },
      });
    }

    return NextResponse.json<ApiResult<Record<string, unknown>[]>>({
      success: true,
      data,
    }, {
      headers: {
        ...countHeaders,
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': rateLimit.reset_at,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to export data');
  }
}