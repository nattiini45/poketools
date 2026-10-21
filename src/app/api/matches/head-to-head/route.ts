import { NextRequest, NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { publicReads, type PublicMatch } from '@/lib/cache/public-reads';
import { loadSupplement, packExtensions } from '@/lib/pack-extensions';
import { isValidUuid } from '@/lib/utils/uuid';
import type { ApiResponse, ApiResult } from '@/types/api';
import type { HeadToHeadSupplement } from '@/types/supplementary-records';

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
 *
 * Pack extensions (docs/format-packs.md, "Pack extensions"): when the active pack has a
 * `supplementaryHeadToHead` provider, the body also carries `supplement` (the pair's earlier
 * records, from player 1's side), resolved per request after the cached read. Without one the
 * body is exactly `{ success, data }` and nothing extra runs.
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
    const supplement = await headToHeadSupplement(ids.player_1_id, ids.player_2_id);
    if (supplement === null) {
      return NextResponse.json<ApiResult<PublicMatch[]>>({ success: true, data });
    }
    return NextResponse.json<ApiResponse<PublicMatch[]> & { supplement: HeadToHeadSupplement }>({
      success: true,
      data,
      supplement,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch head-to-head matches');
  }
}

/** The pair's supplementary record, or null when the active pack has no provider (nothing ran). */
async function headToHeadSupplement(player1Id: string, player2Id: string): Promise<HeadToHeadSupplement | null> {
  const provider = packExtensions.supplementaryHeadToHead;
  const result = await loadSupplement(
    'supplementaryHeadToHead',
    provider ? (ctx) => provider(player1Id, player2Id, ctx) : undefined,
  );
  switch (result.state) {
    case 'absent':
      return null;
    case 'excluded':
      return { state: 'excluded' };
    case 'failed':
      return { state: 'failed' };
    case 'ready':
      return {
        state: 'ready',
        record: result.value
          ? { wins: result.value.wins, draws: result.value.draws, losses: result.value.losses }
          : null,
      };
  }
}
