import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { requireCreator } from '@/lib/auth/helpers';
import { loadTrackerMatch, readTrackerRosters } from '@/lib/broadcast/dashboard-tracker.server';
import { generationOrDefault } from '@/lib/pkmn/format-id';
import { listIndependentCastSessions } from '@/lib/supabase/queries/cast-sessions';
import { createPhaseCastSession, listPhaseCastSessions } from '@/lib/supabase/queries/phase-cast-sessions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import type { ApiResult } from '@/types/api';

const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const player = await requireCreator();
    const { id } = await params;
    const invalid = rejectInvalidPathId(id, 'INVALID_MATCH_ID');
    if (invalid) return invalid;
    const read = await loadTrackerMatch(id, true);
    if (read?.kind !== 'phase') {
      throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
    }

    const { match, competition: phase } = read;
    const [owned, independent] = await Promise.all([
      listPhaseCastSessions(player.playerId, phase.id, match.id),
      listIndependentCastSessions(player.playerId, { phaseId: phase.id, matchId: match.id }),
    ]);
    const existing = [...owned, ...independent].filter((session) => {
      if (session.owner_id !== player.playerId || session.status === 'archived') return false;
      const ref = 'phase_id' in session ? session : session.phase_ref;
      return ref?.phase_id === phase.id && ref.season_id === phase.season_id && ref.match_id === match.id;
    }).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))[0];
    if (existing) {
      return NextResponse.json<ApiResult<{ id: string }>>({ success: true, data: { id: existing.id } }, { headers });
    }

    const [{ team1, team2 }, ruleset] = await Promise.all([
      readTrackerRosters(read, { viewerId: player.playerId, isAdmin: player.isAdmin }),
      getRulesetById(phase.ruleset_id),
    ]);
    if (!ruleset) throw new Error('Missing tracker phase ruleset version');
    const session = await createPhaseCastSession(player.playerId, {
      phase_id: phase.id, match_id: match.id,
      name: `${match.player_1_name} vs ${match.player_2_name}`,
      mode: 'cast', format: ruleset.base_format, generation: generationOrDefault(ruleset.base_format),
      player1_id: match.player_1_id, player1_name: match.player_1_name, player1_avatar_url: match.player_1_avatar_url,
      player2_id: match.player_2_id, player2_name: match.player_2_name, player2_avatar_url: match.player_2_avatar_url,
      player1_team: team1 ?? [], player2_team: team2 ?? [],
    }, phase.season_id);
    return NextResponse.json<ApiResult<{ id: string }>>({ success: true, data: { id: session.id } }, { status: 201, headers });
  } catch (err) {
    const frozen = typeof err === 'object' && err !== null && 'code' in err && err.code === 'P0001'
      && 'message' in err && err.message === 'phase_storage_not_ready';
    const error = frozen ? Object.assign(new UserFacingError('League phases are temporarily unavailable during maintenance.', {
      code: 'phase_storage_unavailable', status: 503,
    }), { cause: err }) : err;
    const response = safeErrorResponse(error, 'Failed to open tracker cast session');
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}
