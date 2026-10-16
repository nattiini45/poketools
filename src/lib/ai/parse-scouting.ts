/**
 * Resilient parser for Professor Linden's structured scouting JSON.
 *
 * Shared by the legacy SSE route (`/api/ai/match-prep-analysis`) and the agent
 * scouting route (`/api/ai/agent/analyze-match` `opponent_scout`). Both ask the
 * model for a single JSON object; this tolerates the ways smaller / thinking
 * models wrap it (a `<think>` block, markdown fences, preamble) and validates
 * the required fields before persistence.
 *
 * The `hasUserTeam` flag selects the conditional half of the schema: a known
 * planned team yields `matchup_analysis`; no team yields `suggested_picks`.
 */
import type { MatchPrepAnalysisContent } from '@/types/game';

export function parseScoutingResponse(
  content: string,
  hasUserTeam: boolean,
): MatchPrepAnalysisContent {
  let cleaned = content.trim();

  // Strip <think>...</think> blocks (thinking models emit these before JSON)
  const thinkEnd = cleaned.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  // Strip markdown code fences (models sometimes re-wrap after </think>)
  cleaned = cleaned.replace(/^```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  // Extract JSON object by finding outermost { } boundaries.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.error('[parse-scouting] Raw LLM response length:', content.length);
    throw new Error('No JSON object found in LLM response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (!parsed.opponent_profile || typeof parsed.opponent_profile !== 'string') {
    throw new Error('Missing or invalid "opponent_profile" in scouting response');
  }
  if (!Array.isArray(parsed.signature_pokemon)) {
    throw new Error('Missing or invalid "signature_pokemon" in scouting response');
  }
  if (!parsed.tendencies || typeof parsed.tendencies !== 'object') {
    throw new Error('Missing or invalid "tendencies" in scouting response');
  }
  if (!parsed.recommendations || typeof parsed.recommendations !== 'object') {
    throw new Error('Missing or invalid "recommendations" in scouting response');
  }

  const result: MatchPrepAnalysisContent = {
    opponent_profile: parsed.opponent_profile,
    signature_pokemon: parsed.signature_pokemon.map((sp: Record<string, unknown>) => ({
      pokemon: String(sp.pokemon ?? ''),
      usage_note: String(sp.usage_note ?? ''),
    })),
    tendencies: {
      lead_patterns: String(parsed.tendencies.lead_patterns ?? ''),
      play_style: String(parsed.tendencies.play_style ?? ''),
      favorite_moves: String(parsed.tendencies.favorite_moves ?? ''),
    },
    meta_positioning: String(parsed.meta_positioning ?? ''),
    recommendations: {
      threats_to_watch: Array.isArray(parsed.recommendations.threats_to_watch)
        ? parsed.recommendations.threats_to_watch.map(String)
        : [],
      suggested_leads: String(parsed.recommendations.suggested_leads ?? ''),
      coverage_gaps: String(parsed.recommendations.coverage_gaps ?? ''),
      key_advice: String(parsed.recommendations.key_advice ?? ''),
    },
  };

  // Include matchup analysis only when user team was provided
  if (hasUserTeam && parsed.matchup_analysis && typeof parsed.matchup_analysis === 'object') {
    result.matchup_analysis = {
      your_advantages: String(parsed.matchup_analysis.your_advantages ?? ''),
      their_advantages: String(parsed.matchup_analysis.their_advantages ?? ''),
      neutral_ground: String(parsed.matchup_analysis.neutral_ground ?? ''),
    };
  }

  // Include suggested picks only when no user team was provided
  if (!hasUserTeam && Array.isArray(parsed.suggested_picks) && parsed.suggested_picks.length > 0) {
    result.suggested_picks = parsed.suggested_picks.map((pick: Record<string, unknown>) => ({
      pokemon: String(pick.pokemon ?? ''),
      role: String(pick.role ?? ''),
      set_summary: String(pick.set_summary ?? ''),
      reasoning: String(pick.reasoning ?? ''),
    }));
  }

  return result;
}
