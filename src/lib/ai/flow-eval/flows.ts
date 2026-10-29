/**
 * The seven flows of the eval: how a fixture case becomes model calls (`planCase`, pure and
 * offline, also what `--dry-run` prints) and how a case is run and graded (`executeCase`).
 *
 * Prompts come from the app's own builders:
 * - Kale: `buildRecapPromptTasks` / `buildForecastPromptTasks` over the fixture's fact pack,
 *   run stage by stage like `kale/pipeline.ts` (tasks of a stage in parallel, the one-liners
 *   injected into the narrative). There are no validation retries: the first answer of each
 *   task is what is graded, so the validator errors measure the model, not the retry loop.
 * - Match analysis and scouting: the fixture holds the prompts that `buildMatchAnalysisPrompt` /
 *   `buildMatchPrepPrompt` rendered from synthetic data (see `synthetic/build-fixtures.test.ts`);
 *   the output-language line is added here, as the routes add it.
 * - Coaches and recap: the prompt builders the routes and the recap engine import
 *   (`coach-prompts.ts`, `recap-prompt.ts`).
 *
 * The JSON flows (analysis, scouting) ask with `jsonOutput`, as the routes do: an answer cut off at
 * `max_tokens` (thinking included, even when no text came out) throws `OutputCapError` and is
 * recorded as truncated. The provider reports no usage for a thrown call, so its cost is estimated
 * at the worst case. Likewise the cost cap holds for both attempts of the primary/fallback ladder:
 * see `runCall`.
 */

import { AI_MAX_TOKENS, getClaudeFallbackModelId } from '../constants';
import { injectOneLinerResults } from '../kale/inject';
import { buildForecastPromptTasks, buildRecapPromptTasks } from '../kale/prompts';
import type { PromptTask } from '../kale/types';
import { buildSlotCoachSystemPrompt, buildSlotCoachUserPrompt, buildTeamCoachSystemPrompt, buildTeamCoachUserPrompt } from '../coach-prompts';
import { withOutputLanguage } from '../language';
import { buildNarrativePrompt, RECAP_NARRATIVE_SYSTEM_PROMPT } from '../recap-prompt';
import { CostGuard } from './cost-guard';
import {
  gradeCall,
  gradeKaleTask,
  gradeMatchAnalysis,
  gradeRecap,
  gradeScouting,
  gradeSlotCoach,
  gradeTeamCoach,
  servedDiffersFromRequested,
  type SpeciesLookup,
} from './graders';
import { baseModelId, callCostUsd, estimateTokens, priceOf, worstCaseCostUsd } from './pricing';
import {
  emptyValidatorCounts,
  type AnyCase,
  type CallErrorKind,
  type CallRecord,
  type CallSettings,
  type CaseByFlow,
  type Check,
  type FlowId,
  type KaleForecastCase,
  type KaleRecapCase,
  type MatchAnalysisCase,
  type ModelCaller,
  type RecapCase,
  type ScoutingCase,
  type SlotCoachCase,
  type TeamCoachCase,
  type ValidatorCounts,
} from './types';
import { isDeterministicModelError, OutputCapError, RefusalError } from '../errors';

// ─── Planning ───────────────────────────────────────────────────────

export interface PlannedCall {
  taskId: string;
  /** Execution stage; calls of one stage run in parallel. */
  stage: number;
  system: string;
  user: string;
  maxTokens: number;
  surface: string;
  /** The production caller parses the answer as JSON and asks with jsonOutput. */
  jsonOutput: boolean;
}

/**
 * What a call of each task typically produces at `medium` effort, thinking included. Only the
 * dry-run estimate uses these; a live run reports the measured numbers. Calibrate them from a run.
 */
const EXPECTED_OUTPUT_TOKENS = {
  kaleTask: 700,
  kaleNarrative: 1_200,
  analysis: 5_500,
  scouting: 5_000,
  teamCoach: 2_200,
  slotCoach: 1_400,
  recap: 600,
} as const;

export function expectedOutputTokens(flow: FlowId, taskId: string): number {
  switch (flow) {
    case 'kale-recap':
    case 'kale-forecast':
      return taskId.includes('narrative') ? EXPECTED_OUTPUT_TOKENS.kaleNarrative : EXPECTED_OUTPUT_TOKENS.kaleTask;
    case 'match-analysis':
      return EXPECTED_OUTPUT_TOKENS.analysis;
    case 'scouting':
      return EXPECTED_OUTPUT_TOKENS.scouting;
    case 'team-coach':
      return EXPECTED_OUTPUT_TOKENS.teamCoach;
    case 'slot-coach':
      return EXPECTED_OUTPUT_TOKENS.slotCoach;
    case 'recap':
      return EXPECTED_OUTPUT_TOKENS.recap;
  }
}

const fromKaleTask = (task: PromptTask): PlannedCall => ({
  taskId: task.id,
  stage: task.stage,
  system: task.systemPrompt,
  user: task.userPrompt,
  maxTokens: task.maxTokens,
  surface: 'kale',
  jsonOutput: false,
});

export function planCase(flow: FlowId, c: AnyCase): PlannedCall[] {
  switch (flow) {
    case 'kale-recap':
      return buildRecapPromptTasks((c as KaleRecapCase).factPack, 'decomposed').map(fromKaleTask);
    case 'kale-forecast':
      return buildForecastPromptTasks((c as KaleForecastCase).factPack, 'decomposed').map(fromKaleTask);
    case 'match-analysis': {
      const m = c as MatchAnalysisCase;
      return [{ taskId: 'main', stage: 1, system: withOutputLanguage(m.systemPrompt, m.locale), user: m.userPrompt, maxTokens: AI_MAX_TOKENS.analysis, surface: 'match-analysis', jsonOutput: true }];
    }
    case 'scouting': {
      const s = c as ScoutingCase;
      return [{ taskId: 'main', stage: 1, system: withOutputLanguage(s.systemPrompt, s.locale), user: s.userPrompt, maxTokens: AI_MAX_TOKENS.analysis, surface: 'match-prep-analysis', jsonOutput: true }];
    }
    case 'team-coach': {
      const t = c as TeamCoachCase;
      return [{ taskId: 'main', stage: 1, system: withOutputLanguage(buildTeamCoachSystemPrompt(), t.locale), user: buildTeamCoachUserPrompt(t.team, t.format, t.generation), maxTokens: AI_MAX_TOKENS.coach, surface: 'team-coach', jsonOutput: false }];
    }
    case 'slot-coach': {
      const s = c as SlotCoachCase;
      return [{ taskId: 'main', stage: 1, system: withOutputLanguage(buildSlotCoachSystemPrompt(), s.locale), user: buildSlotCoachUserPrompt(s.set, s.team, s.format, s.generation), maxTokens: AI_MAX_TOKENS.coach, surface: 'slot-coach', jsonOutput: false }];
    }
    case 'recap': {
      const r = c as RecapCase;
      return [{ taskId: 'main', stage: 1, system: withOutputLanguage(RECAP_NARRATIVE_SYSTEM_PROMPT, r.locale), user: buildNarrativePrompt(r.input), maxTokens: AI_MAX_TOKENS.recap, surface: 'recap', jsonOutput: false }];
    }
  }
}

// ─── Running one call ───────────────────────────────────────────────

export interface ExecContext {
  settings: CallSettings;
  caller: ModelCaller;
  guard: CostGuard;
  lookup: SpeciesLookup;
}

interface CallOutcome {
  record: CallRecord;
  /** The answer text; null when the call failed or never ran. */
  content: string | null;
  /** The cost cap stopped the call before it started. */
  skipped: boolean;
}

const TRANSIENT_NAMES = new Set(['APIConnectionError', 'APIUserAbortError', 'AnthropicError', 'TimeoutError', 'AbortError', 'EmptyModelResponseError']);

function classifyError(error: unknown): CallErrorKind {
  if (error instanceof OutputCapError) return 'truncated';
  if (error instanceof RefusalError) return 'refused';
  if (isDeterministicModelError(error)) return 'rejected';
  if (error instanceof Error && (TRANSIENT_NAMES.has(error.name) || /exceeded|terminated|fetch failed|overloaded|empty|connection|timeout|timed out|aborted|ECONN|ETIMEDOUT/i.test(error.message))) return 'transient';
  return 'other';
}

const TRUNCATING_STOPS = new Set(['max_tokens', 'length']);
const REFUSING_STOPS = new Set(['refusal', 'content-filter']);

/** The model the fallback ladder asks second. A model the price table lacks is capped at the requested model's rates. */
function fallbackModelFor(requested: string): string {
  const fallback = getClaudeFallbackModelId();
  return priceOf(fallback) ? fallback : requested;
}

/**
 * The model id a typed error names (`OutputCapError`, `RefusalError`, `ModelRejectedError` carry
 * it), when it is one the eval can price; otherwise the requested model.
 */
function erroredModel(error: unknown, requested: string): string {
  const named = (error as { model?: unknown } | null)?.model;
  return typeof named === 'string' && priceOf(named) ? named : requested;
}

async function runCall(ctx: ExecContext, call: PlannedCall, userOverride?: string): Promise<CallOutcome> {
  const { settings, guard } = ctx;
  const user = userOverride ?? call.user;
  const promptEstimate = estimateTokens(call.system) + estimateTokens(user);
  const fallbackModel = fallbackModelFor(settings.model);
  // `client.ts` and the Kale provider ask the primary model and, after a transient failure, the
  // fallback model, and report only the attempt that answered. The cap must hold for both attempts,
  // so the reservation is the worst case of each, and a failed attempt is charged by estimate.
  const worstPrimary = worstCaseCostUsd(settings.model, promptEstimate, call.maxTokens);
  const worstFallback = worstCaseCostUsd(fallbackModel, promptEstimate, call.maxTokens);
  const base = {
    taskId: call.taskId,
    requestedModel: settings.model,
    effort: settings.effort,
    maxTokens: call.maxTokens,
  };

  const reservation = await guard.reserve(worstPrimary + worstFallback);
  if (!reservation) {
    const record: CallRecord = {
      ...base, servedModel: null, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, outputChars: 0,
      ms: 0, costUsd: 0, failedAttemptUsd: 0, costEstimated: false, stopReason: null, truncated: false, refused: false, fallback: false, error: null,
    };
    return { record, content: null, skipped: true };
  }

  const startedAt = Date.now();
  try {
    const response = await ctx.caller(
      { system: call.system, user, maxTokens: call.maxTokens, jsonOutput: call.jsonOutput, surface: call.surface },
      settings,
    );
    const ms = Date.now() - startedAt;
    const priced = callCostUsd(response.model, response);
    const fallback = response.fallbackUsed || servedDiffersFromRequested(settings.model, response.model);
    // The primary attempt that failed before the fallback answered left no usage report.
    const failedAttemptUsd = fallback ? worstPrimary : 0;
    const costUsd = (priced ?? worstFallback) + failedAttemptUsd;
    guard.settle(reservation, costUsd);
    const record: CallRecord = {
      ...base,
      servedModel: response.model,
      inputTokens: response.promptTokens,
      cacheReadTokens: response.cacheReadTokens,
      cacheWriteTokens: response.cacheWriteTokens,
      outputTokens: response.completionTokens,
      outputChars: response.content.length,
      ms,
      costUsd,
      failedAttemptUsd,
      costEstimated: priced === null || failedAttemptUsd > 0,
      stopReason: response.stopReason,
      truncated: response.stopReason !== null && TRUNCATING_STOPS.has(response.stopReason),
      refused: response.stopReason !== null && REFUSING_STOPS.has(response.stopReason),
      fallback,
      error: null,
    };
    return { record, content: response.content, skipped: false };
  } catch (error) {
    const ms = Date.now() - startedAt;
    const kind = classifyError(error);
    // The provider reported no usage for a failed call, so it is costed by estimate, at the worst
    // case of every attempt that can have been billed: a truncated answer used its whole output
    // cap, a refusal at least the prompt, a transient failure both attempts, a rejected request
    // (a 400) nothing. A typed error from the fallback model means the primary failed first.
    const model = erroredModel(error, settings.model);
    const fromFallback = baseModelId(model) !== baseModelId(settings.model);
    const earlierAttempt = fromFallback ? worstPrimary : 0;
    let costUsd = 0;
    if (kind === 'truncated') costUsd = worstCaseCostUsd(model, promptEstimate, call.maxTokens) + earlierAttempt;
    else if (kind === 'refused') costUsd = worstCaseCostUsd(model, promptEstimate, 0) + earlierAttempt;
    else if (kind === 'transient') costUsd = worstPrimary + worstFallback;
    else if (kind === 'rejected') costUsd = earlierAttempt;
    guard.settle(reservation, costUsd);
    const record: CallRecord = {
      ...base,
      servedModel: null,
      inputTokens: promptEstimate,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: kind === 'truncated' ? call.maxTokens : 0,
      outputChars: 0,
      ms,
      costUsd,
      failedAttemptUsd: costUsd,
      costEstimated: true,
      stopReason: kind === 'truncated' ? 'max_tokens' : kind === 'refused' ? 'refusal' : null,
      truncated: kind === 'truncated',
      refused: kind === 'refused',
      fallback: fromFallback,
      error: kind,
    };
    return { record, content: null, skipped: false };
  }
}
// ─── Running one case ───────────────────────────────────────────────

export interface ExecResult {
  calls: CallRecord[];
  checks: Check[];
  validator: ValidatorCounts;
  outputs: Record<string, string>;
  incomplete: boolean;
}

function addCounts(into: ValidatorCounts, add: ValidatorCounts): void {
  for (const key of Object.keys(into) as (keyof ValidatorCounts)[]) into[key] += add[key];
}

/** Grade the call-level facts, then the content when the call produced any. */
function gradeOutcome(outcome: CallOutcome, label: string, gradeContent: (text: string) => Check[]): Check[] {
  const checks = gradeCall(outcome.record, label);
  if (outcome.content === null) {
    checks.push({ id: `${label}content`, hard: true, pass: false, detail: 'no answer text' });
    return checks;
  }
  const content = gradeContent(outcome.content);
  return [...checks, ...(label ? content.map((c) => ({ ...c, id: `${label}${c.id}` })) : content)];
}

async function executeSingle(flow: FlowId, c: AnyCase, ctx: ExecContext): Promise<ExecResult> {
  const [planned] = planCase(flow, c);
  const outcome = await runCall(ctx, planned);
  if (outcome.skipped) return { calls: [outcome.record], checks: [], validator: emptyValidatorCounts(), outputs: {}, incomplete: true };

  const grade = (text: string): Check[] => {
    switch (flow) {
      case 'match-analysis':
        return gradeMatchAnalysis(text, c as MatchAnalysisCase);
      case 'scouting':
        return gradeScouting(text, c as ScoutingCase, ctx.lookup);
      case 'team-coach':
        return gradeTeamCoach(text, (c as TeamCoachCase).locale);
      case 'slot-coach':
        return gradeSlotCoach(text, (c as SlotCoachCase).locale);
      case 'recap':
        return gradeRecap(text, (c as RecapCase).locale);
      default:
        throw new Error(`${flow} is not a single-call flow`);
    }
  };
  // A truncated JSON flow is graded on its partial text too: the parse check then says why it failed.
  return {
    calls: [outcome.record],
    checks: gradeOutcome(outcome, '', grade),
    validator: emptyValidatorCounts(),
    outputs: outcome.content === null ? {} : { main: outcome.content },
    incomplete: false,
  };
}

async function executeKale(flow: 'kale-recap' | 'kale-forecast', c: KaleRecapCase | KaleForecastCase, ctx: ExecContext): Promise<ExecResult> {
  const planned = planCase(flow, c);
  const stages = [...new Set(planned.map((p) => p.stage))].sort((a, b) => a - b);
  const results = new Map<string, string>();
  const calls: CallRecord[] = [];
  const checks: Check[] = [];
  const outputs: Record<string, string> = {};
  const validator = emptyValidatorCounts();
  let incomplete = false;

  for (const stage of stages) {
    const stageCalls = planned.filter((p) => p.stage === stage);
    const outcomes = await Promise.all(
      stageCalls.map((call) => {
        // As the pipeline does: the narrative of stage 3 gets the one-liners of stage 1.
        const user = stage === 3 && call.taskId.includes('narrative') ? injectOneLinerResults(call.user, results) : undefined;
        return runCall(ctx, call, user);
      }),
    );
    stageCalls.forEach((call, i) => {
      const outcome = outcomes[i];
      calls.push(outcome.record);
      if (outcome.skipped) {
        incomplete = true;
        return;
      }
      checks.push(...gradeCall(outcome.record, `${call.taskId}:`));
      if (outcome.content === null) {
        checks.push({ id: `${call.taskId}:content`, hard: true, pass: false, detail: 'no answer text' });
        return;
      }
      results.set(call.taskId, outcome.content);
      outputs[call.taskId] = outcome.content;
      const grade = gradeKaleTask(call.taskId, outcome.content, flow, c.factPack);
      checks.push(...grade.checks);
      addCounts(validator, grade.validator);
    });
    if (incomplete) break;
  }
  return { calls, checks, validator, outputs, incomplete };
}

export async function executeCase<F extends FlowId>(flow: F, c: CaseByFlow[F], ctx: ExecContext): Promise<ExecResult> {
  if (flow === 'kale-recap' || flow === 'kale-forecast') {
    return executeKale(flow, c as KaleRecapCase | KaleForecastCase, ctx);
  }
  return executeSingle(flow, c, ctx);
}
