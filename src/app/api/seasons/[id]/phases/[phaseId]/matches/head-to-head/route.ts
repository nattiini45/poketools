import { type NextRequest, NextResponse } from 'next/server';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { phasePublicReads } from '@/lib/cache/phase-public-reads';
import { publicReads } from '@/lib/cache/public-reads';
import { requireOpenPhaseRouteMode } from '@/lib/league-phase/route-mode';
import { resolveLeaguePhaseRoute } from '@/lib/supabase/queries/phase-route-owners';
import { isValidUuid } from '@/lib/utils/uuid';

interface RouteParams {
  params: Promise<{ id: string; phaseId: string }>;
}

// Public: no auth required
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, phaseId } = await params;
    const invalidId = rejectInvalidPathId(id, 'INVALID_SEASON_ID') ?? rejectInvalidPathId(phaseId, 'INVALID_PHASE_ID');
    if (invalidId) return invalidId;

    const players = ['player_1_id', 'player_2_id'].map(name => {
      const value = request.nextUrl.searchParams.get(name);
      if (!value) throw new UserFacingError(`${name} is required`, { code: 'MISSING_PARAM', params: { name } });
      if (!isValidUuid(value)) {
        throw new UserFacingError(`${name} must be a valid UUID`, { code: 'INVALID_PARAM', params: { name } });
      }
      return value.toLowerCase();
    });
    const [first, second] = players;
    if (first === second) {
      throw new UserFacingError('player_1_id and player_2_id must differ', { code: 'SAME_PLAYER' });
    }

    const mode = await requireOpenPhaseRouteMode();
    const owner = await resolveLeaguePhaseRoute(id.toLowerCase(), phaseId.toLowerCase(), mode);
    if (!owner) throw new UserFacingError('Phase not found', { code: 'PHASE_NOT_FOUND', status: 404 });

    const data = owner.kind === 'phase'
      ? await phasePublicReads.headToHead(owner.phase_id, first, second)
      : (await publicReads.tournamentHeadToHead(owner.tournament_id, first, second)).map(row => ({
        id: row.id,
        phase_id: owner.tournament_id,
        winner_id: row.winner_id,
        games: row.games.map(game => ({ winner_id: game.winner_id })),
      }));
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch head-to-head matches');
  }
}
