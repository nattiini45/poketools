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
import { createPoolEntry, getPoolEntries } from '@/lib/supabase/queries/draft-pool-entries';
import { isDuplicatePoolEntry, syncPoolEntries } from '@/lib/draft/pool-entry-sync';
import { toID } from '@/lib/pkmn/i18n/id';
import type { ApiResult } from '@/types/api';
import type { EvolutionTier, EvolutionTierFormData } from '@/types/evolution';
import { evolutionCreateSchema, formatZodErrors } from '@/lib/validation';
import { UserFacingError } from '@/lib/api/user-facing-error';

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
        const existing = await getPoolEntries(seasonId);
        // Compared by id, as the picks route does: a second spelling of a listed Pokémon is no new pool entry.
        const seen = new Set(existing.map((e) => toID(e.pokemon_name)));
        const newEntries = nonWildcards
          .filter((i) => {
            const id = toID(i.base_pokemon);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .map((i) => ({
            season_id: i.season_id,
            pokemon_name: i.base_pokemon,
            power_tier: i.power_tier ?? null,
          }));
        const unresolved = await syncPoolEntries(seasonId, newEntries);
        if (unresolved.length > 0) {
          // The tiers are committed; success would hide Pokémon that have a tier but no pool entry.
          throw new UserFacingError(
            `The tiers were saved, but ${unresolved.join(', ')} could not be added to the draft pool. Add them to the pool list by hand.`,
            {
              code: 'evolution_pool_sync_incomplete',
              params: { pokemon: unresolved.join(', '), count: unresolved.length },
              status: 500,
            },
          );
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
      const baseId = toID(input.base_pokemon);
      const existing = (await getPoolEntries(input.season_id)).find((e) => toID(e.pokemon_name) === baseId);
      if (!existing) {
        try {
          await createPoolEntry({
            season_id: input.season_id,
            pokemon_name: input.base_pokemon,
            power_tier: input.power_tier ?? null,
          });
        } catch (err) {
          // A concurrent writer listed it meanwhile: the entry the sync wants exists, and the tier is already saved.
          if (!isDuplicatePoolEntry(err)) throw err;
        }
      }
    }

    return NextResponse.json({ success: true, data: tier }, { status: 201 });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to create evolution tier');
  }
}
