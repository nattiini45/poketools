/**
 * Agent tool registry (PRD §5). One entry per tool, each pairing:
 *   - a stable `name` (the LLM function name),
 *   - a 1–2 sentence `description` written for the model,
 *   - the Zod `inputSchema` from `schemas.ts` (drives BOTH the LLM function
 *     definition and runtime validation),
 *   - an `execute` adapter over the pure executor.
 *
 * Dispatch + caching live in `execute.ts`; this module is data only. The 10
 * LLM-facing tools (`LLM_TOOL_NAMES`) are the §5 set; `buildTeam` (meta-tool)
 * and `createPokepaste` (publishing) are also registered so `executeTool` can
 * dispatch them, but they are not part of the default LLM tool list.
 */
import { z } from 'zod';
import {
  LookupPokemonInput,
  GetTypeChartInput,
  GetLearnsetInput,
  CalculateDamageInput,
  ValidateTeamInput,
  ValidateTeamModelInput,
  GetUsageStatsInput,
  QueryLeagueDataInput,
  GetMatchHistoryInput,
  GetMatchHistoryModelInput,
  GetUpcomingMatchesInput,
  GetUpcomingMatchesModelInput,
  GetMatchAnalysisContextInput,
  GetMatchAnalysisContextModelInput,
  SearchStrategyKnowledgeInput,
  CreatePokepasteInput,
  BuildTeamInput,
  BuildTeamModelInput,
} from './schemas';
import { lookupPokemon, getTypeChart, getLearnset } from './pkmn';
import { calculateDamage } from './calc';
import { validateTeam } from './validate';
import { getUsageStats, searchStrategyKnowledge } from './smogon';
import { queryLeagueData, getMatchHistory, getUpcomingMatches } from './supabase';
import { getMatchAnalysisContext } from './match-context';
import { createPokepaste } from './pokepaste';
import { buildTeam } from './team-builder';

// ─── Tool type ───────────────────────────────────────────────────────

export interface AgentTool {
  name: string;
  description: string;
  /** The STRICT schema `executeTool` validates with, after the server has set its own fields (`applyToolOverrides`). */
  inputSchema: z.ZodTypeAny;
  /**
   * What the model is shown and validated against, when it differs: it leaves out the fields the server sets and
   * relaxes the ones it overwrites, so a value the model invents there cannot fail the call before the override runs.
   */
  modelInputSchema?: z.ZodTypeAny;
  /** Runs the executor over already-validated input (parsed by the schema). */
  execute: (input: unknown) => Promise<unknown>;
}

/** Bind a schema to its executor so `execute` always receives typed input. */
function defineTool<S extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: S,
  run: (input: z.infer<S>) => unknown | Promise<unknown>,
  modelSchema?: z.ZodTypeAny,
): AgentTool {
  return {
    name,
    description,
    inputSchema: schema,
    modelInputSchema: modelSchema,
    execute: async (input) => run(input as z.infer<S>),
  };
}

// ─── Registry ────────────────────────────────────────────────────────

const TOOLS: AgentTool[] = [
  defineTool(
    'lookupPokemon',
    'Look up a single Pokémon by species name: its types, base stats, abilities, weight, competitive tier, and movepool size. Use this before reasoning about any specific Pokémon.',
    LookupPokemonInput,
    lookupPokemon,
  ),
  defineTool(
    'getTypeChart',
    'Return the type-effectiveness multiplier of every attacking type against a 1- or 2-type defending combination. Use it to find a defender\'s weaknesses, resistances, and immunities.',
    GetTypeChartInput,
    getTypeChart,
  ),
  defineTool(
    'getLearnset',
    'List the moves a species can legally learn in a generation, grouped by learn method (level-up, machine, egg, tutor, event). Use it to confirm a move is legal before recommending it.',
    GetLearnsetInput,
    getLearnset,
  ),
  defineTool(
    'calculateDamage',
    'Run a @smogon/calc damage calculation for one attacker → defender + move (with optional field/weather/terrain/screens). Returns damage %, KO chance, and rolls. Always use this for damage — never estimate it yourself.',
    CalculateDamageInput,
    calculateDamage,
  ),
  defineTool(
    'validateTeam',
    'Check a team\'s legality for a format (species/move/ability/item existence, learnset legality, EV limits, and clauses). Returns per-Pokémon and team-level issues. Validate before presenting any team to the user.',
    ValidateTeamInput,
    validateTeam,
    ValidateTeamModelInput,
  ),
  defineTool(
    'getUsageStats',
    'Fetch global Smogon usage statistics for a format: the most-used Pokémon with their most common moves, items, abilities, EV spreads, and tera types. Use it to ground recommendations in the live metagame.',
    GetUsageStatsInput,
    getUsageStats,
  ),
  defineTool(
    'queryLeagueData',
    'Query this app\'s league/tournament data for a scope (tournament/league/all-time): the participant roster, standings, or pre-computed Pokémon usage aggregates.',
    QueryLeagueDataInput,
    queryLeagueData,
  ),
  defineTool(
    'getMatchHistory',
    'Get a player\'s completed match history (opponent, win/loss, game score, date, replay URLs), optionally scoped to one tournament. Use it to scout an opponent or summarise a player\'s record.',
    GetMatchHistoryInput,
    getMatchHistory,
    GetMatchHistoryModelInput,
  ),
  defineTool(
    'getUpcomingMatches',
    'Get a player\'s scheduled or pending (not-yet-played) matches, including the opponent and status. Use it to prepare a player for what is next.',
    GetUpcomingMatchesInput,
    getUpcomingMatches,
    GetUpcomingMatchesModelInput,
  ),
  defineTool(
    'getMatchAnalysisContext',
    'Fetch the complete battle context for a specific match by id: per-game battle stats (leads, KOs, moves), team sheets with abilities/items, league & format rules, and the turn-by-turn summary — including who set each weather and terrain. Call this FIRST when analysing or recapping a specific match; it is the only source of what actually happened in the game (the other tools return aggregates and replay URLs, not parsed events).',
    GetMatchAnalysisContextInput,
    getMatchAnalysisContext,
    GetMatchAnalysisContextModelInput,
  ),
  defineTool(
    'searchStrategyKnowledge',
    'Search Smogon analyses and recommended sets for strategy context, returning up to 3 trimmed excerpts. Use it for qualitative "how is this Pokémon used / what counters it" questions.',
    SearchStrategyKnowledgeInput,
    searchStrategyKnowledge,
  ),
  // ── Non-LLM-default tools (still dispatchable) ────────────────────
  defineTool(
    'createPokepaste',
    'Publish a Showdown-format team export to pokepast.es and return the shareable paste URL.',
    CreatePokepasteInput,
    createPokepaste,
  ),
  defineTool(
    'buildTeam',
    'Meta-tool: assemble a full, legal team for a format around optional core Pokémon and locked items/moves. Deterministically chains lookup → usage → type-coverage → validation and returns the team, a pokepaste link, and threat coverage.',
    BuildTeamInput,
    buildTeam,
    BuildTeamModelInput,
  ),
];

/** All registered tools, keyed by name. */
export const AGENT_TOOLS: Record<string, AgentTool> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

/** The 10 LLM-facing tools from PRD §5 (excludes buildTeam / createPokepaste). */
export const LLM_TOOL_NAMES = [
  'lookupPokemon',
  'getTypeChart',
  'getLearnset',
  'calculateDamage',
  'validateTeam',
  'getUsageStats',
  'queryLeagueData',
  'getMatchHistory',
  'getUpcomingMatches',
  'searchStrategyKnowledge',
] as const;

export type LlmToolName = (typeof LLM_TOOL_NAMES)[number];
