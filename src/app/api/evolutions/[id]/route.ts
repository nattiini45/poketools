import { NextRequest, NextResponse } from 'next/server';
import { requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { getTierById, updateTier, deleteTier } from '@/lib/supabase/queries/evolutions';
import { getPoolEntry, deletePoolEntry } from '@/lib/supabase/queries/draft-pool-entries';
import type { ApiResult } from '@/types/api';
import type { EvolutionTier, EvolutionTierFormData } from '@/types/evolution';
import { evolutionUpdateSchema, formatZodErrors } from '@/lib/validation';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/evolutions/[id]
 * Update an evolution tier's KO thresholds. Admin only.
 */
export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<EvolutionTier>>> {
  try {
    const { id } = await params;
    const tier = await getTierById(id);
    if (!tier) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Evolution tier not found', code: 'evolution_tier_not_found' },
        { status: 404 }
      );
    }
    await requireResourceAdmin('season', tier.season_id);
    const rawBody = await request.json();
    const zodResult = evolutionUpdateSchema.safeParse(rawBody);
    if (!zodResult.success) {
      const issues = formatZodErrors(zodResult.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }
    const body = zodResult.data;

    if (Object.keys(body).length === 0) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'No valid fields to update', code: 'draft_update_empty' },
        { status: 400 }
      );
    }

    const updated = await updateTier(id, body as Partial<Pick<EvolutionTierFormData, 'stage2_kos' | 'stage3_kos' | 'power_tier'>>);

    // Auto-sync: if power_tier changed, update the matching pool entry
    if (body.power_tier && !tier.player_id) {
      const { updatePoolEntry } = await import('@/lib/supabase/queries/draft-pool-entries');
      const poolEntry = await getPoolEntry(tier.season_id, tier.base_pokemon);
      if (poolEntry) {
        await updatePoolEntry(poolEntry.id, { power_tier: body.power_tier });
      }
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to update evolution tier');
  }
}

/**
 * DELETE /api/evolutions/[id]
 * Remove an evolution tier entry. Admin only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse<ApiResult<null>>> {
  try {
    const { id } = await params;
    const tier = await getTierById(id);
    if (!tier) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Evolution tier not found', code: 'evolution_tier_not_found' },
        { status: 404 }
      );
    }
    await requireResourceAdmin('season', tier.season_id);
    await deleteTier(id);

    // Auto-sync: remove matching draft pool entry (only for non-wildcard tiers)
    if (!tier.player_id) {
      const poolEntry = await getPoolEntry(tier.season_id, tier.base_pokemon);
      if (poolEntry) {
        await deletePoolEntry(poolEntry.id);
      }
    }

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to delete evolution tier');
  }
}
