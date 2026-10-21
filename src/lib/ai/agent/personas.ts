/**
 * System-prompt factory (PRD §4, §10).
 *
 * Assembles the final system prompt for a persona = shared base (tool policy +
 * style) + the persona's voice/workflow block + the rendered per-player context
 * pack (§8.1). Kale drives the admin tournament-report workflows (PRD §4, §8).
 */
import { BASE_SYSTEM_PROMPT } from './prompts/base';
import { LINDEN_TEAMBUILDING_PROMPT, LINDEN_MATCH_PREP_PROMPT } from './prompts/linden';
import { KALE_RECAP_PROMPT, KALE_FORECAST_PROMPT } from './prompts/kale';
import type { AgentPersona } from './types';

/**
 * Kale drives both tournament-report workflows (recap + forecast) under one
 * persona; the focused task message (`buildTournamentReportMessage`) steers
 * which one this turn does. Advertising both workflow blocks keeps the system
 * prompt self-describing regardless of which the route asks for.
 */
const KALE_PROMPT = `${KALE_RECAP_PROMPT}\n\n${KALE_FORECAST_PROMPT}`;

function compose(personaBlock: string, contextPackMd: string): string {
  const parts = [BASE_SYSTEM_PROMPT, personaBlock];
  if (contextPackMd.trim().length > 0) parts.push(contextPackMd);
  return parts.join('\n\n---\n\n');
}

/**
 * Build the system prompt for a persona. `contextPackMd` is the output of
 * `renderContextPack()` (empty string is allowed for stateless callers).
 */
export function buildSystemPrompt(persona: AgentPersona, contextPackMd: string): string {
  switch (persona) {
    case 'linden_teambuilding':
      return compose(LINDEN_TEAMBUILDING_PROMPT, contextPackMd);
    case 'linden_match_prep':
      return compose(LINDEN_MATCH_PREP_PROMPT, contextPackMd);
    case 'kale':
      return compose(KALE_PROMPT, contextPackMd);
    default: {
      // Exhaustiveness guard — a new persona must be handled explicitly.
      const _never: never = persona;
      throw new Error(`Unknown persona: ${String(_never)}`);
    }
  }
}
