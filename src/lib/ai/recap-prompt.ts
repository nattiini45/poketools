import type { RecapMatchSummary } from '@/types/broadcast';

/**
 * The prompt of the weekly recap narrative. It lives here, not in recap-engine.ts (which pulls in
 * the database layer), so the engine and the AI flow eval (scripts/ai-flow-eval.ts) render the
 * same prompt. Pure: no I/O.
 */

/** The system prompt before the output-language line is appended. */
export const RECAP_NARRATIVE_SYSTEM_PROMPT =
  'You are a sports commentator for a competitive Pokémon league. Write brief, engaging recap paragraphs.';

export interface NarrativeInput {
  leagueName: string;
  tournamentName: string;
  roundName: string;
  roundNumber: number;
  results: RecapMatchSummary[];
  headlineMatch: RecapMatchSummary | null;
}

export function buildNarrativePrompt(input: NarrativeInput): string {
  const matchLines = input.results
    .map((r) => `  ${r.player1_name} vs ${r.player2_name}: ${r.winner_name} wins ${r.score}`)
    .join('\n');

  return `You are a sports commentator for the "${input.leagueName}" competitive Pokémon league.

Write a brief, engaging 2-3 sentence recap paragraph for ${input.roundName} of ${input.tournamentName}. Be dramatic but concise. Reference specific results. The scores shown are Pokémon scores (surviving Pokémon).

This round's results:
${matchLines}

${input.headlineMatch ? `Headline match: ${input.headlineMatch.player1_name} vs ${input.headlineMatch.player2_name} (${input.headlineMatch.score})` : ''}

Write ONLY the paragraph — no headers, no bullet points.`;
}
