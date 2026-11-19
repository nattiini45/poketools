import { NextRequest, NextResponse } from 'next/server';
import { getMoveNatDex } from '@/lib/pkmn/dex';
import { getApprovedEntityNotes } from '@/lib/supabase/queries/wiki-entity-notes';
import { buildWikiMoveEntry } from '@/lib/wiki/entries';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';

// Public: no auth required — wiki entries are public dex data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const resolved = getMoveNatDex(decodeURIComponent(name));
  if (!resolved) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Move not found', code: 'wiki_move_not_found' },
      { status: 404 },
    );
  }

  const { entity: move, resolvedGen } = resolved;
  const entry = buildWikiMoveEntry(move, resolvedGen);

  const { notes, cacheable } = await getApprovedEntityNotes('move', move.name);

  return NextResponse.json<ApiResult<{ move: typeof entry; notes: typeof notes }>>(
    { success: true, data: { move: entry, notes } },
    { headers: cacheable ? CACHE.HOUR : CACHE.NONE },
  );
}
