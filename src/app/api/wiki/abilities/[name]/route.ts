import { NextRequest, NextResponse } from 'next/server';
import { getAbilityNatDex } from '@/lib/pkmn/dex';
import { buildWikiAbilityEntry } from '@/lib/wiki/entries';
import { getApprovedEntityNotes } from '@/lib/supabase/queries/wiki-entity-notes';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { WikiAbilityEntry } from '@/types/wiki';

// Public: no auth required — wiki entries are public dex data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  const resolved = getAbilityNatDex(decodeURIComponent(name));
  if (!resolved) {
    return NextResponse.json<ApiResult<never>>(
      { success: false, error: 'Ability not found', code: 'wiki_ability_not_found' },
      { status: 404 },
    );
  }

  const { entity: ability, resolvedGen } = resolved;
  const entry: WikiAbilityEntry = buildWikiAbilityEntry(ability, resolvedGen);

  const { notes, cacheable } = await getApprovedEntityNotes('ability', ability.name);

  return NextResponse.json<ApiResult<{ ability: WikiAbilityEntry; notes: typeof notes }>>(
    { success: true, data: { ability: entry, notes } },
    { headers: cacheable ? CACHE.HOUR : CACHE.NONE },
  );
}
