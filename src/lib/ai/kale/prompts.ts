import { AI_MAX_TOKENS } from '../constants';
import type { PromptTask, RecapFactPack, ForecastFactPack, MatchFact, MatchupFact, PipelineMode } from './types';

// ─── Kale Cabbage Persona ───────────────────────────────────────────

const KALE_PERSONA = `You are Kale Cabbage, a competitive Pokémon sports journalist. Your tone is authoritative and engaging — like a beat reporter who knows the scene. Measured, no emojis, no exclamation marks. Always use species names, never nicknames.`;

const FACT_RULES = `CRITICAL: You MUST use ONLY the facts provided below. Do not add, invent, or infer any factual claims. Every name, number, and result must come directly from the data given. If something isn't in the data, don't mention it.`;

// ─── Pipeline Mode ──────────────────────────────────────────────────

export function getPipelineMode(): PipelineMode {
  const val = process.env.KALE_PIPELINE_MODE;
  if (val === 'single') return 'single';
  return 'decomposed';
}

// ─── Recap Prompt Tasks ─────────────────────────────────────────────

export function buildRecapPromptTasks(factPack: RecapFactPack, mode: PipelineMode): PromptTask[] {
  if (mode === 'single') return [buildSingleRecapTask(factPack)];
  return buildDecomposedRecapTasks(factPack);
}

function buildDecomposedRecapTasks(fp: RecapFactPack): PromptTask[] {
  const tasks: PromptTask[] = [];

  // Stage 1: Match one-liners (parallel)
  for (let i = 0; i < fp.matches.length; i++) {
    tasks.push(buildMatchOneLinerTask(fp.matches[i], i, fp.gen));
  }

  // Stage 2: Independent sections (parallel)
  tasks.push(buildHeadlineTask(fp));
  tasks.push(buildStandingsStoryTask(fp));
  tasks.push(buildMetaTrendsTask(fp));

  if (fp.bestPerformer) {
    tasks.push(buildSpotlightTask(fp));
  }
  if (fp.unusualPick) {
    tasks.push(buildSpicyPickTask(fp));
  }

  // Stage 3: Narrative (depends on one-liners)
  tasks.push(buildNarrativeTask(fp));

  return tasks;
}

function buildMatchOneLinerTask(match: MatchFact, index: number, gen: number): PromptTask {
  const data = [
    `Winner: ${match.winnerName}`,
    `Loser: ${match.loserName}`,
    `Score: ${match.scoreString} (${match.marginDescription})`,
    `${match.winnerName}'s KOs: ${match.player1TotalKos === match.winnerScore + match.loserScore ? match.player1TotalKos : ''}`.trim(),
    match.mvpPokemon ? `MVP: ${match.mvpPokemon} (${match.mvpKos} KOs) for ${match.mvpPlayerName}` : '',
    ...match.keyPerformances.map((kp) => `- ${kp}`),
    '',
    `Factual template (rephrase this creatively, keeping ALL facts accurate):`,
    match.preWrittenOneLiner,
  ].filter(Boolean).join('\n');

  return {
    id: `match_one_liner_${index}`,
    stage: 1,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a single engaging sentence summarizing this match result. Reference specific Pokémon performances. Gen ${gen} context.`,
    userPrompt: data,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildHeadlineTask(fp: RecapFactPack): PromptTask {
  const matchSummaries = fp.matches.map((m) => m.preWrittenOneLiner).join('\n');
  const topChanges = fp.standingsChanges.slice(0, 3).join('\n');

  return {
    id: 'headline',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a single headline sentence summarizing this round's most newsworthy result. Be specific — reference a player or result.`,
    userPrompt: `Round: ${fp.roundName}\n\nMatch Results:\n${matchSummaries}\n\nStandings Movement:\n${topChanges || 'No rank changes'}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildStandingsStoryTask(fp: RecapFactPack): PromptTask {
  const standings = fp.currentStandings
    .map((s) => `${s.rank}. ${s.playerName}${s.gymType ? ` [${s.gymType}]` : ''}: ${s.points}pts (${s.recordString}) KD: ${s.kdString} — ${s.rankChange}`)
    .join('\n');

  return {
    id: 'standings_story',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite 2-3 sentences describing the standings shifts this round. COPY exact point totals and records verbatim from the data. Do NOT calculate or estimate — use the exact numbers provided.`,
    userPrompt: `Standings after ${fp.roundName}:\n${standings}\n\nKey movements:\n${fp.standingsChanges.join('\n') || 'No rank changes this round'}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildMetaTrendsTask(fp: RecapFactPack): PromptTask {
  const usage = fp.pokemonUsage
    .slice(0, 10)
    .map((u) => `${u.pokemonName}: brought ${u.timesBrought} time(s), ${u.totalKos} KOs`)
    .join('\n');

  return {
    id: 'meta_trends',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite 2-3 sentences about Pokémon usage patterns from THIS round's matches only. Reference the most-used Pokémon and notable performers. Gen ${fp.gen} context.`,
    userPrompt: `Pokémon usage this round:\n${usage}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildSpotlightTask(fp: RecapFactPack): PromptTask {
  return {
    id: 'spotlight_reason',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite 1-2 sentences explaining why this player was the best performer this round. Use specific stats from the data.`,
    userPrompt: `Player: ${fp.bestPerformer!.playerName}\nPerformance: ${fp.bestPerformer!.reason}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildSpicyPickTask(fp: RecapFactPack): PromptTask {
  return {
    id: 'spicy_context',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite 1-2 sentences about why this Pokémon pick is notable or unusual. Use the context provided.`,
    userPrompt: `Pokémon: ${fp.unusualPick!.pokemonName}\nPlayer: ${fp.unusualPick!.playerName}\nContext: ${fp.unusualPick!.reason}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildNarrativeTask(fp: RecapFactPack): PromptTask {
  // This task runs in stage 3 — the pipeline will inject one-liners from stage 1
  // into the user prompt before executing this task (see pipeline.ts)
  const context = [
    `Tournament: ${fp.tournamentName}`,
    `Round: ${fp.roundName} (Round ${fp.roundNumber})`,
    fp.leagueName ? `League: ${fp.leagueName}` : '',
    `Format: ${fp.format} | Best of ${fp.bestOf}`,
    '',
    'Match results (use these as the factual backbone):',
    ...fp.matches.map((m) => `- ${m.preWrittenOneLiner}`),
    '',
    'Standings summary:',
    ...fp.currentStandings.slice(0, 6).map((s) =>
      `${s.rank}. ${s.playerName}: ${s.points}pts (${s.recordString}) — ${s.rankChange}`
    ),
  ].filter(Boolean).join('\n');

  return {
    id: 'narrative',
    stage: 3,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a 3-5 paragraph analytical round recap. Lead with the most dramatic result. Reference specific Pokémon, scores, and standings implications. Frame through competitive stakes. Use paragraph breaks.`,
    userPrompt: context,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

// ─── Single-Call Recap Task ─────────────────────────────────────────

function buildSingleRecapTask(fp: RecapFactPack): PromptTask {
  const sections: string[] = [];

  // Context
  sections.push(`## CONTEXT`);
  if (fp.leagueName) sections.push(`League: ${fp.leagueName}`);
  sections.push(`Tournament: ${fp.tournamentName}`);
  sections.push(`Round: ${fp.roundName} (Round ${fp.roundNumber})`);
  sections.push(`Format: ${fp.format} | Best of ${fp.bestOf} | ${fp.scoring}`);

  // Matches
  sections.push('\n## MATCH RESULTS');
  for (const m of fp.matches) {
    sections.push(`\n### ${m.player1Name} vs ${m.player2Name}`);
    sections.push(`Result: ${m.winnerName} wins ${m.scoreString} (${m.marginDescription})`);
    sections.push(`Total KOs: ${m.player1Name} ${m.player1TotalKos} — ${m.player2Name} ${m.player2TotalKos}`);
    if (m.mvpPokemon) sections.push(`MVP: ${m.mvpPokemon} for ${m.mvpPlayerName} (${m.mvpKos} KOs)`);
    sections.push(`Factual summary: ${m.preWrittenOneLiner}`);
    if (m.keyPerformances.length > 0) {
      sections.push(`Key performances:\n${m.keyPerformances.map((kp) => `- ${kp}`).join('\n')}`);
    }
  }

  // Standings
  sections.push('\n## STANDINGS');
  for (const s of fp.currentStandings) {
    sections.push(`${s.rank}. ${s.playerName}${s.gymType ? ` [${s.gymType}]` : ''}: ${s.points}pts (${s.recordString}) KD: ${s.kdString} — ${s.rankChange}`);
  }

  // Best performer
  if (fp.bestPerformer) {
    sections.push(`\n## BEST PERFORMER: ${fp.bestPerformer.playerName} — ${fp.bestPerformer.reason}`);
  }
  if (fp.unusualPick) {
    sections.push(`\n## UNUSUAL PICK: ${fp.unusualPick.pokemonName} by ${fp.unusualPick.playerName} — ${fp.unusualPick.reason}`);
  }

  const systemPrompt = `${KALE_PERSONA}

${FACT_RULES}

SCORE RULES:
- "X-Y" means the winner had X Pokémon remaining, the loser had Y. 1-0 is the CLOSEST margin. 3-0+ is dominant.
- Each match includes a "margin description" and "factual summary" — these are correct. Use them.
- STANDINGS: Copy exact values verbatim. Do NOT recalculate.

Respond with a JSON object (no markdown fences):
{
  "headline": "1-sentence round summary",
  "narrative": "3-5 paragraph recap with \\n\\n paragraph breaks",
  "match_summaries": [{ "player_1_name": "", "player_2_name": "", "winner_name": "", "score": "", "one_liner": "", "mvp_pokemon": "" }],
  "standings_story": "2-3 sentences on standings shifts",
  "meta_trends": "2-3 sentences on Pokémon usage",
  "player_spotlight": { "player_name": "", "reason": "" },
  "spicy_pick": { "pokemon_name": "", "player_name": "", "context": "" } or null
}`;

  return {
    id: 'single_recap',
    stage: 1,
    systemPrompt,
    userPrompt: sections.join('\n'),
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

// ─── Forecast Prompt Tasks ──────────────────────────────────────────

export function buildForecastPromptTasks(factPack: ForecastFactPack, mode: PipelineMode): PromptTask[] {
  if (mode === 'single') return [buildSingleForecastTask(factPack)];
  return buildDecomposedForecastTasks(factPack);
}

function buildDecomposedForecastTasks(fp: ForecastFactPack): PromptTask[] {
  const tasks: PromptTask[] = [];

  // Stage 1: Per-matchup storylines (parallel)
  for (let i = 0; i < fp.matchups.length; i++) {
    tasks.push(buildMatchupStorylineTask(fp.matchups[i], i, fp));
  }

  // Stage 2: Independent sections (parallel)
  tasks.push(buildForecastHeadlineTask(fp));
  tasks.push(buildStandingsContextTask(fp));
  tasks.push(buildBoldPredictionTask(fp));

  // Stage 3: Narrative (depends on matchup storylines)
  tasks.push(buildForecastNarrativeTask(fp));

  return tasks;
}

function buildMatchupStorylineTask(matchup: MatchupFact, index: number, _fp: ForecastFactPack): PromptTask {
  const data = [
    `${matchup.player1Name} (${matchup.player1Record}, #${matchup.player1Rank ?? '?'}) vs ${matchup.player2Name} (${matchup.player2Record}, #${matchup.player2Rank ?? '?'})`,
    `Head-to-head: ${matchup.headToHead}`,
    matchup.player1Team.length > 0 ? `${matchup.player1Name}'s team: ${matchup.player1Team.join(', ')}` : '',
    matchup.player2Team.length > 0 ? `${matchup.player2Name}'s team: ${matchup.player2Team.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    id: `matchup_storyline_${index}`,
    stage: 1,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a JSON object for this matchup preview:\n{"storyline": "2-3 sentences on why this matters", "edge": "who has the edge and why", "key_pokemon": "the Pokémon to watch"}`,
    userPrompt: data,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildForecastHeadlineTask(fp: ForecastFactPack): PromptTask {
  const matchupSummaries = fp.matchups
    .map((m) => `${m.player1Name} (#${m.player1Rank ?? '?'}) vs ${m.player2Name} (#${m.player2Rank ?? '?'})`)
    .join('\n');

  return {
    id: 'forecast_headline',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a single headline sentence previewing this round's most compelling storyline.`,
    userPrompt: `Round: ${fp.roundName}\n\nMatchups:\n${matchupSummaries}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildStandingsContextTask(fp: ForecastFactPack): PromptTask {
  const standings = fp.currentStandings
    .map((s) => `${s.rank}. ${s.playerName}: ${s.points}pts (${s.recordString})`)
    .join('\n');

  return {
    id: 'standings_context',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite 2-3 sentences about what's at stake in the standings — advancement, elimination, must-win situations. Use exact numbers from the data.`,
    userPrompt: `Current standings:\n${standings}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildBoldPredictionTask(fp: ForecastFactPack): PromptTask {
  const data = fp.matchups
    .map((m) => `${m.player1Name} (${m.player1Record}) vs ${m.player2Name} (${m.player2Record}) — H2H: ${m.headToHead}`)
    .join('\n');

  return {
    id: 'bold_prediction',
    stage: 2,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nMake a single bold, specific prediction for this round. Take a stand — pick a winner or a surprising outcome. Be concrete.`,
    userPrompt: `Matchups:\n${data}`,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

function buildForecastNarrativeTask(fp: ForecastFactPack): PromptTask {
  const context = [
    `Tournament: ${fp.tournamentName}`,
    `Round: ${fp.roundName} (Round ${fp.roundNumber})`,
    fp.leagueName ? `League: ${fp.leagueName}` : '',
    `Format: ${fp.format} | Best of ${fp.bestOf}`,
    '',
    'Upcoming matchups:',
    ...fp.matchups.map((m) =>
      `- ${m.player1Name} (#${m.player1Rank ?? '?'}, ${m.player1Record}) vs ${m.player2Name} (#${m.player2Rank ?? '?'}, ${m.player2Record}) — H2H: ${m.headToHead}`
    ),
  ].filter(Boolean).join('\n');

  return {
    id: 'forecast_narrative',
    stage: 3,
    systemPrompt: `${KALE_PERSONA}\n\n${FACT_RULES}\n\nWrite a 2-3 paragraph preview covering the key matchups and what's at stake. Frame each matchup as a story. Make clear predictions with reasoning.`,
    userPrompt: context,
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}

// ─── Single-Call Forecast Task ──────────────────────────────────────

function buildSingleForecastTask(fp: ForecastFactPack): PromptTask {
  const sections: string[] = [];

  sections.push(`## CONTEXT`);
  if (fp.leagueName) sections.push(`League: ${fp.leagueName}`);
  sections.push(`Tournament: ${fp.tournamentName}`);
  sections.push(`Round: ${fp.roundName} (Round ${fp.roundNumber})`);
  sections.push(`Format: ${fp.format} | Best of ${fp.bestOf} | ${fp.scoring}`);

  sections.push('\n## STANDINGS');
  for (const s of fp.currentStandings) {
    sections.push(`${s.rank}. ${s.playerName}: ${s.points}pts (${s.recordString}) KD: ${s.kdString}`);
  }

  sections.push('\n## UPCOMING MATCHUPS');
  for (const m of fp.matchups) {
    sections.push(`\n### ${m.player1Name} (#${m.player1Rank ?? '?'}) vs ${m.player2Name} (#${m.player2Rank ?? '?'})`);
    sections.push(`Records: ${m.player1Name} ${m.player1Record} — ${m.player2Name} ${m.player2Record}`);
    sections.push(`Head-to-head: ${m.headToHead}`);
    if (m.player1Team.length > 0) sections.push(`${m.player1Name}'s team: ${m.player1Team.join(', ')}`);
    if (m.player2Team.length > 0) sections.push(`${m.player2Name}'s team: ${m.player2Team.join(', ')}`);
  }

  const systemPrompt = `${KALE_PERSONA}

${FACT_RULES}

Respond with a JSON object (no markdown fences):
{
  "headline": "1-sentence preview",
  "narrative": "2-3 paragraph preview with \\n\\n breaks",
  "matchup_previews": [{ "player_1_name": "", "player_2_name": "", "storyline": "", "edge": "", "key_pokemon": "" }],
  "standings_context": "2-3 sentences on stakes",
  "players_to_watch": [{ "player_name": "", "reason": "" }],
  "bold_prediction": "specific prediction"
}`;

  return {
    id: 'single_forecast',
    stage: 1,
    systemPrompt,
    userPrompt: sections.join('\n'),
    maxTokens: AI_MAX_TOKENS.kaleTask,
  };
}
