import { NextRequest, NextResponse } from 'next/server';
import { getItemNatDex } from '@/lib/pkmn/dex';
import { buildWikiItemEntry } from '@/lib/wiki/entries';
import { getApprovedEntityNotes } from '@/lib/supabase/queries/wiki-entity-notes';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { WikiItemEntry } from '@/types/wiki';

// Public: no auth required — wiki entries are public dex data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const resolved = getItemNatDex(decodeURIComponent(name));
  if (!resolved) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Item not found', code: 'wiki_item_not_found' },
      { status: 404 },
    );
  }

  const { entity: item, resolvedGen } = resolved;
  const entry: WikiItemEntry = buildWikiItemEntry(item, resolvedGen);

  const { notes, cacheable } = await getApprovedEntityNotes('item', item.name);

  return NextResponse.json<ApiResult<{ item: WikiItemEntry; notes: typeof notes }>>(
    { success: true, data: { item: entry, notes } },
    { headers: cacheable ? CACHE.HOUR : CACHE.NONE },
  );
}
