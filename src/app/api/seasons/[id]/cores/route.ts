/**
 * Core Liga cores endpoint.
 *
 * GET: public — returns the curated pool and every participant's assigned
 *      triple (or null when not yet assigned). Used by the league hub and
 *      teambuilder to show each player their core.
 *
 * PATCH: admin — replaces the season's curated core pool.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonCorePoolUpdateSchema, formatZodErrors } from '@/lib/validation';
import {
  getCorePool,
  getSeasonParticipants,
  setCorePool,
} from '@/lib/supabase/queries/seasons';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import type { CoreTriple } from '@/types/season';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CoresResponse {
  pool: CoreTriple[] | null;
  participants: Array<{
    playerId: string;
    playerName: string;
    coreTypes: CoreTriple | null;
    coreAssignedAt: string | null;
  }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    // Public: no auth required — cores are shown on the league hub.
    const { id } = await params;
    const [pool, participants] = await Promise.all([
      getCorePool(id),
      getSeasonParticipants(id),
    ]);

    const body: CoresResponse = {
      pool,
      participants: participants.map((p) => ({
        playerId: p.id,
        playerName: p.name,
        coreTypes: p.core_types,
        coreAssignedAt: p.core_assigned_at,
      })),
    };

    return NextResponse.json<ApiResult<CoresResponse>>({ success: true, data: body });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch core data');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const rawBody = await request.json().catch(() => null);
    const zodResult = seasonCorePoolUpdateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }

    await setCorePool(id, zodResult.data.core_pool);
    expireSeasonReads(id);
    return NextResponse.json<ApiResult<null>>({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update core pool');
  }
}
