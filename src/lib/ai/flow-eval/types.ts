import type { ForecastFactPack, RecapFactPack } from '../kale/types';
import type { NarrativeInput } from '../recap-prompt';
import type { CoachPokemonSet } from '@/lib/validation';

/** The Claude text flows the eval covers, in the order a full run executes them. */
export const FLOW_IDS = [
  'kale-recap',
  'kale-forecast',
  'match-analysis',
  'scouting',
  'team-coach',
  'slot-coach',
  'recap',
] as const;
export type FlowId = (typeof FLOW_IDS)[number];

export const EVAL_EFFORTS = ['low', 'medium', 'high'] as const;
export type EvalEffort = (typeof EVAL_EFFORTS)[number];

export type Locale = 'en' | 'de';

// ─── Fixtures ───────────────────────────────────────────────────────

interface CaseBase {
  id: string;
  /** One line saying what the case exercises (shown in --list and the report). */
  label: string;
  locale: Locale;
}

/** A Kale round recap: the fact pack goes through the app's own `buildRecapPromptTasks`. */
export interface KaleRecapCase extends CaseBase {
  factPack: RecapFactPack;
}

/** A Kale round forecast, through `buildForecastPromptTasks`. */
export interface KaleForecastCase extends CaseBase {
  factPack: ForecastFactPack;
}

/** What the match-analysis grader knows about the match, taken from the data the prompt was built from. */
export interface MatchAnalysisExpect {
  player1: string;
  player2: string;
  /** Name of the player who won the match. */
  matchWinner: string;
  /** Winner of each game, in game order. */
  games: { gameNumber: number; winner: string }[];
  /** The league imposes a per-player type constraint (gym typing or assigned core types). */
  hasLeagueConstraint: boolean;
  gen: number;
}

/** A post-match analysis: the prompts are rendered by the app's `buildMatchAnalysisPrompt`. */
export interface MatchAnalysisCase extends CaseBase {
  /** System prompt before the output-language line (added at run time). */
  systemPrompt: string;
  userPrompt: string;
  expect: MatchAnalysisExpect;
}

export interface ScoutingExpect {
  opponent: string;
  /** Species the opponent's history (or team sheet) names; empty when there is no history. */
  opponentSpecies: string[];
  /** The requesting player's gym type, when the league is a gym-leader league. */
  userGymType: string | null;
  gen: number;
}

/** A match-prep scouting report: prompts rendered by `buildMatchPrepPrompt`. */
export interface ScoutingCase extends CaseBase {
  systemPrompt: string;
  userPrompt: string;
  hasUserTeam: boolean;
  expect: ScoutingExpect;
}

export interface TeamCoachCase extends CaseBase {
  team: CoachPokemonSet[];
  format: string;
  generation: number;
}

export interface SlotCoachCase extends CaseBase {
  set: CoachPokemonSet;
  team: CoachPokemonSet[];
  format: string;
  generation: number;
}

export interface RecapCase extends CaseBase {
  input: NarrativeInput;
}

export interface CaseByFlow {
  'kale-recap': KaleRecapCase;
  'kale-forecast': KaleForecastCase;
  'match-analysis': MatchAnalysisCase;
  scouting: ScoutingCase;
  'team-coach': TeamCoachCase;
  'slot-coach': SlotCoachCase;
  recap: RecapCase;
}

export type AnyCase = CaseByFlow[FlowId];

export interface FixtureFile<F extends FlowId = FlowId> {
  schemaVersion: 1;
  flow: F;
  /** True for hand-authored data safe to commit; false for anything derived from real data. */
  synthetic: boolean;
  cases: CaseByFlow[F][];
}

// ─── Calls ──────────────────────────────────────────────────────────

/** One model call as a flow asks for it. */
export interface CallRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** The production caller parses the answer as JSON. */
  jsonOutput: boolean;
  /** Usage-log label the production caller uses for this flow. */
  surface: string;
}

/** What a call returned, in the units of the provider's usage report. */
export interface ModelResponse {
  content: string;
  /** Model id the provider reports it ran. */
  model: string;
  /** Fresh input + cache writes + cache reads. */
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  stopReason: string | null;
  stopCategory: string | null;
  /** True when the fallback model produced the answer. */
  fallbackUsed: boolean;
}

export interface CallSettings {
  model: string;
  effort: EvalEffort;
}

export type ModelCaller = (request: CallRequest, settings: CallSettings) => Promise<ModelResponse>;

export type CallErrorKind = 'truncated' | 'refused' | 'rejected' | 'transient' | 'other';

export interface CallRecord {
  taskId: string;
  requestedModel: string;
  servedModel: string | null;
  effort: EvalEffort;
  maxTokens: number;
  /** Total prompt tokens (fresh + cache). Estimated when the call failed before a usage report. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Output tokens, thinking included. */
  outputTokens: number;
  /** Visible answer length in characters; the output tokens minus its token estimate is mostly thinking. */
  outputChars: number;
  ms: number;
  costUsd: number;
  /** True when the cost is an estimate (the call failed, so the provider reported no usage). */
  costEstimated: boolean;
  stopReason: string | null;
  truncated: boolean;
  refused: boolean;
  /** The fallback model answered, or the served model is not the requested one. */
  fallback: boolean;
  error: CallErrorKind | null;
}

export interface Check {
  id: string;
  /** A failed hard check fails the run; a failed soft check is reported only. */
  hard: boolean;
  pass: boolean;
  detail?: string;
}

export interface ValidatorCounts {
  wrong_score: number;
  wrong_player: number;
  wrong_pokemon: number;
  wrong_number: number;
  structural: number;
}

export interface RunRow {
  key: string;
  flow: FlowId;
  caseId: string;
  repeat: number;
  calls: CallRecord[];
  checks: Check[];
  /** All hard checks passed and every call completed. */
  pass: boolean;
  /** Some calls never ran because the cost cap was reached. */
  incomplete: boolean;
  validator: ValidatorCounts;
  /** The model output per task (`main` for single-call flows). */
  outputs: Record<string, string>;
}

export function emptyValidatorCounts(): ValidatorCounts {
  return { wrong_score: 0, wrong_player: 0, wrong_pokemon: 0, wrong_number: 0, structural: 0 };
}

export function rowKey(flow: FlowId, caseId: string, repeat: number): string {
  return `${flow}/${caseId}/r${repeat}`;
}
