import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { parsePagination } from '@/lib/api/pagination';
import { z } from 'zod';
import { playerCreateSchema, formatZodErrors } from '@/lib/validation';
import { listPlayers, createPlayer } from '@/lib/supabase/queries/players';
import { DEFAULT_PLAYER_SORT, PLAYER_SORT_COLUMNS, type PlayerSort } from '@/lib/players/player-sort';
import type { ApiResult } from '@/types/api';
import type { Player } from '@/types/player';

/** The directory search term, bounded so a pasted blob cannot become a huge filter. */
const playerSearchSchema = z.string().max(100);

/** `sort` names one of the orderable columns and `dir` its direction; anything else is a 400, not a guess. */
const playerSortSchema = z.object({
  sort: z.enum(PLAYER_SORT_COLUMNS).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
});

/**
 * GET /api/players — the site-admin player directory.
 * `?limit` (1..200, default 50) and `?offset` page the list; `?search` is a
 * case-insensitive contains match on name or Showdown username. `total` is the
 * exact count of matching rows, so the caller can page past the first window.
 * `?sort` (name | discord_id | ps_username | status) and `?dir` (asc | desc)
 * order the list; the default is name ascending, and ties fall back to name
 * and id so a page never repeats or skips a row.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const searchParams = new URL(request.url).searchParams;
    const { limit, offset, search } = parsePagination(searchParams);
    const searchResult = playerSearchSchema.optional().safeParse(search);
    const sortResult = playerSortSchema.safeParse({
      sort: searchParams.get('sort') ?? undefined,
      dir: searchParams.get('dir') ?? undefined,
    });
    const invalid = !searchResult.success ? searchResult.error : !sortResult.success ? sortResult.error : null;
    if (invalid) {
      const issues = formatZodErrors(invalid);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const requested = sortResult.data;
    const sort: PlayerSort | undefined =
      requested?.sort || requested?.dir
        ? {
            column: requested.sort ?? DEFAULT_PLAYER_SORT.column,
            direction: requested.dir ?? DEFAULT_PLAYER_SORT.direction,
          }
        : undefined;

    const { data: players, total } = await listPlayers({ limit, offset, search, sort });
    return NextResponse.json<ApiResult<Player[]>>({
      success: true,
      data: players,
      total,
    } as ApiResult<Player[]> & { total: number });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch players');
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const rawBody = await request.json();
    const zodResult = playerCreateSchema.safeParse(rawBody);

    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    const player = await createPlayer(zodResult.data);
    return NextResponse.json<ApiResult<Player>>({ success: true, data: player }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create player');
  }
}
