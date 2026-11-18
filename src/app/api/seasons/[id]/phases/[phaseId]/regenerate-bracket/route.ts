import { NextResponse, type NextRequest } from 'next/server';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { createNativeBracketPersistence } from '@/lib/league-phase/bracket-persistence';
import { logger } from '@/lib/logger';
import { expirePhaseReads, revalidatePhaseMatchPages } from '@/lib/revalidation';
import { startSeasonIfUpcoming } from '@/lib/season/start-season';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { getMatchesByPhase, getPhaseMatchById } from '@/lib/supabase/queries/phase-matches';
import { regenerateEliminationBracket, type GenerateBracketResult } from '@/lib/tournament/bracket-generate';
import { assertBracketMayBeRegenerated } from '@/lib/tournament/regenerate-guard';
import { cascadeActionSchema, formatZodErrors } from '@/lib/validation';
import type { ApiResult } from '@/types/api';
import type { PhaseMatchWithPlayers } from '@/types/league-phase-match';
import { loadNativeKitBracket } from '../generate-bracket/kit-start';
import { nativeRoundServices } from '../rounds/_lib/effects';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from '../rounds/_lib/scope';

export async function POST(request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    if (phase.bracket_type !== 'single_elim' && phase.bracket_type !== 'double_elim') {
      throw new UserFacingError('Bracket regeneration only applies to elimination formats', { code: 'bracket_regenerate_elim_only' });
    }
    if (phase.archived) {
      throw new UserFacingError('Archived phase is read-only', { code: 'phase_bracket_archived', status: 409 });
    }
    assertBracketMayBeRegenerated({ ...phase, season_format_type: season.format_type });
    const raw: unknown = await request.json().catch(() => ({}));
    const parsed = cascadeActionSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      const issues = formatZodErrors(parsed.error);
      throw new UserFacingError(issues, { code: 'validation_failed', params: { issues } });
    }
    const cascade = parsed.data.cascade === true;
    const kit = await loadNativeKitBracket(phase, season.format_type);
    const participants = await getPhaseParticipants(phase.id);
    const announceKit = await kit?.prepareStart(request, actor);
    const services = nativeRoundServices(phase).matches;
    const resetIds: string[] = [];
    const storage = createNativeBracketPersistence({
      async getMatches(id) {
        const matches = await getMatchesByPhase(id);
        assertNoScheduledGames(matches);
        return matches;
      },
      async getMatch(id) {
        const match = await getPhaseMatchById(id);
        if (match?.phase_id !== phase.id) return null;
        assertNoScheduledGames([match]);
        return match;
      },
      async resetMatch(id, actorId, force) {
        resetIds.push(id);
        return services.resetMatch(id, actorId, force);
      },
    }, {
      updatedAt: phase.updated_at,
      seeds: participants.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
      formatRevision: kit?.revision,
    });
    let result: GenerateBracketResult | undefined;
    try {
      result = await regenerateEliminationBracket(phase, participants, { cascade, adminId: actor.playerId }, storage);
      if (phase.status === 'upcoming') {
        try {
          await startSeasonIfUpcoming(season.id);
        } catch (error) {
          logger.error('phase-bracket', 'Could not start the league after regenerating its first bracket', { phaseId: phase.id, error });
        }
      }
    } finally {
      if (result || resetIds.length) {
        expirePhaseReads(phase.id, season.id);
        await Promise.allSettled(resetIds.map(id => revalidatePhaseMatchPages(phase.id, id, season.id)))
          .then(outcomes => {
            for (const outcome of outcomes) {
              if (outcome.status === 'rejected') logger.error('phase-bracket', 'Could not expire reset match pages', { phaseId: phase.id, error: outcome.reason });
            }
          });
        logAuditEvent({
          actor_id: actor.playerId, actor_name: actor.name, action: 'bracket.generate',
          resource_type: 'phase', resource_id: phase.id, resource_name: phase.name,
          metadata: { regenerated: true, cascade, completed: result !== undefined, ...result },
        });
      }
    }
    await announceKit?.();
    return NextResponse.json<ApiResult<GenerateBracketResult>>({ success: true, data: result });
  } catch (error) {
    return phaseRoundError(error, 'Failed to regenerate bracket');
  }
}

function assertNoScheduledGames(matches: readonly Pick<PhaseMatchWithPlayers, 'status' | 'games'>[]) {
  if (matches.some(match => match.status === 'scheduled' && match.games.length > 0)) {
    throw new UserFacingError(tournamentErrors.phase_bracket_regenerate_scheduled_games, {
      code: 'phase_bracket_regenerate_scheduled_games', status: 409,
    });
  }
}
