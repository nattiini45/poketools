import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin, requireAuth } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import {
  getTierList,
  getWildcards,
  getAllTiers,
  createTier,
  bulkCreateTiers,
} from '@/lib/supabase/queries/evolutions';
import { createPoolEntry, getPoolEntry } from '@/lib/supabase/queries/draft-pool-entries';
import type { ApiResult } from '@/types/api';
import type { EvolutionTier, EvolutionTierFormData } from '@/types/evolution';
import { evolutionCreateSchema, formatZodErrors } from '@/lib/validation';

/**
 * GET /api/evolutions?season_id=X&type=all|tiers|wildcards
 * Get evolution tiers for a season.
 */
export async function GET(request: NextRequest): Promise<NextResponse<ApiResult<EvolutionTier[]>>> {
  try {
    await requireAuth();

    const { searchParams } = new URL(request.url);
    const seasonId = searchParams.get('season_id');
    const type = searchParams.get('type') ?? 'all';

    if (!seasonId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'season_id is required', code: 'draft_season_id_required' },
        { status: 400 }
      );
    }

    let tiers: EvolutionTier[];
    switch (type) {
      case 'tiers':
        tiers = await getTierList(seasonId);
        break;
      case 'wildcards':
        tiers = await getWildcards(seasonId);
        break;
      default:
        tiers = await getAllTiers(seasonId);
    }

    return NextResponse.json({ success: true, data: tiers });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch evolution tiers');
  }
}

/**
 * POST /api/evolutions
 * Create evolution tier(s). Admin only.
 *
 * Body: EvolutionTierFormData | EvolutionTierFormData[] (bulk)
 */
export async function POST(request: NextRequest): Promise<NextResponse<ApiResult<EvolutionTier | EvolutionTier[]>>> {
  try {
    const rawBody = await request.json();

    if (Array.isArray(rawBody)) {
      // Bulk create — validate each entry individually
      const items: EvolutionTierFormData[] = [];
      for (const item of rawBody) {
        const zodResult = evolutionCreateSchema.safeParse(item);
        if (!zodResult.success) {
          const issues = formatZodErrors(zodResult.error);
          return NextResponse.json<ApiResult<never>>(
            { success: false, error: issues, code: 'validation_failed', params: { issues } },
            { status: 400 }
          );
        }
        items.push(item as EvolutionTierFormData);
      }
      if (items.length === 0) {
        return NextResponse.json<ApiResult<never>>(
          { success: false, error: 'At least one tier is required', code: 'evolution_tiers_empty' },
          { status: 400 }
        );
      }
      const seasonId = items[0].season_id;
      const hasMixedSeasonIds = items.some((item) => !item.season_id || item.season_id !== seasonId);
      if (hasMixedSeasonIds) {
        return NextResponse.json<ApiResult<never>>(
          {
            success: false,
            error: 'All bulk tiers must share the same season_id',
            code: 'evolution_tiers_mixed_season',
          },
          { status: 400 }
        );
      }

      await requireResourceAdmin('season', seasonId);
      const tiers = await bulkCreateTiers(items);

      // Auto-sync: create matching draft pool entries for non-wildcard tiers
      const nonWildcards = items.filter((i) => !i.player_id);
      if (nonWildcards.length > 0) {
        const { bulkCreatePoolEntries, getPoolEntries } = await import(
          '@/lib/supabase/queries/draft-pool-entries'
        );
        const existing = await getPoolEntries(seasonId);
        const existingNames = new Set(existing.map((e) => e.pokemon_name.toLowerCase()));
        const newEntries = nonWildcards
          .filter((i) => !existingNames.has(i.base_pokemon.toLowerCase()))
          .map((i) => ({
            season_id: i.season_id,
            pokemon_name: i.base_pokemon,
            power_tier: i.power_tier ?? null,
          }));
        if (newEntries.length > 0) {
          await bulkCreatePoolEntries(newEntries);
        }
      }

      return NextResponse.json({ success: true, data: tiers }, { status: 201 });
    }

    // Single create
    const zodResult = evolutionCreateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const input = rawBody as EvolutionTierFormData;
    if (!input.stage2_pokemon) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'stage2_pokemon is required', code: 'evolution_stage2_required' },
        { status: 400 }
      );
    }

    await requireResourceAdmin('season', input.season_id);
    const tier = await createTier(input);

    // Auto-sync: create a matching draft pool entry (skip wildcards — they're player-specific)
    if (!input.player_id) {
      const existing = await getPoolEntry(input.season_id, input.base_pokemon);
      if (!existing) {
        await createPoolEntry({
          season_id: input.season_id,
          pokemon_name: input.base_pokemon,
          power_tier: input.power_tier ?? null,
        });
      }
    }

    return NextResponse.json({ success: true, data: tier }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create evolution tier');
  }
}
