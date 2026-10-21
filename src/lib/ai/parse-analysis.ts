/**
 * Resilient parser for Professor Linden's structured match-analysis JSON.
 *
 * Shared by the legacy SSE route (`/api/ai/match-analysis`) and the agent
 * post-match route (`/api/ai/agent/analyze-match`). Both ask the model for a
 * single JSON object; this tolerates the ways smaller / thinking models wrap it
 * (a `<think>` block, markdown fences, preamble) and validates the required
 * fields before persistence.
 */
import type { MatchAnalysisContent } from '@/types/game';

export function parseAnalysisResponse(content: string): MatchAnalysisContent {
  let cleaned = content.trim();

  // Strip <think>...</think> blocks (thinking models emit these before JSON)
  const thinkEnd = cleaned.lastIndexOf('</think>');
  if (thinkEnd !== -1) {
    cleaned = cleaned.slice(thinkEnd + 8).trim();
  }

  // Strip markdown code fences (models sometimes re-wrap after </think>)
  cleaned = cleaned.replace(/^```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  // Extract JSON object by finding outermost { } boundaries.
  // This handles preamble text ("Here's my analysis:") or trailing commentary.
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    console.error('[parse-analysis] Raw LLM response length:', content.length);
    throw new Error('No JSON object found in LLM response');
  }
  cleaned = cleaned.slice(firstBrace, lastBrace + 1);

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (!parsed.summary || typeof parsed.summary !== 'string') {
    throw new Error('Missing or invalid "summary" in analysis response');
  }
  if (!parsed.mvp || typeof parsed.mvp.pokemon !== 'string') {
    throw new Error('Missing or invalid "mvp" in analysis response');
  }
  if (!Array.isArray(parsed.game_breakdowns)) {
    throw new Error('Missing or invalid "game_breakdowns" in analysis response');
  }

  return {
    summary: parsed.summary,
    turning_point: parsed.turning_point ?? '',
    mvp: {
      pokemon: parsed.mvp.pokemon,
      player: parsed.mvp.player ?? '',
      reasoning: parsed.mvp.reasoning ?? '',
    },
    game_breakdowns: parsed.game_breakdowns.map((gb: Record<string, unknown>) => ({
      game_number: Number(gb.game_number) || 0,
      winner: String(gb.winner ?? ''),
      narrative: String(gb.narrative ?? ''),
      key_plays: Array.isArray(gb.key_plays) ? gb.key_plays.map(String) : [],
    })),
    meta_observations: parsed.meta_observations ?? '',
    what_if: parsed.what_if ?? '',
    // The model now emits `league_constraint_analysis` (gym typing OR assigned
    // core). Fall back to the legacy `gym_type_analysis` key for resilience.
    league_constraint_analysis:
      typeof parsed.league_constraint_analysis === 'string'
        ? parsed.league_constraint_analysis
        : typeof parsed.gym_type_analysis === 'string'
          ? parsed.gym_type_analysis
          : undefined,
  };
}
