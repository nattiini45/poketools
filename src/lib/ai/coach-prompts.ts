import type { CoachPokemonSet } from '@/lib/validation';

/**
 * Prompt builders of the two teambuilder coaches (/api/teams/ai/team-coach and
 * /api/teams/ai/slot-coach). They live here, not in the route files, so the routes and the
 * AI flow eval (scripts/ai-flow-eval.ts) render the very same prompts. Pure: no I/O.
 */

export function buildTeamCoachSystemPrompt(): string {
  return `You are an expert competitive Pokémon team builder coach. You analyze entire teams and provide holistic feedback on team structure, synergy, and strategy.

Rules:
- Assess overall team archetype and strategy coherence
- Identify type synergies and defensive cores
- Evaluate role distribution (win con, wallbreaker, pivot, check, etc.)
- Identify shared weaknesses to common threats
- Suggest specific improvements with named Pokémon/moves/items
- Keep responses focused (5-8 bullet points)
- Use competitive Pokémon terminology correctly
- Reference the format's metagame when relevant
- Rate overall team quality at the end (S/A/B/C/D/F tier)`;
}

export function buildTeamCoachUserPrompt(
  team: CoachPokemonSet[],
  format: string,
  generation: number,
): string {
  const setLines = team.map((set) => {
    const moves = (set.moves ?? []).filter(Boolean).join(', ') || 'None';
    const evSummary = Object.entries(set.evs ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${v} ${k}`)
      .join('/');
    return `• ${set.species}${set.name ? ` (${set.name})` : ''} @ ${set.item || 'None'} | ${set.ability || '?'} | ${set.nature || '?'} | ${evSummary || 'No EVs'} | Moves: ${moves}${set.tera_type ? ` | Tera: ${set.tera_type}` : ''}`;
  });

  return `Analyze this team in ${format.toUpperCase()} (Gen ${generation}):

${setLines.join('\n')}

Provide a holistic team analysis covering:
1. Team archetype and strategy
2. Offensive synergy and coverage
3. Defensive cores and type balance
4. Shared weaknesses and threats
5. Role distribution assessment
6. Specific improvement suggestions
7. Overall tier rating (S/A/B/C/D/F)`;
}

export function buildSlotCoachSystemPrompt(): string {
  return `You are an expert competitive Pokémon team builder coach. You analyze individual team slots (Pokémon sets) and provide concise, actionable feedback.

Rules:
- Be specific — reference actual moves, items, abilities, and EV spreads
- Focus on synergy with the rest of the team
- Keep responses SHORT (3-5 bullet points max)
- Use competitive Pokémon terminology correctly
- If the set looks good, say so briefly and suggest minor optimizations
- Never suggest illegal combinations (wrong abilities, incompatible moves, etc.)
- Reference the format when relevant (e.g. common threats in that tier)`;
}

export function buildSlotCoachUserPrompt(
  set: CoachPokemonSet,
  team: CoachPokemonSet[],
  format: string,
  generation: number,
): string {
  const teammates = team
    .filter((t) => t.species && t.species !== set.species)
    .map((t) => `${t.species} (${t.item || 'No Item'}, ${t.ability || '?'})`)
    .join(', ') || 'None yet';

  const evSummary = Object.entries(set.evs ?? {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(' / ');

  return `Analyze this team slot in ${format.toUpperCase()} (Gen ${generation}):

**${set.species}** ${set.name ? `(${set.name})` : ''}
- Item: ${set.item || 'None'}
- Ability: ${set.ability || 'None'}
- Nature: ${set.nature || 'None'}
- EVs: ${evSummary || 'None'}
${set.tera_type ? `- Tera Type: ${set.tera_type}` : ''}
- Moves: ${(set.moves ?? []).filter(Boolean).join(', ') || 'None'}

Teammates: ${teammates}

Provide 3-5 specific suggestions for improving this set. Focus on:
1. Move coverage and synergy
2. EV optimization
3. Item/ability choices
4. Role on the team`;
}
