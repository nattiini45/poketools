import 'server-only';
import { requireAuth, isSuperadmin } from '@/lib/auth/helpers';
import { UserFacingError } from '@/lib/api/user-facing-error';
import aiErrors from '@/i18n/messages/errors/ai/en';
import { canAdministerPhaseAccess } from '@/lib/auth/phase-access';
import { loadPhaseMatchScope, buildPhaseMatchAnalysisPrompt, buildPhaseMatchPrepPrompt } from './phase-context';
import { getPhaseMatchAnalysis, getPhaseMatchPrepAnalysis, createPhaseMatchAnalysis, createPhaseMatchPrepAnalysis,
  updatePhaseMatchAnalysis, updatePhaseMatchPrepAnalysis, deletePhaseMatchAnalysis, deletePhaseMatchPrepAnalysis } from '@/lib/supabase/queries/phase-ai-artifacts';
import { checkAndRecordAiGeneration } from './rate-limit';
import { complete } from './client';
import { parseAnalysisResponse } from './parse-analysis';
import { parseScoutingResponse } from './parse-scouting';
import { AI_ANALYSIS_STALE_MS, getClaudeModelId } from './constants';
import { describeAiFailure } from './failure';
import { logger } from '@/lib/logger';
import type { MatchAnalysis, MatchPrepAnalysis } from '@/types/game';

export type PhaseAnalysisResult<T> = { kind: 'cached' | 'pending' | 'generated'; artifact: T }
  | { kind: 'limited'; limit: number } | { kind: 'superseded' };

export async function generatePhaseAnalysis(input: {
  phaseId: string; matchId: string; kind: 'post_match' | 'opponent_scout'; force?: boolean; perspectivePlayerId?: string;
}): Promise<PhaseAnalysisResult<MatchAnalysis | MatchPrepAnalysis>> {
  const session = await requireAuth();
  const player = session.player;
  if (!player) throw new UserFacingError(aiErrors.ai_not_registered_player, { status: 403, code: 'ai_not_registered_player' });
  const { match } = await loadPhaseMatchScope(input.phaseId, input.matchId);
  const scout = input.kind === 'opponent_scout';
  const participant = player.playerId === match.player_1_id || player.playerId === match.player_2_id;
  const perspective = input.perspectivePlayerId ?? player.playerId;
  if (scout) {
    if ((!participant || perspective !== player.playerId) && !isSuperadmin(session)) {
      throw new UserFacingError(aiErrors.ai_scouting_participants_only, { status: 403, code: 'ai_scouting_participants_only' });
    }
    if (perspective !== match.player_1_id && perspective !== match.player_2_id) throw new Error('Scouting perspective must be a match participant');
    if (match.status !== 'scheduled') throw new UserFacingError(aiErrors.ai_scouting_scheduled_only.replace('{status}', match.status),
      { code: 'ai_scouting_scheduled_only', params: { status: match.status } });
  } else {
    if (!participant && !await canAdministerPhaseAccess(player, input.phaseId)) {
      throw new UserFacingError(aiErrors.ai_analysis_participants_only, { status: 403, code: 'ai_analysis_participants_only' });
    }
    if (match.status !== 'pending_confirmation' && match.status !== 'completed') throw new UserFacingError(aiErrors.ai_match_status_invalid.replace('{status}', match.status),
      { code: 'ai_match_status_invalid', params: { status: match.status } });
  }
  const existing = scout ? await getPhaseMatchPrepAnalysis(input.phaseId, input.matchId, perspective)
    : await getPhaseMatchAnalysis(input.phaseId, input.matchId);
  if (!input.force && existing?.status === 'completed') return { kind: 'cached', artifact: existing };
  if (!input.force && existing?.status === 'pending' && Date.now() - new Date(existing.created_at).getTime() <= AI_ANALYSIS_STALE_MS) {
    return { kind: 'pending', artifact: existing };
  }
  const prompt = scout ? await buildPhaseMatchPrepPrompt(input.phaseId, input.matchId, perspective)
    : await buildPhaseMatchAnalysisPrompt(input.phaseId, input.matchId);
  const hasUserTeam = 'hasUserTeam' in prompt && prompt.hasUserTeam === true;
  if (existing) {
    const deleted = scout ? await deletePhaseMatchPrepAnalysis(input.phaseId, input.matchId, perspective)
      : await deletePhaseMatchAnalysis(input.phaseId, input.matchId);
    if (!deleted) return { kind: 'superseded' };
  }
  const record = scout ? await createPhaseMatchPrepAnalysis(input.phaseId, input.matchId, perspective, getClaudeModelId(), hasUserTeam)
    : await createPhaseMatchAnalysis(input.phaseId, input.matchId, getClaudeModelId());
  const settleFailure = (error: string) => scout ? updatePhaseMatchPrepAnalysis(record.id, { status: 'failed', error })
    : updatePhaseMatchAnalysis(record.id, { status: 'failed', error });
  const started = Date.now();
  try {
    const allowance = await checkAndRecordAiGeneration(player.playerId, scout ? 'match-prep-analysis' : 'match-analysis');
    if (!allowance.allowed) {
      await settleFailure('daily_limit_reached');
      return { kind: 'limited', limit: allowance.limit };
    }
    const result = await complete(prompt.systemPrompt, prompt.userPrompt, { jsonOutput: true, surface: scout ? 'phase-match-prep-analysis' : 'phase-match-analysis' });
    const values = { status: 'completed' as const, model_id: result.model, prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens, generation_time_ms: Date.now() - started, error: null };
    if (scout) {
      const analysis = parseScoutingResponse(result.content, hasUserTeam);
      if (!await updatePhaseMatchPrepAnalysis(record.id, { ...values, analysis })) return { kind: 'superseded' };
      return { kind: 'generated', artifact: { ...record, ...values, analysis } as MatchPrepAnalysis };
    }
    const analysis = parseAnalysisResponse(result.content);
    if (!await updatePhaseMatchAnalysis(record.id, { ...values, analysis })) return { kind: 'superseded' };
    return { kind: 'generated', artifact: { ...record, ...values, analysis } as MatchAnalysis };
  } catch (error) {
    logger.error('ai/phase-analysis', 'Phase analysis failed', { error, phaseId: input.phaseId, matchId: input.matchId });
    await settleFailure(describeAiFailure(error, { code: 'ai_analysis_failed', message: '' }).stored);
    throw error;
  }
}
