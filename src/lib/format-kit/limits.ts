/**
 * Hard limits of the format definition document. Every limit lives here once: the zod schema, the
 * Spec-driven browser validator, the registry and the tests read the same numbers.
 *
 * The key pattern (1..32 chars) is owned by `keys.ts`; the expression limits by `expr/limits.ts`
 * and are re-exported below so a consumer needs one import. The longest text value (`LTEXT_MAX_CHARS`) is owned by
 * the studio core's `ltext.ts`, next to `LText`; it is listed in `LIMITS` but not re-exported.
 */
import { LTEXT_MAX_CHARS } from '@/lib/studio-core/ltext';


/** Largest accepted document body (canonical JSON bytes). */
export const MAX_BODY_BYTES = 262_144;
/** Largest accepted JSON node count of one document, before any structural parsing. */
export const JSON_MAX_NODES = 150_000;
/** Deepest accepted JSON nesting of one document, before any structural parsing. */
export const JSON_MAX_DEPTH = 64;

export const MAX_STAGES = 50;
export const MAX_EDGES = 100;
export const MAX_RULES = 200;
export const MAX_TEXT_SECTIONS = 32;
export const MAX_VIEWS = 8;
export const MAX_MODULES = 3;
export const MAX_FACTS = 64;
export const MAX_RANK_STEPS = 12;
export const MAX_COLUMNS = 12;
export const MAX_SELECTS = 4;
export const MAX_OVERRIDES = 32;
export const MIN_GROUPS = 2;
export const MAX_GROUPS = 26;
export const MAX_LEGS = 4;
export const MAX_BEST_OF = 15;
export const MIN_PLAYERS_PER_MATCH = 2;
export const MAX_PLAYERS_PER_MATCH = 8;
export const MAX_N = 1024;
export const MAX_N_PER_GROUP = 64;
export const MAX_SWISS_ROUNDS = 32;
export const MAX_OVERRIDE_ROUND = 64;
export const MAX_EXPECTED_COUNT = 4096;
export const MAX_VIEW_STAGES = 50;
export const SCORE_ABS_MAX = 1000;

export {
  COLLECTION_ASSUMED_MAX,
  EXPR_MAX_ARGS,
  EXPR_MAX_DEPTH,
  EXPR_MAX_NODES,
  EXPR_MAX_SET,
  EXPR_MAX_SOURCE_CHARS,
  EXPR_MAX_STRING,
  EXPR_NUM_LIMIT,
  EXPR_SCHEMA_MAX_DEPTH,
  EXPR_SCHEMA_MAX_NODES,
  EXPR_STEP_BUDGET,
} from './expr/limits';

/** The document limits as one object (the snapshot in `limits.test.ts` pins it). */
export const DOCUMENT_LIMITS = {
  maxBodyBytes: MAX_BODY_BYTES,
  jsonMaxNodes: JSON_MAX_NODES,
  jsonMaxDepth: JSON_MAX_DEPTH,
  maxStages: MAX_STAGES,
  maxEdges: MAX_EDGES,
  maxRules: MAX_RULES,
  maxTextSections: MAX_TEXT_SECTIONS,
  maxViews: MAX_VIEWS,
  maxModules: MAX_MODULES,
  maxFacts: MAX_FACTS,
  maxRankSteps: MAX_RANK_STEPS,
  maxColumns: MAX_COLUMNS,
  maxSelects: MAX_SELECTS,
  maxOverrides: MAX_OVERRIDES,
  minGroups: MIN_GROUPS,
  maxGroups: MAX_GROUPS,
  maxLegs: MAX_LEGS,
  maxBestOf: MAX_BEST_OF,
  minPlayersPerMatch: MIN_PLAYERS_PER_MATCH,
  maxPlayersPerMatch: MAX_PLAYERS_PER_MATCH,
  maxN: MAX_N,
  maxNPerGroup: MAX_N_PER_GROUP,
  maxSwissRounds: MAX_SWISS_ROUNDS,
  maxOverrideRound: MAX_OVERRIDE_ROUND,
  maxExpectedCount: MAX_EXPECTED_COUNT,
  maxViewStages: MAX_VIEW_STAGES,
  ltextMaxChars: LTEXT_MAX_CHARS,
  scoreAbsMax: SCORE_ABS_MAX,
} as const;
