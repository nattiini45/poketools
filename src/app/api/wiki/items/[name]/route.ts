import { NextRequest, NextResponse } from 'next/server';
import { getItemNatDex } from '@/lib/pkmn/dex';
import { buildWikiItemEntry } from '@/lib/wiki/entries';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { WikiItemEntry, WikiNote } from '@/types/wiki';

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

  let notes: WikiNote[] = [];
  try {
    notes = await getApprovedNotes('item', item.name);
  } catch {
    // Non-critical: continue without notes
  }

  return NextResponse.json<ApiResult<{ item: WikiItemEntry; notes: WikiNote[] }>>(
    { success: true, data: { item: entry, notes } },
    { headers: CACHE.HOUR },
  );
}
