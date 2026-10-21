import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { assertValidUuid } from '@/lib/utils/uuid';
import {
  ensureStandardTestPlayers,
  listTestAccounts,
  resetTestAccountData,
  removeTestPlayerFromSeason,
  mintLoginCredentials,
  clearLoginCredentials,
  deleteTestOnlyMatches,
} from '@/lib/supabase/queries/test-accounts';
import type { ApiError, ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

type TestPlayerAction =
  | 'ensure'
  | 'reset'
  | 'remove_from_league'
  | 'mint_login'
  | 'clear_login'
  | 'delete_test_matches';

const VALID_ACTIONS: TestPlayerAction[] = [
  'ensure',
  'reset',
  'remove_from_league',
  'mint_login',
  'clear_login',
  'delete_test_matches',
];

interface TestPlayerPostBody {
  action?: string;
  player_id?: string;
  season_id?: string;
}

function parseAction(value: unknown): TestPlayerAction | null {
  if (typeof value !== 'string') return null;
  return VALID_ACTIONS.includes(value as TestPlayerAction)
    ? (value as TestPlayerAction)
    : null;
}

type UuidError = Pick<ApiError, 'error' | 'code' | 'params'>;

function validateUuid(value: unknown, label: string): UuidError | null {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `${label} required`, code: 'admin_param_required', params: { name: label } };
  }
  try {
    assertValidUuid(value, label);
  } catch {
    return { error: `${label} must be a valid UUID`, code: 'INVALID_PARAM', params: { name: label } };
  }
  return null;
}

/** GET /api/admin/test-players — list all test accounts. */
export async function GET() {
  try {
    await requireAdmin();
    const testAccounts = await listTestAccounts();
    return NextResponse.json<ApiResult<{ players: Player[] }>>({
      success: true,
      data: { players: testAccounts },
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch test accounts');
  }
}

/**
 * POST /api/admin/test-players — manage the 14 standard dummy players and their
 * test data. Actions: ensure | reset | remove_from_league | mint_login |
 * clear_login | delete_test_matches.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin();

    const body = (await request.json().catch(() => ({}))) as TestPlayerPostBody;
    const action = parseAction(body.action);
    if (!action) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          error: `action must be one of: ${VALID_ACTIONS.join(', ')}`,
          code: 'test_player_action_invalid',
          params: { actions: VALID_ACTIONS.join(', ') },
        },
        { status: 400 },
      );
    }

    if (action === 'ensure') {
      const players = await ensureStandardTestPlayers();
      return NextResponse.json({
        success: true,
        data: { ensured: players.length, players },
      });
    }

    if (action === 'delete_test_matches') {
      const err = validateUuid(body.season_id, 'season_id');
      if (err) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, ...err },
          { status: 400 },
        );
      }
      const result = await deleteTestOnlyMatches(body.season_id!);
      return NextResponse.json({ success: true, data: result });
    }

    // Player-targeted actions require a player_id.
    const playerErr = validateUuid(body.player_id, 'player_id');
    if (playerErr) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, ...playerErr },
        { status: 400 },
      );
    }
    const playerId = body.player_id!;

    if (action === 'reset') {
      await resetTestAccountData(playerId);
      return NextResponse.json({ success: true, data: { reset: playerId } });
    }

    if (action === 'remove_from_league') {
      const seasonErr = validateUuid(body.season_id, 'season_id');
      if (seasonErr) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, ...seasonErr },
          { status: 400 },
        );
      }
      await removeTestPlayerFromSeason(body.season_id!, playerId);
      return NextResponse.json({
        success: true,
        data: { removed: playerId, season_id: body.season_id },
      });
    }

    if (action === 'mint_login') {
      const credentials = await mintLoginCredentials(playerId);
      return NextResponse.json({ success: true, data: credentials });
    }

    // clear_login
    await clearLoginCredentials(playerId);
    return NextResponse.json({ success: true, data: { cleared: playerId } });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to manage test accounts');
  }
}
