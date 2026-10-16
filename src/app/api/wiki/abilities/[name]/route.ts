import { NextRequest, NextResponse } from 'next/server';
import { getAbilityNatDex } from '@/lib/pkmn/dex';
import { buildWikiAbilityEntry } from '@/lib/wiki/entries';
import { getApprovedNotes } from '@/lib/supabase/queries/wiki-notes';
import { CACHE } from '@/lib/api/cache';
import type { ApiResult } from '@/types/api';
import type { WikiAbilityEntry, WikiNote } from '@/types/wiki';

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

  let notes: WikiNote[] = [];
  try {
    notes = await getApprovedNotes('ability', ability.name);
  } catch {
    // Non-critical: continue without notes
  }

  return NextResponse.json<ApiResult<{ ability: WikiAbilityEntry; notes: WikiNote[] }>>(
    { success: true, data: { ability: entry, notes } },
    { headers: CACHE.HOUR },
  );
}
