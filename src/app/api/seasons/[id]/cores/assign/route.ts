/**
 * Core Liga: random-assign cores to every participant.
 *
 * POST — admin-only. Reads the curated pool from the season and the current
 * participants, runs the seeded Fisher-Yates shuffle, and writes the resulting
 * `core_types` (+ `core_assigned_at`) onto every participant row.
 *
 * Body:
 *   {
 *     "force": boolean,        // re-roll even participants who already have one
 *     "seed": number            // optional integer seed (for tests/replays)
 *   }
 *
 * Idempotent when force = false: participants who already have a core are
 * skipped and their existing triples are removed from the available pool.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { seasonAssignCoresSchema, formatZodErrors } from '@/lib/validation';
import {
  getCorePool,
  getSeasonParticipants,
  setParticipantCores,
} from '@/lib/supabase/queries/seasons';
import { assignCoresFromPool } from '@/lib/season/core-assignment';
import { expireSeasonReads } from '@/lib/revalidation';
import type { ApiResult } from '@/types/api';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface AssignResponse {
  assignments: Array<{ playerId: string; coreTypes: [string, string, string] }>;
  /** How many participants ended up assigned (skipped ones not included). */
  assignedCount: number;
  /** How many participants kept their existing core (force = false only). */
  skippedCount: number;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    await requireResourceAdmin('season', id);
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID');
    if (invalidId) return invalidId;

    const rawBody = await request.json().catch(() => ({}));
    const zodResult = seasonAssignCoresSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 },
      );
    }
    const { force, seed } = zodResult.data;

    const [pool, participants] = await Promise.all([
      getCorePool(id),
      getSeasonParticipants(id),
    ]);

    if (!pool || pool.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Season has no core pool configured', code: 'core_pool_missing' },
        { status: 400 },
      );
    }

    if (participants.length === 0) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'Season has no participants to assign cores to',
          code: 'core_no_participants',
        },
        { status: 400 },
      );
    }

    // CoreAssignmentError propagates to the outer catch; safeErrorResponse
    // passes its specific message + code through (UserFacingError).
    const assignments = assignCoresFromPool(
      participants.map((p) => ({ playerId: p.id, coreTypes: p.core_types })),
      pool,
      { force, seed },
    );

    await setParticipantCores(id, assignments);
    expireSeasonReads(id);

    const body: AssignResponse = {
      assignments: assignments.map((a) => ({ playerId: a.playerId, coreTypes: a.coreTypes })),
      assignedCount: assignments.length,
      skippedCount: participants.length - assignments.length,
    };

    return NextResponse.json<ApiResult<AssignResponse>>({ success: true, data: body });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to assign cores');
  }
}
