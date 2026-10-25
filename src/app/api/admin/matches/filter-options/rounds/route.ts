import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AuthError, requireAnyAdmin } from '@/lib/auth/helpers';
import { getAdminScope, scopeAllowsTournament } from '@/lib/auth/admin-scope';
import { safeErrorResponse } from '@/lib/api/error-response';
import { formatZodErrors } from '@/lib/validation';
import { listAdminMatchRounds } from '@/lib/supabase/queries/matches';
import type { AdminMatchRoundOption } from '@/lib/supabase/queries/matches';
import type { ApiResult } from '@/types/api';

/** Strict: the only parameter is the tournament, and a second one is a 400. */
const roundsQuerySchema = z.strictObject({ tournament_id: z.string().uuid() });

/**
 * GET /api/admin/matches/filter-options/rounds?tournament_id= — the rounds of
 * one tournament (phase), in play order, for the Matches page's Round select.
 * Loaded when a phase is picked, not with the other options. A site admin may
 * ask for any tournament; a resource admin only for one in their scope (403
 * otherwise, never an empty list).
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();
    const scope = await getAdminScope(player);

    const searchParams = new URL(request.url).searchParams;
    // fromEntries defines own properties only, so a `__proto__` key cannot reach the prototype.
    const raw: Record<string, string | string[]> = Object.fromEntries(
      [...new Set(searchParams.keys())].map((key) => {
        const values = searchParams.getAll(key);
        return [key, values.length === 1 ? values[0] : values];
      })
    );
    const parsed = roundsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: issues, code: 'validation_failed', params: { issues } },
        { status: 400 }
      );
    }

    if (!scopeAllowsTournament(scope, parsed.data.tournament_id)) {
      throw new AuthError('Admin access required for this resource', 403, 'forbidden');
    }

    const rounds = await listAdminMatchRounds(parsed.data.tournament_id);
    return NextResponse.json<ApiResult<AdminMatchRoundOption[]>>({ success: true, data: rounds });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to load match rounds');
  }
}
