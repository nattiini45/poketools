import 'server-only';
import type { z } from 'zod';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { assertMayRecordPhaseResult } from '@/lib/auth/phase-access';
import { MOMENTS_NOT_SAVED_WARNING, type ManualResultMomentsOutcome } from '@/lib/broadcast/moment-limits';
import { emitPhaseResultEffects } from './result-effects';
import { createNativePhaseServices } from './services';
import { logger } from '@/lib/logger';
import { expireSeasonReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { createPhaseMomentsBatch } from '@/lib/supabase/queries/phase-broadcast-moments';
import { getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import type { BattleStatInsert } from '@/types/game';
import type { manualResultSchema } from '@/lib/validation';
import type { SessionPlayer } from '@/types/auth';
import type { CompetitionOwner } from '@/types/competition-owner';

export async function recordNativeManualResult(
  owner: Extract<CompetitionOwner, { kind: 'phase' }>,
  player: SessionPlayer,
  body: z.infer<typeof manualResultSchema>,
  invalidateMatch: typeof revalidatePhaseMatchPages,
) {
  const mid = body.match_id.toLowerCase();
  const match = await getPhaseMatchById(mid);
  if (!match || match.phase_id !== owner.phase_id) {
    throw new UserFacingError('Match not found', { code: 'match_not_found', status: 404 });
  }
  const { asAdmin } = await assertMayRecordPhaseResult(player, match);

  if (body.winner_id !== match.player_1_id && body.winner_id !== match.player_2_id) {
    throw new UserFacingError('Winner must be a match participant', {
      code: 'manual_result_winner_not_participant', status: 400,
    });
  }
  const battleStats: BattleStatInsert[] = [];
  for (const playerStats of body.pokemon_stats) {
    if (playerStats.player_id !== match.player_1_id && playerStats.player_id !== match.player_2_id) {
      throw new UserFacingError(`Player ${playerStats.player_id} is not in this match`, {
        code: 'match_player_not_participant', status: 400, params: { playerId: playerStats.player_id },
      });
    }
    for (const poke of playerStats.pokemon) {
      battleStats.push({
        game_id: '',
        player_id: playerStats.player_id,
        pokemon_name: poke.pokemon_name,
        was_brought: poke.was_brought ?? true,
        was_lead: poke.was_lead ?? false,
        kos_dealt: poke.kos_dealt ?? 0,
        was_koed: poke.was_koed ?? false,
        moves_used: poke.moves_used ?? [],
        turns_active: poke.turns_active ?? 0,
      });
    }
  }

  const { matches } = createNativePhaseServices({
    invalidateMatch: (phase, matchId) => invalidateMatch(phase, matchId, phase === owner.phase_id ? owner.season_id : undefined),
    invalidateSeason: (season, phaseIds) => expireSeasonReads(season, { phaseIds }),
    invalidateWiki: phase => revalidatePhaseMatchPages(phase),
  });
  const result = await matches.recordGameResult({
    match_id: mid,
    winner_id: body.winner_id,
    screenshot_url: body.screenshot_url,
    source: 'manual',
    battle_stats: battleStats,
    submitter_id: player.playerId,
    is_admin: asAdmin,
  });

  const momentsOutcome: ManualResultMomentsOutcome = { moments_saved: 0 };
  if (body.moments?.length) {
    const count = body.moments.length;
    try {
      await createPhaseMomentsBatch(body.moments.map(moment => ({
        moment_type: moment.moment_type,
        turn_number: moment.turn_number ?? null,
        description: moment.description ?? null,
        pokemon_name: moment.pokemon_name ?? null,
        timestamp: moment.timestamp ?? new Date().toISOString(),
        match_id: mid,
        game_id: result.game_id,
        created_by: player.playerId,
      })));
      momentsOutcome.moments_saved = count;
    } catch (error) {
      logger.error('phase/manual-result', 'Failed to save broadcast moments', {
        ...owner, matchId: mid, gameId: result.game_id, count, error,
      });
      momentsOutcome.warning = {
        code: MOMENTS_NOT_SAVED_WARNING,
        error: `The game was recorded, but its ${count} marked moment${count === 1 ? '' : 's'} could not be saved. The failure was logged.`,
        params: { count },
      };
    }
  }

  await emitPhaseResultEffects(owner, mid, result);
  return { ...result, ...momentsOutcome };
}
