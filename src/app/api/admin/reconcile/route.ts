import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { readJsonBody } from '@/lib/api/json-body';
import { isValidUuid } from '@/lib/utils/uuid';
import {
  reconcileAllSeasons,
  reconcileSeasonDerivedData,
  type ReconcileReport,
} from '@/lib/reconcile/reconcile-season';
import { reconcileStreaks, type StreaksReconcileReport } from '@/lib/reconcile/reconcile-streaks';
import { logAuditEvent } from '@/lib/audit/log';
import type { ApiResult } from '@/types/api';

export const maxDuration = 300;

const VALID_SCOPES = ['season', 'all', 'streaks'] as const;

type ReconcileScope = (typeof VALID_SCOPES)[number];

interface AdminReconcilePostBody {
  scope?: ReconcileScope;
  season_id?: string;
  repair?: boolean;
}

function parseScope(value: unknown): ReconcileScope | null {
  if (typeof value !== 'string') return null;
  return VALID_SCOPES.includes(value as ReconcileScope) ? (value as ReconcileScope) : null;
}

/**
 * POST /api/admin/reconcile — dry-run (verify) or repair season derived data.
 * The report's `ratings.integrity` lists rating-history gaps and never-rated
 * matches, and in a dry run whether the repair would refuse the ratings step
 * (`repairRefusal`, catalogued `rating_history_incomplete`).
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();

    // Malformed JSON is its own 400 (invalid_json), never silently an empty
    // object that would then fail as a misleading "scope" error.
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const raw = parsed.value;
    // A literal JSON `null` body parses successfully to null — guard before
    // reading fields so it yields a 400, not a 500.
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Request body must be a JSON object', code: 'reconcile_body_not_object' },
        { status: 400 }
      );
    }
    const body = raw as AdminReconcilePostBody;

    // `repair` is optional; default false. When PRESENT it must be a boolean so
    // a non-boolean (e.g. the string "true") is not silently treated as dry-run.
    if ('repair' in body && typeof body.repair !== 'boolean') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'repair must be a boolean', code: 'reconcile_repair_not_boolean' },
        { status: 400 }
      );
    }
    const repair = body.repair === true;

    const scope = parseScope(body.scope);
    if (!scope) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'scope must be season, all or streaks', code: 'reconcile_scope_invalid' },
        { status: 400 }
      );
    }

    const seasonId = body.season_id;
    if (scope === 'streaks') {
      // season_id is optional: absent means every player, present narrows the
      // repair to one season's roster plus the players of its completed
      // matches — the same set the season reconcile covers.
      if (seasonId !== undefined && (typeof seasonId !== 'string' || !isValidUuid(seasonId))) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'season_id must be a valid UUID',
            code: 'INVALID_PARAM',
            params: { name: 'season_id' },
          },
          { status: 400 }
        );
      }

      const result = await reconcileStreaks({ seasonId, repair });
      if (repair) {
        logAuditEvent({
          action: 'match.repair',
          actor_id: admin.playerId,
          actor_name: admin.name,
          resource_type: 'player_streaks',
          resource_id: seasonId ?? null,
          metadata: { scope: 'streaks', season_id: seasonId ?? null, players: result.checked },
        });
      }
      return NextResponse.json<ApiResult<StreaksReconcileReport>>({
        success: true,
        data: result,
      });
    }

    if (scope === 'season') {
      if (!seasonId || typeof seasonId !== 'string') {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'season_id required for season scope', code: 'reconcile_season_id_required' },
          { status: 400 }
        );
      }
      if (!isValidUuid(seasonId)) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'season_id must be a valid UUID',
            code: 'INVALID_PARAM',
            params: { name: 'season_id' },
          },
          { status: 400 }
        );
      }

      const result = await reconcileSeasonDerivedData(seasonId, { repair });
      return NextResponse.json<ApiResult<ReconcileReport>>({
        success: true,
        data: result,
      });
    }

    const result = await reconcileAllSeasons({ repair });
    return NextResponse.json<ApiResult<ReconcileReport[]>>({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to run record reconciliation');
  }
}