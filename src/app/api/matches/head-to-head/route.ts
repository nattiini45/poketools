import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { publicReads, type PublicMatch } from '@/lib/cache/public-reads';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ApiResult } from '@/types/api';

const ID_PARAMS = ['tournament_id', 'player_1_id', 'player_2_id'] as const;

/**
 * GET /api/matches/head-to-head?tournament_id=&player_1_id=&player_2_id=
 *
 * Public: no auth required — the completed matches between two players in
 * one tournament (or league stage), with their games, oldest first, for the
 * Insights head-to-head card (`HeadToHeadMatrix`).
 *
 * Serves `publicReads.tournamentHeadToHead`: the pair's own matches
 * (tournament, status `completed`, the pair in either seat order), never the
 * tournament's whole match list, so a large stage cannot hide a meeting.
 * The entry is cached for 30 s under the `tournament:<id>` and players tags
 * (expired by every match write), shared by A-vs-B and B-vs-A, and holds
 * `PublicMatch` rows only: no admin notes, submitter or confirmation
 * timestamps are stored or leave this route.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ids: Record<(typeof ID_PARAMS)[number], string> = {
    tournament_id: '',
    player_1_id: '',
    player_2_id: '',
  };

  for (const name of ID_PARAMS) {
    const value = searchParams.get(name);
    if (!value) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `${name} is required`, code: 'MISSING_PARAM', params: { name } },
        { status: 400 }
      );
    }
    if (!isValidUuid(value)) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: `${name} must be a valid UUID`, code: 'INVALID_PARAM', params: { name } },
        { status: 400 }
      );
    }
    ids[name] = value.toLowerCase();
  }

  if (ids.player_1_id === ids.player_2_id) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'player_1_id and player_2_id must differ', code: 'SAME_PLAYER' },
      { status: 400 }
    );
  }

  try {
    const data = await publicReads.tournamentHeadToHead(
      ids.tournament_id,
      ids.player_1_id,
      ids.player_2_id
    );
    return NextResponse.json<ApiResult<PublicMatch[]>>({ success: true, data });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch head-to-head matches');
  }
}
