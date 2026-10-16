import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertValidUuid } from '@/lib/utils/uuid';
import { getAggregateJobStats } from '@/lib/match/aggregate-queue';
import {
  drainPendingAggregateJobs,
  rebuildAggregatesForScope,
} from '@/lib/match/aggregate-rebuild';
import type { ApiError, ApiResult } from '@/types/api';
import type { AggregateScope } from '@/types/game';
import type { AggregateJobStats } from '@/lib/match/aggregate-queue';

export const maxDuration = 300;

const VALID_SCOPE_TYPES = ['tournament', 'league', 'all_time'] as const;
const VALID_ACTIONS = ['drain', 'rebuild'] as const;

type AdminAggregateAction = (typeof VALID_ACTIONS)[number];

interface AdminAggregatePostBody {
  action?: AdminAggregateAction;
  scope_type?: AggregateScope;
  scope_id?: string | null;
  batch_size?: number;
  max_rounds?: number;
}

function parseScopeType(value: unknown): AggregateScope | null {
  if (typeof value !== 'string') return null;
  return VALID_SCOPE_TYPES.includes(value as AggregateScope)
    ? (value as AggregateScope)
    : null;
}

function parseAction(value: unknown): AdminAggregateAction | null {
  if (typeof value !== 'string') return null;
  return VALID_ACTIONS.includes(value as AdminAggregateAction)
    ? (value as AdminAggregateAction)
    : null;
}

function parseOptionalInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

type ScopeError = Pick<ApiError, 'error' | 'code' | 'params'>;

function validateScope(scopeType: AggregateScope, scopeId: string | null | undefined): ScopeError | null {
  if (scopeType === 'all_time') {
    return null;
  }
  if (!scopeId || typeof scopeId !== 'string') {
    return { error: 'scope_id required for tournament and league scopes', code: 'aggregate_scope_id_required' };
  }
  try {
    assertValidUuid(scopeId, scopeType === 'tournament' ? 'tournament ID' : 'season ID');
  } catch {
    return { error: 'scope_id must be a valid UUID', code: 'INVALID_PARAM', params: { name: 'scope_id' } };
  }
  return null;
}

/** GET /api/admin/aggregates — aggregate job queue health */
export async function GET() {
  try {
    await requireAdmin();
    const stats = await getAggregateJobStats();

    return NextResponse.json<ApiResult<{ jobs: AggregateJobStats }>>({
      success: true,
      data: { jobs: stats },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch aggregate job stats');
  }
}

/** POST /api/admin/aggregates — drain pending jobs or rebuild a scope from battle_stats */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => ({}))) as AdminAggregatePostBody;
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'action must be drain or rebuild', code: 'aggregate_action_invalid' },
        { status: 400 }
      );
    }

    if (action === 'drain') {
      const batchSize = parseOptionalInt(body.batch_size, 50, 1, 100);
      const maxRounds = parseOptionalInt(body.max_rounds, 100, 1, 500);
      const result = await drainPendingAggregateJobs({ batchSize, maxRounds });

      return NextResponse.json({
        success: true,
        data: result,
      });
    }

    const scopeType = parseScopeType(body.scope_type);
    if (!scopeType) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: 'scope_type must be tournament, league, or all_time',
          code: 'aggregate_scope_type_invalid',
        },
        { status: 400 }
      );
    }

    const scopeError = validateScope(scopeType, body.scope_id ?? null);
    if (scopeError) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, ...scopeError },
        { status: 400 }
      );
    }

    const scopeId = scopeType === 'all_time' ? null : body.scope_id ?? null;
    const result = await rebuildAggregatesForScope(scopeType, scopeId);

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to run aggregate maintenance');
  }
}
