import 'server-only';
import { requireAuth } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import aiErrors from '@/i18n/messages/errors/ai/en';
import matchErrors from '@/i18n/messages/errors/matches/en';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { isPlayerPhaseParticipant } from '@/lib/supabase/queries/league-phases';
import { loadPhaseMatchScope, buildPhaseMatchAnalysisPrompt, buildPhaseMatchPrepPrompt } from './phase-context';
import { getPhaseMatchAnalysis, getPhaseMatchPrepAnalysis, createPhaseMatchAnalysis, claimPhaseMatchPrepAnalysis,
  updatePhaseMatchAnalysis, updatePhaseMatchPrepAnalysis, deletePhaseMatchAnalysis,
  getPhaseScoutingAccess } from '@/lib/supabase/queries/phase-ai-artifacts';
import { checkAndRecordAiGeneration, getAiDailyLimit } from './rate-limit';
import { complete } from './client';
import { parseAnalysisResponse } from './parse-analysis';
import { parseScoutingResponse } from './parse-scouting';
import { AI_ANALYSIS_STALE_MS, AI_MAX_TOKENS, getClaudeModelId } from './constants';
import { describeAiFailure } from './failure';
import { logger } from '@/lib/logger';
import type { MatchAnalysis, MatchPrepAnalysis } from '@/types/game';
import type { SessionPlayer } from '@/types/auth';

export type PhaseAnalysisResult<T> = { kind: 'cached' | 'pending' | 'generated'; artifact: T }
  | { kind: 'limited'; limit: number } | { kind: 'superseded' };

type PhaseScoutingPreparation =
  | { kind: 'cached' | 'pending'; artifact: MatchPrepAnalysis }
  | { kind: 'limited'; limit: number }
  | { kind: 'superseded' }
  | { kind: 'ready'; run: () => Promise<{ kind: 'generated'; artifact: MatchPrepAnalysis } | { kind: 'superseded' }> };

const scoutingMatchNotFound = () => new UserFacingError(matchErrors.match_not_found, { code: 'match_not_found', status: 404 });
const scoutingParticipantRequired = () => new UserFacingError(aiErrors.ai_scouting_participants_only,
  { status: 403, code: 'ai_scouting_participants_only' });
const scoutingScheduledOnly = (status: string) => new UserFacingError(aiErrors.ai_scouting_scheduled_only.replace('{status}', status),
  { code: 'ai_scouting_scheduled_only', params: { status } });

export async function preparePhaseScouting(
  input: { phaseId: string; matchId: string; force?: boolean; perspectivePlayerId?: string },
  player: SessionPlayer,
): Promise<PhaseScoutingPreparation> {
  const { phaseId, matchId, force, perspectivePlayerId = player.playerId } = input;
  const { playerId } = player;
  const match = await getPhaseScoutingAccess(phaseId, matchId);
  if (!match) throw scoutingMatchNotFound();
  if (perspectivePlayerId !== playerId || (playerId !== match.player_1_id && playerId !== match.player_2_id)
    || !await isPlayerPhaseParticipant(playerId, phaseId)) {
    throw scoutingParticipantRequired();
  }
  if (match.status !== 'scheduled') throw scoutingScheduledOnly(match.status);

  const read = () => getPhaseMatchPrepAnalysis(phaseId, matchId, playerId);
  const isFreshPending = (artifact: MatchPrepAnalysis) => artifact.status === 'pending'
    && Date.now() - new Date(artifact.created_at).getTime() <= AI_ANALYSIS_STALE_MS;
  const existing = await read();
  if (existing && isFreshPending(existing)) return { kind: 'pending', artifact: existing };
  if (existing?.status === 'completed' && (!force || (!player.isAdmin && existing.has_user_team))) {
    return { kind: 'cached', artifact: existing };
  }

  const prompt = await buildPhaseMatchPrepPrompt(phaseId, matchId, playerId, { scheduledOnly: true });
  if (existing?.status === 'completed' && !player.isAdmin && !prompt.hasUserTeam) {
    return { kind: 'cached', artifact: existing };
  }
  const claim = await claimPhaseMatchPrepAnalysis(phaseId, matchId, playerId, getClaudeModelId(),
    prompt.hasUserTeam, existing, getAiDailyLimit('match-prep-analysis'));
  if (claim.kind === 'limited') return claim;
  if (claim.kind === 'match_not_found') throw scoutingMatchNotFound();
  if (claim.kind === 'not_participant') throw scoutingParticipantRequired();
  if (claim.kind === 'unscheduled') throw scoutingScheduledOnly(claim.status);
  if (claim.kind === 'lost') {
    const current = await read();
    if (current?.status === 'completed') return { kind: 'cached', artifact: current };
    if (current && isFreshPending(current)) return { kind: 'pending', artifact: current };
    return { kind: 'superseded' };
  }

  const record = claim.artifact;
  const started = Date.now();
  const settleFailure = (error: string) => updatePhaseMatchPrepAnalysis(record.id,
    { status: 'failed', error, generation_time_ms: Date.now() - started });
  const recordFailure = async (error: unknown) => {
    logger.error('ai/phase-analysis', 'Phase scouting failed', { error, phaseId, matchId });
    try {
      await settleFailure(describeAiFailure(error, { code: 'ai_analysis_failed', message: '' }).stored);
    } catch (settleError) {
      logger.error('ai/phase-analysis', 'Failed to settle phase scouting failure', { error: settleError, phaseId, matchId });
    }
  };
  return { kind: 'ready', async run() {
    try {
      const result = await complete(prompt.systemPrompt, prompt.userPrompt,
        { jsonOutput: true, surface: 'phase-match-prep-analysis', maxTokens: AI_MAX_TOKENS.analysis });
      const analysis = parseScoutingResponse(result.content, prompt.hasUserTeam);
      const values = { status: 'completed' as const, model_id: result.model, prompt_tokens: result.prompt_tokens,
        completion_tokens: result.completion_tokens, generation_time_ms: Date.now() - started, error: null, analysis };
      if (!await updatePhaseMatchPrepAnalysis(record.id, values)) return { kind: 'superseded' };
      return { kind: 'generated', artifact: { ...record, ...values } };
    } catch (error) {
      await recordFailure(error);
      throw error;
    }
  } };
}

export async function generatePhaseAnalysis(input: {
  phaseId: string; matchId: string; kind: 'post_match' | 'opponent_scout'; force?: boolean; perspectivePlayerId?: string;
}): Promise<PhaseAnalysisResult<MatchAnalysis | MatchPrepAnalysis>> {
  const session = await requireAuth();
  const player = session.player;
  if (!player) throw new UserFacingError(aiErrors.ai_not_registered_player, { status: 403, code: 'ai_not_registered_player' });
  if (input.kind === 'opponent_scout') {
    const scouting = await preparePhaseScouting(input, player);
    return scouting.kind === 'ready' ? scouting.run() : scouting;
  }
  const { match } = await loadPhaseMatchScope(input.phaseId, input.matchId);
  const participant = player.playerId === match.player_1_id || player.playerId === match.player_2_id;
  if (!participant && !await canAdministerPhaseAccess(player, input.phaseId)) {
    throw new UserFacingError(aiErrors.ai_analysis_participants_only, { status: 403, code: 'ai_analysis_participants_only' });
  }
  if (match.status !== 'pending_confirmation' && match.status !== 'completed') throw new UserFacingError(aiErrors.ai_match_status_invalid.replace('{status}', match.status),
    { code: 'ai_match_status_invalid', params: { status: match.status } });
  const existing = await getPhaseMatchAnalysis(input.phaseId, input.matchId);
  if (!input.force && existing?.status === 'completed') return { kind: 'cached', artifact: existing };
  if (!input.force && existing?.status === 'pending' && Date.now() - new Date(existing.created_at).getTime() <= AI_ANALYSIS_STALE_MS) {
    return { kind: 'pending', artifact: existing };
  }
  const prompt = await buildPhaseMatchAnalysisPrompt(input.phaseId, input.matchId);
  if (existing) {
    const deleted = await deletePhaseMatchAnalysis(input.phaseId, input.matchId);
    if (!deleted) return { kind: 'superseded' };
  }
  const record = await createPhaseMatchAnalysis(input.phaseId, input.matchId, getClaudeModelId());
  const settleFailure = (error: string) => updatePhaseMatchAnalysis(record.id, { status: 'failed', error });
  const started = Date.now();
  try {
    const allowance = await checkAndRecordAiGeneration(player.playerId, 'match-analysis');
    if (!allowance.allowed) {
      await settleFailure('daily_limit_reached');
      return { kind: 'limited', limit: allowance.limit };
    }
    const result = await complete(prompt.systemPrompt, prompt.userPrompt, { jsonOutput: true, surface: 'phase-match-analysis' });
    const values = { status: 'completed' as const, model_id: result.model, prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens, generation_time_ms: Date.now() - started, error: null };
    const analysis = parseAnalysisResponse(result.content);
    if (!await updatePhaseMatchAnalysis(record.id, { ...values, analysis })) return { kind: 'superseded' };
    return { kind: 'generated', artifact: { ...record, ...values, analysis } as MatchAnalysis };
  } catch (error) {
    logger.error('ai/phase-analysis', 'Phase analysis failed', { error, phaseId: input.phaseId, matchId: input.matchId });
    await settleFailure(describeAiFailure(error, { code: 'ai_analysis_failed', message: '' }).stored);
    throw error;
  }
}
