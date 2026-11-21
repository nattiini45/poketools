import { NextResponse, type NextRequest } from 'next/server';
import { createTranslator } from '@/i18n/core';
import { errorsAdminAssistant } from '@/i18n/messages/errors/admin-assistant';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { getAgentAuditContext } from '@/lib/audit/agent-context';
import { logAuditEvent } from '@/lib/audit/log';
import { requirePlayer } from '@/lib/auth/helpers';
import { emitPhaseDiscordEvent } from '@/lib/discord/notify';
import { createNativeBracketPersistence, isInitialClassicPhaseBracket } from '@/lib/league-phase/bracket-persistence';
import { expirePhaseReads } from '@/lib/revalidation';
import { startSeasonIfUpcoming } from '@/lib/season/start-season';
import { emitPhaseSocialEvent } from '@/lib/social/notify';
import { getPhaseParticipants } from '@/lib/supabase/queries/league-phases';
import { generateEliminationBracket } from '@/lib/tournament/bracket-generate';
import { parseGenerateOptions } from '@/lib/tournament/generate-options';
import type { ApiResult } from '@/types/api';
import type { PhaseDiscordEventPayload } from '@/types/phase-events';
import { invalidPhaseRoundPath, loadRoundPhase, phaseRoundError, type PhaseParams } from '../rounds/_lib/scope';
import { loadNativeKitBracket } from './kit-start';

export async function POST(request: NextRequest, { params }: { params: Promise<PhaseParams> }) {
  try {
    const actor = await requirePlayer();
    const path = await params;
    const invalid = invalidPhaseRoundPath(path);
    if (invalid) return invalid;
    const { season, phase } = await loadRoundPhase(path, actor);
    const options = await parseGenerateOptions(request);
    if (!options.ok) return options.response;

    const assistantBracket = getAgentAuditContext()?.agent_tool === 'generate_phase_bracket';
    if (assistantBracket && (options.startRound || !isInitialClassicPhaseBracket(phase, season))) {
      throw new UserFacingError(createTranslator(errorsAdminAssistant, 'en')('proposal_stale'), { code: 'proposal_stale', status: 409 });
    }

    const kit = assistantBracket ? null : await loadNativeKitBracket(phase, season.format_type);
    if (phase.bracket_type !== 'single_elim' && phase.bracket_type !== 'double_elim') {
      throw new UserFacingError('Full bracket generation only applies to elimination formats', { code: 'bracket_generate_elim_only' });
    }
    if (phase.status === 'completed') {
      throw new UserFacingError('Tournament is already completed', { code: 'tournament_already_completed' });
    }
    const participants = await getPhaseParticipants(phase.id);
    if (participants.length < 2) {
      throw new UserFacingError('Need at least 2 participants', { code: 'tournament_participants_too_few' });
    }
    const announceKit = await kit?.prepareStart(request, actor);
    const result = await generateEliminationBracket(phase, participants, {
      startFirstRound: options.startRound,
    }, createNativeBracketPersistence(undefined, {
      updatedAt: phase.updated_at,
      seeds: participants.map(({ id: player_id, seed, starting_bracket }) => ({ player_id, seed, starting_bracket })),
      formatRevision: kit?.revision,
    }));

    try {
      await startSeasonIfUpcoming(season.id);
      await announceKit?.();
    } finally {
      expirePhaseReads(phase.id, season.id);
    }

    logAuditEvent({
      actor_id: actor.playerId, actor_name: actor.name, action: 'bracket.generate',
      resource_type: 'phase', resource_id: phase.id, resource_name: phase.name,
      metadata: {
        rounds_created: result.rounds_created,
        matches_materialized: result.matches_materialized,
        started: result.started_round_id !== undefined,
      },
    });
    const payload: PhaseDiscordEventPayload = {
      version: 1,
      owner: { kind: 'phase', phase_id: phase.id, season_id: season.id },
      event_type: 'round_generated',
      data: { kind: 'round_generated', phase_name: phase.name, round_name: 'Full bracket', pairings: [] },
    };
    emitPhaseDiscordEvent(payload);
    emitPhaseSocialEvent(payload);

    return NextResponse.json<ApiResult<typeof result>>({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return phaseRoundError(error, 'Failed to generate bracket');
  }
}
