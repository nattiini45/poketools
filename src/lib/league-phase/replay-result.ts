import 'server-only';
import { NextResponse } from 'next/server';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertMayRecordPhaseResult } from '@/lib/auth/phase-access';
import { prepareReplayGame } from '@/lib/pkmn/replay-submission';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import type { ApiResult } from '@/types/api';
import type { SessionPlayer } from '@/types/auth';
import type { ParseReplayInput } from '@/lib/validation/schemas';
import type { PhaseAggregateOwner } from './phase-aggregate-storage';
import { emitPhaseResultEffects } from './result-effects';
import { createNativePhaseServices } from './services';

export async function submitNativeReplay(
  owner: PhaseAggregateOwner,
  player: SessionPlayer,
  body: ParseReplayInput,
  invalidateMatch: typeof revalidatePhaseMatchPages,
) {
  const matchId = body.match_id.toLowerCase();
  const match = await getPhaseMatchById(matchId);
  if (!match || match.phase_id !== owner.phase_id) {
    throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
  }
  const { asAdmin } = await assertMayRecordPhaseResult(player, match);
  const input = await prepareReplayGame(body.replay_url, match);
  if (input instanceof NextResponse) return input;

  const { matches } = createNativePhaseServices({
    invalidateMatch: (phase, id) => invalidateMatch(phase, id, phase === owner.phase_id ? owner.season_id : undefined),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: phase => revalidatePhaseMatchPages(phase),
  });
  const result = await matches.recordGameResult({
    ...input,
    match_id: matchId,
    source: 'ps_replay',
    submitter_id: player.playerId,
    is_admin: asAdmin,
  });
  await emitPhaseResultEffects(owner, matchId, result, { replayUrl: input.replay.url });
  return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result });
}
