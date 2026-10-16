import { NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { draftErrorResponse } from '@/lib/draft/http';
import { favoriteSchema } from '@/lib/draft/schemas';
import { getFavoriteLineIds, setFavoriteLine } from '@/lib/supabase/queries/drafts-favorites';
import type { ApiResult } from '@/types/api';
import type { LineId } from '@/types/draft-queue';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Favourite lines of the signed-in player (draft-backend §8.1 #16/#17).
 * Favourites belong to the player, not to the pool (one list across the
 * initial draft and the redraft); the route only ever reads or writes the
 * viewer's own list, so it needs no pool read.
 */

/** GET /api/drafts/[id]/favorites — `{ line_ids }` of the viewer. */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    await params;
    const lineIds = await getFavoriteLineIds(player.playerId);
    return NextResponse.json<ApiResult<{ line_ids: LineId[] }>>({ success: true, data: { line_ids: lineIds } });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to load favourite lines');
  }
}

/**
 * PUT /api/drafts/[id]/favorites — body `{ line_id, favorite }`; answers the new
 * `{ line_ids }`. At most 200 favourites (`FAVORITES_LIMIT`). Nothing public
 * changes (route-tag EXEMPT).
 */
export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const player = await requirePlayer();
    await params;
    const body = favoriteSchema.parse(await request.json());
    const lineIds = await setFavoriteLine(player.playerId, body.line_id, body.favorite);
    return NextResponse.json<ApiResult<{ line_ids: LineId[] }>>({ success: true, data: { line_ids: lineIds } });
  } catch (err) {
    return draftErrorResponse(err, 'Failed to save the favourite line');
  }
}
