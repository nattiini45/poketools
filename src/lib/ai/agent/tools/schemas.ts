/**
 * Shared Zod input schemas for the AI agent's tool registry (PRD §5).
 *
 * Every tool has exactly one schema here. The same schema drives BOTH the
 * LLM function definition (Vercel AI SDK `tool({ inputSchema })`) and the
 * runtime argument validation before the executor runs. Tool executors are
 * pure data-in / data-out so any transport can format the result.
 *
 * Zod 4 syntax, consistent with `src/lib/validation/schemas.ts`.
 */
import { z } from 'zod';
import { pokemonTypeSchema } from '@/lib/validation/schemas';

// ─── Shared building blocks ──────────────────────────────────────────

/** A generation number (1–9), defaulting to the current gen. */
const genSchema = z.number().int().min(1).max(9).default(9);

/** Partial stat spread (EVs or IVs); missing stats are filled with defaults downstream. */
const statsPartialSchema = z.object({
  hp: z.number().int().min(0).max(252).optional(),
  atk: z.number().int().min(0).max(252).optional(),
  def: z.number().int().min(0).max(252).optional(),
  spa: z.number().int().min(0).max(252).optional(),
  spd: z.number().int().min(0).max(252).optional(),
  spe: z.number().int().min(0).max(252).optional(),
});

/** Partial IV spread (0–31 per stat; the calc would silently accept 252). */
const ivsPartialSchema = z.object({
  hp: z.number().int().min(0).max(31).optional(),
  atk: z.number().int().min(0).max(31).optional(),
  def: z.number().int().min(0).max(31).optional(),
  spa: z.number().int().min(0).max(31).optional(),
  spd: z.number().int().min(0).max(31).optional(),
  spe: z.number().int().min(0).max(31).optional(),
});

/** In-battle stat boosts (-6…+6 per stat). */
const boostsPartialSchema = z.object({
  atk: z.number().int().min(-6).max(6).optional(),
  def: z.number().int().min(-6).max(6).optional(),
  spa: z.number().int().min(-6).max(6).optional(),
  spd: z.number().int().min(-6).max(6).optional(),
  spe: z.number().int().min(-6).max(6).optional(),
});

const statusSchema = z.enum(['brn', 'par', 'psn', 'tox', 'slp', 'frz']);

// ─── Layer 1 — Deterministic @pkmn / calc / validation ───────────────

/** Look up a single Pokémon's types, stats, abilities, weight, tier and movepool size. */
export const LookupPokemonInput = z.object({
  species: z.string().min(1), // e.g. "Garchomp"
  gen: genSchema,
});
export type LookupPokemonInput = z.infer<typeof LookupPokemonInput>;

/** Get the type-effectiveness matrix against a 1- or 2-type defending combo. */
export const GetTypeChartInput = z.object({
  types: z.array(pokemonTypeSchema).min(1).max(2), // defending type combo, e.g. ["Ground","Flying"]
  gen: genSchema,
});
export type GetTypeChartInput = z.infer<typeof GetTypeChartInput>;

/** Get a species' learnable moves grouped by learn method for a generation. */
export const GetLearnsetInput = z.object({
  species: z.string().min(1),
  gen: genSchema,
});
export type GetLearnsetInput = z.infer<typeof GetLearnsetInput>;

/** A single combatant for the damage calculator (names are checked against the dex by the tool). */
const calcPokemonSchema = z.object({
  species: z.string().min(1).max(64),
  item: z.string().max(64).optional(),
  ability: z.string().max(64).optional(),
  nature: z.string().max(64).optional(),
  evs: statsPartialSchema.optional(),
  ivs: ivsPartialSchema.optional(),
  level: z.number().int().min(1).max(100).optional(),
  boosts: boostsPartialSchema.optional(),
  status: statusSchema.optional(),
  teraType: z.string().max(64).optional(),
  isTera: z.boolean().optional(),
});

/** Field / side conditions for a damage calc. */
const calcFieldSchema = z.object({
  gameType: z.enum(['Singles', 'Doubles']).optional(),
  weather: z.enum(['Sun', 'Rain', 'Sand', 'Snow', 'Harsh Sunshine', 'Heavy Rain']).optional(),
  terrain: z.enum(['Electric', 'Grassy', 'Misty', 'Psychic']).optional(),
  isStealthRock: z.boolean().optional(), // defender side
  spikes: z.number().int().min(0).max(3).optional(), // defender side
  isReflect: z.boolean().optional(),
  isLightScreen: z.boolean().optional(),
  isBeadsOfRuin: z.boolean().optional(),
  isSwordOfRuin: z.boolean().optional(),
  isTabletsOfRuin: z.boolean().optional(),
  isVesselOfRuin: z.boolean().optional(),
});

/** Compute @smogon/calc damage for one attacker → defender + move (+ optional field). */
export const CalculateDamageInput = z.object({
  gen: genSchema,
  attacker: calcPokemonSchema,
  defender: calcPokemonSchema,
  move: z.string().min(1).max(64),
  field: calcFieldSchema.optional(),
});
export type CalculateDamageInput = z.infer<typeof CalculateDamageInput>;

/** One set in a team submitted for legality validation. */
const teamSetSchema = z.object({
  species: z.string().min(1),
  item: z.string().optional(),
  ability: z.string().optional(),
  nature: z.string().optional(),
  evs: statsPartialSchema.optional(),
  ivs: statsPartialSchema.optional(),
  level: z.number().int().min(1).max(100).optional(),
  moves: z.array(z.string().min(1)).min(1).max(4),
  teraType: z.string().optional(),
});

/**
 * A league ruleset id whose real bans/clauses/team-constraints should gate
 * legality (instead of a synthetic base-format ruleset). Optional and lenient —
 * an unresolvable id soft-falls back to the base format server-side.
 */
export const rulesetIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    'The league ruleset id from the "League ruleset" context section, when present. Validates the team against the league\'s real bans, clauses and team constraints instead of the bare base format.',
  );
/** The player's assigned Core Liga triple (three type names). */
export const playerCoreSchema = z
  .array(z.string().min(1))
  .length(3)
  .optional()
  .describe(
    "The player's three assigned core types from the context (e.g. [\"Fire\",\"Water\",\"Grass\"]). Required for leagues whose type quota is based on the player core.",
  );

/** Validate a team's legality (species/move/ability/item/learnset) for a format. */
export const ValidateTeamInput = z.object({
  // Allow more than 6 so the tool itself can flag oversized teams.
  team: z.array(teamSetSchema).min(1).max(12),
  format: z.string().min(1), // e.g. "gen9ou"
  ruleset_id: rulesetIdSchema,
  player_core: playerCoreSchema,
});
export type ValidateTeamInput = z.infer<typeof ValidateTeamInput>;

/** Global Smogon usage stats (top mons/moves/items/spreads) for a format. */
export const GetUsageStatsInput = z.object({
  format: z.string().min(1),
  timeRange: z.string().min(1).optional(), // e.g. "2024-01"; defaults to latest cached
});
export type GetUsageStatsInput = z.infer<typeof GetUsageStatsInput>;

// ─── Layer 2 — League data (wraps existing query modules) ────────────

/** Query league/tournament data (participants, standings, aggregates). */
export const QueryLeagueDataInput = z.object({
  scope: z
    .object({
      type: z.enum(['tournament', 'league', 'all_time']),
      id: z.string().uuid().optional(), // required for tournament/league scope
    })
    // tournament/league scopes target a specific row, so `id` must be present;
    // all_time is global and leaves `id` unset. Reject invalid calls here so the
    // tool never runs against a half-specified scope.
    .superRefine((scope, ctx) => {
      if ((scope.type === 'tournament' || scope.type === 'league') && !scope.id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `scope.id is required for ${scope.type} scope`,
          path: ['id'],
        });
      }
    }),
  infoType: z.enum(['participants', 'standings', 'aggregates']),
});
export type QueryLeagueDataInput = z.infer<typeof QueryLeagueDataInput>;

/** Get a player's completed match history (optionally scoped to one tournament). */
export const GetMatchHistoryInput = z.object({
  playerId: z.string().uuid(),
  tournamentId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});
export type GetMatchHistoryInput = z.infer<typeof GetMatchHistoryInput>;

/** Get a player's upcoming (scheduled / pending) matches. */
export const GetUpcomingMatchesInput = z.object({
  playerId: z.string().uuid(),
});
export type GetUpcomingMatchesInput = z.infer<typeof GetUpcomingMatchesInput>;

/** Fetch the full battle context (stats, teams, rules, turn-by-turn) for one match. */
export const GetMatchAnalysisContextInput = z.object({
  matchId: z.string().uuid(),
});
export type GetMatchAnalysisContextInput = z.infer<typeof GetMatchAnalysisContextInput>;

// ─── Layer 3 — Strategy knowledge (RAG deferred) ─────────────────────

/** Search Smogon analyses / recommended sets for strategy excerpts. */
export const SearchStrategyKnowledgeInput = z.object({
  query: z.string().min(1),
  format: z.string().min(1).optional(),
  gen: z.number().int().min(1).max(9).optional(),
});
export type SearchStrategyKnowledgeInput = z.infer<typeof SearchStrategyKnowledgeInput>;

// ─── Pokepaste publishing ────────────────────────────────────────────

/** Publish a Showdown-format team export to pokepast.es and return its URL. */
export const CreatePokepasteInput = z.object({
  /** Showdown export text for the full team (one or more sets). */
  paste: z.string().min(1),
  title: z.string().max(200).optional(),
  author: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type CreatePokepasteInput = z.infer<typeof CreatePokepasteInput>;

// ─── Meta-tool ───────────────────────────────────────────────────────

/** Assemble a legal team around optional cores/items/moves (chains lookup→usage→calc→validate). */
export const BuildTeamInput = z.object({
  format: z.string().min(1),
  core_pokemon: z.array(z.string().min(1)).max(2).optional(),
  requested_items: z.record(z.string(), z.string()).optional(),
  requested_moves: z.record(z.string(), z.array(z.string())).optional(),
  team_size: z.number().int().min(1).max(6).default(6),
  ruleset_id: rulesetIdSchema,
  player_core: playerCoreSchema,
});
export type BuildTeamInput = z.infer<typeof BuildTeamInput>;
