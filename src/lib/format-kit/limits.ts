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

// Phase 3 primitives: attributes, domains, relations, resources, metrics, tunables, events and actions.
export const MAX_ATTRIBUTES = 32;
export const MAX_ENUM_VALUES = 32;
export const MAX_DOMAINS = 16;
export const MAX_DOMAIN_ENTRIES = 512;
export const MAX_ENTRY_ATTRS = 16;
export const MAX_MULTI_VALUES = 8;
export const MAX_RELATIONS = 8;
export const MAX_RESOURCES = 16;
export const MAX_CAPACITY = 64;
export const MAX_METRICS = 32;
export const MAX_TRACK_STEPS = 16;
export const MAX_PLACEMENT_POINTS = 64;
export const MAX_TUNABLES = 32;
export const MAX_TABLE_VALUES = 64;
export const MAX_EFFECTS = 16;
export const MAX_ACTION_STEPS = 8;
export const MAX_STEP_COUNT = 16;
export const MAX_EVENT_ROUND = 64;
export const MAX_GRANT = 64;

// Phase 4 primitives: bipartite, filter and challenge pairings, team constraints, calendars and stage ends.
export const MAX_SIDE_VALUES = 32;
export const MAX_BIPARTITE_ROUNDS = 32;
export const MAX_CHALLENGE_ROUNDS = 64;
export const MAX_CHALLENGE_RANK_RANGE = 64;
export const MAX_CHALLENGE_OPEN = 8;
export const MAX_CHALLENGE_COOLDOWN = 16;
export const MAX_CHALLENGE_WINDOW_HOURS = 336;
export const MAX_CONSTRAINTS = 32;
/** Pokémon on one team. */
export const MAX_TEAM_SIZE = 6;
export const MAX_COUNT_SPECIES = 64;
export const MIN_COUNT_ANY_OF = 2;
export const MAX_COUNT_ANY_OF = 6;
/** How many `any_of` / `not` levels a count source may nest (the types in `types.ts` have exactly this many). */
export const MAX_COUNT_SOURCE_DEPTH = 2;
export const MAX_QUOTA_TYPES = 18;
export const MAX_TYPE_NAME_CHARS = 16;
export const MAX_CALENDAR_EVERY = 28;
export const MAX_CALENDAR_WINDOW_HOURS = 672;
export const MAX_CALENDAR_MARKS = 16;
export const MAX_CALENDAR_ROUND = 64;
/** The longest text of a calendar date (YYYY-MM-DD) and of a time of day (HH:MM). */
export const CALENDAR_DATE_CHARS = 10;
export const CALENDAR_TIME_CHARS = 5;
export const MAX_CALENDAR_OFFSET_HOURS = 672;
export const MAX_DEADLINES = 8;
export const MAX_END_ROUNDS = 64;

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
  maxAttributes: MAX_ATTRIBUTES,
  maxEnumValues: MAX_ENUM_VALUES,
  maxDomains: MAX_DOMAINS,
  maxDomainEntries: MAX_DOMAIN_ENTRIES,
  maxEntryAttrs: MAX_ENTRY_ATTRS,
  maxMultiValues: MAX_MULTI_VALUES,
  maxRelations: MAX_RELATIONS,
  maxResources: MAX_RESOURCES,
  maxCapacity: MAX_CAPACITY,
  maxMetrics: MAX_METRICS,
  maxTrackSteps: MAX_TRACK_STEPS,
  maxPlacementPoints: MAX_PLACEMENT_POINTS,
  maxTunables: MAX_TUNABLES,
  maxTableValues: MAX_TABLE_VALUES,
  maxEffects: MAX_EFFECTS,
  maxActionSteps: MAX_ACTION_STEPS,
  maxStepCount: MAX_STEP_COUNT,
  maxEventRound: MAX_EVENT_ROUND,
  maxGrant: MAX_GRANT,
  maxSideValues: MAX_SIDE_VALUES,
  maxBipartiteRounds: MAX_BIPARTITE_ROUNDS,
  maxChallengeRounds: MAX_CHALLENGE_ROUNDS,
  maxChallengeRankRange: MAX_CHALLENGE_RANK_RANGE,
  maxChallengeOpen: MAX_CHALLENGE_OPEN,
  maxChallengeCooldown: MAX_CHALLENGE_COOLDOWN,
  maxChallengeWindowHours: MAX_CHALLENGE_WINDOW_HOURS,
  maxConstraints: MAX_CONSTRAINTS,
  maxTeamSize: MAX_TEAM_SIZE,
  maxCountSpecies: MAX_COUNT_SPECIES,
  minCountAnyOf: MIN_COUNT_ANY_OF,
  maxCountAnyOf: MAX_COUNT_ANY_OF,
  maxCountSourceDepth: MAX_COUNT_SOURCE_DEPTH,
  maxQuotaTypes: MAX_QUOTA_TYPES,
  maxTypeNameChars: MAX_TYPE_NAME_CHARS,
  maxCalendarEvery: MAX_CALENDAR_EVERY,
  maxCalendarWindowHours: MAX_CALENDAR_WINDOW_HOURS,
  maxCalendarMarks: MAX_CALENDAR_MARKS,
  maxCalendarRound: MAX_CALENDAR_ROUND,
  calendarDateChars: CALENDAR_DATE_CHARS,
  calendarTimeChars: CALENDAR_TIME_CHARS,
  maxCalendarOffsetHours: MAX_CALENDAR_OFFSET_HOURS,
  maxDeadlines: MAX_DEADLINES,
  maxEndRounds: MAX_END_ROUNDS,
} as const;
