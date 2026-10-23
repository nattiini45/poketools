import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAnyAdmin, requireResourceAdmin } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { toPublicPlayerRef, type PublicPlayerRef } from '@/lib/players/public-player';
import { listPlayers } from '@/lib/supabase/queries/players';
import { formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';

/**
 * One search hit: the public player ref plus the guest flag. `is_guest` is on
 * purpose: the caller is a live-confirmed admin picking players for a roster
 * (`AdminSeasonParticipant` / `AdminTournamentParticipant` carry it for the
 * same audience), and it tells a registered account from a guest row. Nothing
 * else of the `players` row is read into the response.
 */
type PlayerSearchHit = PublicPlayerRef & { is_guest: boolean };

const MAX_LIMIT = 20;
const DEFAULT_LIMIT = 10;

const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(64),
    season_id: z.string().uuid().optional(),
    tournament_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    registered: z.literal('1').optional(),
  })
  .refine((query) => !(query.season_id && query.tournament_id), {
    message: 'season_id and tournament_id are mutually exclusive',
    path: ['tournament_id'],
  });

function validationFailed(issues: string) {
  return NextResponse.json<ApiResult<never>>(
    { success: false, error: issues, code: 'validation_failed', params: { issues } },
    { status: 400 },
  );
}

/**
 * GET /api/admin/player-search?q=&season_id=|tournament_id=&limit=&registered=1
 *
 * Player picker search for the roster and enrolment screens. `GET /api/players`
 * is site-admin only and unsearched, so it cannot serve a league or tournament
 * admin and never reaches players past its first page.
 *
 * - Any live admin may call it. A site admin needs no scope. A resource admin
 *   must name exactly one of `season_id` / `tournament_id` and be an admin of
 *   it (`requireResourceAdmin`: a tournament also passes for an admin of its
 *   parent season), so the endpoint is not a site-wide player directory for
 *   every scoped admin.
 * - `q` is a trimmed 1-64 character text, passed to `listPlayers` unchanged: a
 *   case-insensitive contains match on the player name or Showdown username
 *   (both public profile fields). `limit` is 1-20 (default 10).
 * - `registered=1` keeps only active, non-guest players with a Discord or email
 *   login (the guest-link and resource-admin pickers). A banned or suspended
 *   account is dropped because `claim_guest_player` refuses it as a source
 *   (SOURCE_NOT_ACTIVE). The identity and status columns are filtered on, never returned.
 * - Returns `PlayerSearchHit` rows (id, name, is_guest), mapped field by field
 *   from the player rows, plus `total` (all matches) so the picker can say
 *   when it shows only the first hits.
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requireAnyAdmin();

    const { searchParams } = new URL(request.url);
    const parsed = searchQuerySchema.safeParse({
      q: searchParams.get('q') ?? undefined,
      season_id: searchParams.get('season_id') ?? undefined,
      tournament_id: searchParams.get('tournament_id') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      registered: searchParams.get('registered') ?? undefined,
    });
    if (!parsed.success) return validationFailed(formatZodErrors(parsed.error));
    const { q, season_id: seasonId, tournament_id: tournamentId, limit, registered } = parsed.data;

    if (!player.isAdmin) {
      if (seasonId) {
        await requireResourceAdmin('season', seasonId);
      } else if (tournamentId) {
        await requireResourceAdmin('tournament', tournamentId);
      } else {
        return validationFailed('season_id: season_id or tournament_id is required');
      }
    }

    const { data, total } = await listPlayers({
      limit,
      offset: 0,
      search: q,
      ...(registered === '1' ? { registeredOnly: true } : {}),
    });
    const hits: PlayerSearchHit[] = data.map((row) => ({
      ...toPublicPlayerRef(row),
      is_guest: row.is_guest === true,
    }));
    return NextResponse.json({ success: true, data: hits, total } as ApiResult<PlayerSearchHit[]> & {
      total: number;
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to search players');
  }
}
