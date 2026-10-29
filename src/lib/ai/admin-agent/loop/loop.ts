/**
 * The loop (plan 3.1, 3.4, 6.4; spec §18.10): a manual, server-owned outer loop around a single-step model port.
 *
 * One iteration is one model step:
 *   1. check the caps (12 steps, the 240 s deadline) and the context size;
 *   2. reserve the estimated cost against all four dollar caps (a refusal is an `agent.budget.block` audit event);
 *   3. ask the port for one assistant message (text streams out as it arrives);
 *   4. settle the reservation with the real meters;
 *   5. persist the assistant message (exact blocks, append-only), BEFORE any tool runs;
 *   6. run the tool calls, persist their results as one message, and go round again.
 *
 * Everything the model changes is a private row or a staged proposal; no domain write is a model tool (plan 3.1), so a
 * replayed turn cannot double-write. Order of execution inside a step: consecutive R/P calls run in parallel, D and the
 * staging tools run one at a time in call order, and after the first failed write the later writes of the step are skipped
 * (reads still run). A step that ends on `max_tokens`, `refusal` or an unexpected stop executes nothing.
 *
 * Spike S7: nothing here observes the client connection. The loop persists after every step, so a turn the platform cuts
 * off is resumable (`turn_deadline`, `turn_interrupted` harness events), and the caller hands the completion promise to
 * `after()`.
 */
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { AdminAgentEffort } from '../env';
import type { ConversationRecord, Json, MessageRecord, NewRef, UsageMeters } from '../store/types';
import { toolUsesOf, textOf, toJson, type ToolUseBlock } from './blocks';
import { loopCode } from './codes';
import { LOOP_EVENTS, harnessEventMessage } from './harness';
import { costMicro, DEFAULT_CONTEXT_WINDOW_TOKENS, estimateStepCostMicro, estimateTokens, maxOutputTokensFor } from './pricing';
import { failureResult, serializeToolResult, toolResultBlock, type SerializedToolResult } from './tool-results';
import { entryOf, type TranscriptEntry } from './transcript';
import { safeSink } from './events';
import {
  ModelPortError,
  type DoneReason,
  type EventSink,
  type LoopDeps,
  type ModelStepResult,
  type ToolCallContext,
  type ToolRunResult,
  type TurnOutcome,
  type TurnRequest,
} from './types';
import type { ToolSet } from '../registry';

/** The last second a step may run in: `maxDuration` is 300 s, and the persist after the step needs room. */
export const HARD_TURN_SECONDS = 285;
/**
 * A write (D, B or G call) is not started within this many seconds of the hard deadline: its answer, the persist after it
 * and a possible dispatch must fit before the platform ends the invocation. Reads still run.
 */
export const TOOL_DEADLINE_MARGIN_SECONDS = 30;
/** No step is given less than this to finish in. */
const MIN_STEP_TIMEOUT_MS = 20_000;
/** Reads that run at once inside one group. */
const READ_CONCURRENCY = 8;

export interface TurnRun {
  deps: LoopDeps;
  request: TurnRequest;
  conversation: ConversationRecord;
  toolSet: ToolSet;
  /** The persisted transcript so far, including this turn's user message. The loop appends to it as it persists. */
  transcript: TranscriptEntry[];
  emit: EventSink;
  /** Hash of the admin message this turn answers, for the audit trail of anything it stages or writes. */
  userTextHash?: string | null;
}

interface Counters {
  steps: number;
  toolCalls: number;
  stagings: number;
  goLive: number;
}

type CallClass = 'R' | 'P' | 'D' | 'B' | 'G' | 'unknown';

interface CallOutcome {
  call: ToolUseBlock;
  serialized: SerializedToolResult;
  ui?: Json;
  ok: boolean;
  cls: CallClass;
  /** The typed ids a read returned: recorded as seen by this conversation (provenance, plan 6.3). */
  refs?: NewRef[];
}

function asEffort(value: string): AdminAgentEffort {
  // The effort ceiling is `high` (plan 3.4): anything else stored on a row is read as the default.
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

/** Runs the model steps of one turn and returns how it ended. Never throws: a failure becomes an `error` and a `done` event. */
export async function runSteps(run: TurnRun): Promise<TurnOutcome> {
  const emit = safeSink(run.emit);
  const outcome = await runStepsInner({ ...run, emit }).catch((error: unknown): TurnOutcome => {
    console.error('[admin-agent] turn failed unexpectedly', error);
    emit({ type: 'error', code: 'agent_harness_error', reason: 'turn_crashed' });
    return { reason: 'failed', resumable: false, steps: 0, toolCalls: 0, stagings: 0, costUsdMicro: 0 };
  });
  emit({ type: 'done', reason: outcome.reason, resumable: outcome.resumable });
  return outcome;
}

async function runStepsInner(run: TurnRun): Promise<TurnOutcome> {
  const { deps, request, conversation, toolSet, transcript, emit } = run;
  const config = deps.config();
  const limits = config.limits;
  const started = deps.now().getTime();
  const softDeadline = started + limits.turnDeadlineSeconds * 1000;
  const hardDeadline = started + HARD_TURN_SECONDS * 1000;
  const counters: Counters = { steps: 0, toolCalls: 0, stagings: 0, goLive: 0 };
  const maxOutputTokens = maxOutputTokensFor(conversation.model);
  const sentinel = deps.stateChannel === 'sentinel-user' ? deps.sentinelFor(conversation.id) : '';
  let turnCost = 0;
  let conversationSpend = await currentConversationSpend(run);

  const result = (reason: DoneReason, resumable: boolean): TurnOutcome => ({
    reason,
    resumable,
    steps: counters.steps,
    toolCalls: counters.toolCalls,
    stagings: counters.stagings,
    costUsdMicro: turnCost,
  });

  /** Stops with a resumable event: the admin (or the UI) posts `{continue: true}` to go on. */
  const stopResumable = async (reason: DoneReason, event: string, data: Record<string, Json> = {}): Promise<TurnOutcome> => {
    await persistEvent(run, event, data);
    return result(reason, true);
  };

  for (;;) {
    if (counters.steps >= limits.maxStepsPerTurn) return stopResumable('step_limit', LOOP_EVENTS.turnLimit, { limit: 'steps' });
    if (deps.now().getTime() >= softDeadline) return stopResumable('deadline', LOOP_EVENTS.turnDeadline, { step: counters.steps });

    const step = counters.steps + 1;
    const model = conversation.model;

    // ── Context size ────────────────────────────────────────────────
    const promptTokens = estimatePromptTokens(run, sentinel);
    if (promptTokens > ((deps.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS) * limits.contextRefusePercent) / 100) {
      emit({ type: 'error', code: 'agent_context_full', reason: 'context_over_limit' });
      return result('context', false);
    }

    // ── Reserve ─────────────────────────────────────────────────────
    const estimate = estimateStepCostMicro(model, promptTokens, maxOutputTokens);
    const reservation = await deps.store.usage
      .reserveUsage(request.adminId, {
        adminName: request.adminName,
        conversationId: conversation.id,
        purpose: 'turn',
        model,
        estimateUsdMicro: estimate,
        caps: {
          conversationMicro: config.budgets.conversationMicro,
          adminDayMicro: config.budgets.adminDayMicro,
          adminMonthMicro: config.budgets.adminMonthMicro,
          globalDayMicro: config.budgets.globalDayMicro,
        },
      })
      .catch((error: unknown) => {
        console.error('[admin-agent] usage reservation failed; the call is not made (fail closed)', error);
        return null;
      });
    if (reservation === null) {
      emit({ type: 'error', code: 'agent_harness_error', reason: 'usage_reserve_failed' });
      return result('failed', false);
    }
    if (!reservation.ok) {
      const code = BUDGET_CODE[reservation.exceeded];
      deps.audit({
        actor_id: request.adminId,
        actor_name: request.adminName,
        action: 'agent.budget.block',
        resource_type: 'agent_conversation',
        resource_id: conversation.id,
        metadata: {
          cap: reservation.exceeded,
          used_usd_micro: reservation.usedMicro,
          cap_usd_micro: reservation.capMicro,
          estimate_usd_micro: estimate,
          model,
          step,
        },
      });
      emit({ type: 'error', code });
      await persistEvent(run, LOOP_EVENTS.turnInterrupted, { reason: 'budget', cap: reservation.exceeded });
      return result('budget', true);
    }
    counters.steps = step;

    // ── The model step ──────────────────────────────────────────────
    const remainingMs = Math.max(MIN_STEP_TIMEOUT_MS, hardDeadline - deps.now().getTime());
    let stepResult: ModelStepResult;
    try {
      stepResult = await deps.port.step({
        model,
        effort: asEffort(conversation.effort),
        system: deps.systemPrompt.text,
        tools: toolSet.tools,
        transcript,
        sentinel,
        maxOutputTokens,
        timeoutMs: remainingMs,
        onTextDelta: (delta) => emit({ type: 'text.delta', step, delta }),
      });
    } catch (error) {
      const timedOut = error instanceof ModelPortError && error.kind === 'timeout';
      // A call that timed out mid-stream may still have been billed: keep the whole estimate. Any other failure never
      // produced output, so the reservation is released.
      await settleUnbilled(run, reservation.usageId, timedOut ? estimate : 0, timedOut ? 'timeout' : 'model_error');
      turnCost += timedOut ? estimate : 0;
      return failStep(run, error, result);
    }

    // ── Settle ──────────────────────────────────────────────────────
    const stepCost = costMicro(stepResult.model || model, stepResult.usage);
    turnCost += stepCost;
    conversationSpend = conversationSpend === null ? null : conversationSpend + stepCost;
    await deps.store.usage
      .settleUsage(request.adminId, reservation.usageId, { ...stepResult.usage, costUsdMicro: stepCost, stopReason: stepResult.rawStopReason ?? stepResult.stopReason })
      .catch((error: unknown) => console.error('[admin-agent] usage settle failed; the reservation stays and counts', error));
    emit({
      type: 'usage',
      step,
      input_tokens: stepResult.usage.inputTokens + stepResult.usage.cacheReadTokens + stepResult.usage.cacheWrite5mTokens + stepResult.usage.cacheWrite1hTokens,
      output_tokens: stepResult.usage.outputTokens,
      cache_read_tokens: stepResult.usage.cacheReadTokens,
      cache_write_tokens: stepResult.usage.cacheWrite5mTokens + stepResult.usage.cacheWrite1hTokens,
      cost_usd_micro: stepCost,
      conversation_usd_micro: conversationSpend,
      warn: conversationSpend !== null && conversationSpend >= config.budgets.conversationWarnMicro,
    });

    // ── Persist the assistant message (before any tool runs) ───────
    const calls = toolUsesOf(stepResult.blocks);
    const hasBlocks = stepResult.blocks.length > 0;
    if (hasBlocks) {
      const saved = await appendEntry(run, {
        role: 'assistant',
        kind: 'chat',
        content: toJson(stepResult.blocks),
        ui: { text: textOf(stepResult.blocks), tool_calls: calls.map((c) => ({ id: c.id, name: c.name })) },
        model: stepResult.model || model,
        stopReason: stepResult.rawStopReason ?? stepResult.stopReason,
        usage: usageJson(stepResult.usage, stepCost),
      });
      if (!saved) {
        emit({ type: 'error', code: 'agent_harness_error', reason: 'assistant_message_not_saved' });
        return result('failed', false);
      }
    }

    // ── What the stop means ─────────────────────────────────────────
    switch (stepResult.stopReason) {
      case 'refusal':
        await answerUnrun(run, calls, 'refused');
        emit({ type: 'error', code: loopCode('refused'), reason: 'refusal' });
        return result('refused', false);
      case 'max_tokens':
        await answerUnrun(run, calls, 'truncated');
        emit({ type: 'error', code: loopCode('truncated'), reason: 'max_tokens' });
        return result('truncated', false);
      case 'context_exceeded':
        await answerUnrun(run, calls, 'truncated');
        emit({ type: 'error', code: 'agent_context_full', reason: 'context_window_exceeded' });
        return result('context', false);
      case 'other':
        await answerUnrun(run, calls, 'truncated');
        emit({ type: 'error', code: 'agent_harness_error', reason: `unexpected_stop:${stepResult.rawStopReason ?? 'none'}` });
        return result('failed', false);
      case 'end_turn':
        if (calls.length > 0) {
          // Tool calls under a stop reason that says there are none: do not guess, run nothing.
          await answerUnrun(run, calls, 'truncated');
          emit({ type: 'error', code: 'agent_harness_error', reason: 'tool_use_without_tool_stop' });
          return result('failed', false);
        }
        if (!hasBlocks) {
          emit({ type: 'error', code: 'agent_harness_error', reason: 'empty_response' });
          await persistEvent(run, LOOP_EVENTS.turnInterrupted, { reason: 'empty_response' });
          return result('failed', true);
        }
        return result('completed', false);
      case 'tool_use':
        break;
    }
    if (calls.length === 0) {
      emit({ type: 'error', code: 'agent_harness_error', reason: 'tool_stop_without_tool_use' });
      await persistEvent(run, LOOP_EVENTS.turnInterrupted, { reason: 'tool_stop_without_tool_use' });
      return result('failed', true);
    }

    // ── Run the tools and persist their results ────────────────────
    const invalid = new Set(stepResult.toolCalls.filter((c) => c.invalid).map((c) => c.id));
    const outcomes = await executeCalls(run, calls, invalid, counters, step, hardDeadline - TOOL_DEADLINE_MARGIN_SECONDS * 1000);
    const capHit = outcomes.some((o) => o.capped);
    const deadlineHit = outcomes.some((o) => o.deadline);
    await recordResultRefs(
      run,
      outcomes.flatMap((o) => o.outcome.refs ?? []),
    );
    const saved = await persistToolResults(
      run,
      outcomes.map((o) => o.outcome),
    );
    if (!saved) {
      emit({ type: 'error', code: 'agent_harness_error', reason: 'tool_results_not_saved' });
      return result('failed', false);
    }
    if (capHit) return stopResumable('tool_limit', LOOP_EVENTS.turnLimit, { limit: 'tool_calls' });
    // A write was held back for lack of time: the admin (or the UI) resumes the turn and the model asks for it again.
    if (deadlineHit) return stopResumable('deadline', LOOP_EVENTS.turnDeadline, { step: counters.steps, reason: 'tool_calls' });
  }
}

const BUDGET_CODE = {
  conversation: 'agent_budget_conversation',
  admin_day: 'agent_budget_admin_day',
  admin_month: 'agent_budget_admin_month',
  global_day: 'agent_budget_global_day',
} as const;

function usageJson(usage: UsageMeters, cost: number): Json {
  return {
    input_tokens: usage.inputTokens,
    cache_write_5m_tokens: usage.cacheWrite5mTokens,
    cache_write_1h_tokens: usage.cacheWrite1hTokens,
    cache_read_tokens: usage.cacheReadTokens,
    output_tokens: usage.outputTokens,
    cost_usd_micro: cost,
  };
}

/** The conversation's spend so far (for the warn threshold); `null` when it cannot be read, which only drops the warning. */
async function currentConversationSpend(run: TurnRun): Promise<number | null> {
  try {
    const spend = await run.deps.store.usage.getSpend(run.request.adminId, run.conversation.id);
    return spend.conversationMicro;
  } catch (error) {
    console.error('[admin-agent] could not read the conversation spend; the warning is off for this turn', error);
    return null;
  }
}

function estimatePromptTokens(run: TurnRun, sentinel: string): number {
  const { deps, toolSet, transcript } = run;
  // The transcript is JSON, so its bytes are a fair upper bound of what the provider counts.
  return estimateTokens(deps.systemPrompt.text) + estimateTokens(toolSet.wireBytes) + estimateTokens(JSON.stringify(transcript)) + estimateTokens(sentinel);
}

/** Maps a port failure to a stream error and the right ending. */
async function failStep(run: TurnRun, error: unknown, result: (reason: DoneReason, resumable: boolean) => TurnOutcome): Promise<TurnOutcome> {
  const emit = run.emit;
  const kind = error instanceof ModelPortError ? error.kind : 'unknown';
  console.error(`[admin-agent] model step failed (${kind})`, describeFailure(error instanceof ModelPortError ? (error.cause ?? error) : error));
  let code: ApiErrorCode;
  switch (kind) {
    case 'unavailable':
    case 'timeout':
      code = loopCode('unavailable');
      break;
    case 'context_exceeded':
      code = 'agent_context_full';
      break;
    default:
      code = 'agent_harness_error';
  }
  emit({ type: 'error', code, reason: `model_${kind}` });
  await persistEvent(run, LOOP_EVENTS.turnInterrupted, { reason: `model_${kind}` });
  return result('model_error', kind === 'unavailable' || kind === 'timeout');
}

/**
 * What goes to the server log about a provider failure: the kind of error, the HTTP status and a short message. Not the
 * error object itself: an SDK call error carries the whole request body (the conversation) and the response headers.
 */
function describeFailure(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error).slice(0, 300);
  const { name, message, statusCode } = error as { name?: unknown; message?: unknown; statusCode?: unknown };
  return [typeof name === 'string' ? name : 'Error', typeof statusCode === 'number' ? `status ${statusCode}` : null, typeof message === 'string' ? message.slice(0, 300) : null].filter(Boolean).join(': ');
}

async function settleUnbilled(run: TurnRun, usageId: string, costUsdMicro: number, stopReason: string): Promise<void> {
  const zero: UsageMeters = { inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
  await run.deps.store.usage
    .settleUsage(run.request.adminId, usageId, { ...zero, costUsdMicro, stopReason })
    .catch((error: unknown) => console.error('[admin-agent] usage settle failed; the reservation stays and counts', error));
}

// ─── Persistence ──────────────────────────────────────────────────────

interface AppendInput {
  role: 'user' | 'assistant' | 'system';
  kind: 'chat' | 'tool_results' | 'harness_event';
  content: Json;
  ui?: Json | null;
  model?: string | null;
  stopReason?: string | null;
  usage?: Json | null;
}

/** Appends a message and mirrors it into the in-memory transcript. Returns the stored row, or `null` after logging. */
export async function appendEntry(run: TurnRun, input: AppendInput): Promise<MessageRecord | null> {
  try {
    const { message } = await run.deps.store.messages.appendMessage(run.request.adminId, run.conversation.id, input);
    run.transcript.push(entryOf(message));
    return message;
  } catch (error) {
    console.error(`[admin-agent] could not persist a ${input.kind} message`, error);
    return null;
  }
}

/** Persists a harness event; best effort (a failure is logged, the turn is already ending). */
export async function persistEvent(run: TurnRun, event: string, data: Record<string, Json> = {}): Promise<void> {
  await appendEntry(run, harnessEventMessage(event, data));
}

/** Answers tool calls that will not run with an error result, so the history stays valid for the next request. */
async function answerUnrun(run: TurnRun, calls: readonly ToolUseBlock[], cause: 'refused' | 'truncated'): Promise<void> {
  if (calls.length === 0) return;
  const serialized = failureResult(loopCode(cause), { reason: 'not_executed' });
  await persistToolResults(
    run,
    calls.map((call) => ({ call, serialized, ok: false, cls: 'unknown' as const })),
  );
}

async function persistToolResults(run: TurnRun, outcomes: readonly CallOutcome[]): Promise<boolean> {
  const build = (items: readonly CallOutcome[]) => ({
    role: 'user' as const,
    kind: 'tool_results' as const,
    content: toJson(items.map((o) => toolResultBlock(o.call.id, o.serialized))),
    ui: {
      results: items.map((o) => ({
        tool_use_id: o.call.id,
        name: o.call.name,
        ok: o.ok,
        ...(o.serialized.code ? { code: o.serialized.code } : {}),
        ...(o.ui !== undefined ? { ui: o.ui } : {}),
      })),
    } as Json,
  });
  if (await appendEntry(run, build(outcomes))) return true;
  // The store refuses a result that carries a private field (payload guard) before it writes anything. The assistant
  // message is already stored with its tool calls, so the calls still need an answer: an error result for each.
  const harness = failureResult('agent_harness_error', { reason: 'result_not_stored' });
  const replaced = outcomes.map((o): CallOutcome => ({ ...o, serialized: harness, ok: false, ui: undefined }));
  return (await appendEntry(run, build(replaced))) !== null;
}

// ─── Tool execution ───────────────────────────────────────────────────

interface Executed {
  outcome: CallOutcome;
  /** This call hit the per-turn tool-call cap. */
  capped: boolean;
  /** This write was not started: too close to the hard deadline. */
  deadline?: boolean;
}

function classOf(set: ToolSet, name: string): CallClass {
  return set.definitions.get(name)?.class ?? 'unknown';
}

function readLike(cls: CallClass): boolean {
  return cls === 'R' || cls === 'P' || cls === 'unknown';
}

async function executeCalls(
  run: TurnRun,
  calls: readonly ToolUseBlock[],
  invalid: ReadonlySet<string>,
  counters: Counters,
  step: number,
  /** Epoch milliseconds after which no write is started. */
  toolDeadline: number,
): Promise<Executed[]> {
  const { deps, toolSet, emit } = run;
  const limits = deps.config().limits;
  const out: Executed[] = new Array<Executed>(calls.length);
  let writeFailed = false;

  /** A call that is not run (a cap, an earlier failure): the stream still sees it start and end. */
  const skipped = (call: ToolUseBlock, cls: CallClass, serialized: SerializedToolResult, capped = false, deadline = false): Executed => {
    emit({ type: 'tool.start', id: call.id, name: call.name, label_code: `tool.${call.name}` });
    emit({ type: 'tool.end', id: call.id, name: call.name, ok: false, ...(serialized.code ? { code: serialized.code } : {}) });
    return { outcome: { call, cls, ok: false, serialized }, capped, ...(deadline ? { deadline } : {}) };
  };

  const runOne = async (index: number): Promise<void> => {
    const call = calls[index];
    const cls = classOf(toolSet, call.name);
    // Caps are decided here, synchronously and in call order, before anything of this call runs.
    if (counters.toolCalls >= limits.maxToolCallsPerTurn) {
      out[index] = skipped(call, cls, failureResult('agent_turn_limit_reached', { limit: 'tool_calls' }), true);
      return;
    }
    // A write that would start too close to the hard deadline is answered, not run: a cut-off write leaves an `executing`
    // ledger row and a half-done change (plan 3.4).
    if (!readLike(cls) && deps.now().getTime() >= toolDeadline) {
      out[index] = skipped(call, cls, failureResult('agent_turn_limit_reached', { limit: 'deadline' }), false, true);
      return;
    }
    counters.toolCalls += 1;
    if (cls === 'B' || cls === 'G') {
      if (counters.stagings >= limits.maxStagingsPerTurn) {
        out[index] = skipped(call, cls, failureResult('agent_turn_limit_reached', { limit: 'stagings' }));
        return;
      }
      if (cls === 'G' && counters.goLive >= 1) {
        out[index] = skipped(call, cls, failureResult('agent_turn_limit_reached', { limit: 'go_live_proposal' }));
        return;
      }
      counters.stagings += 1;
      if (cls === 'G') counters.goLive += 1;
    }
    if (!readLike(cls) && writeFailed) {
      out[index] = skipped(call, cls, failureResult('step_failed', { reason: 'earlier_call_failed' }));
      return;
    }
    const outcome = await runCall(run, call, cls, invalid.has(call.id), step);
    out[index] = { outcome, capped: false };
    if (!readLike(cls) && !outcome.ok) writeFailed = true;
  };

  // Consecutive reads form a group that runs at once; any other call is a barrier that runs alone, in order.
  let i = 0;
  while (i < calls.length) {
    if (readLike(classOf(toolSet, calls[i].name))) {
      const group: number[] = [];
      while (i < calls.length && readLike(classOf(toolSet, calls[i].name))) {
        group.push(i);
        i += 1;
      }
      for (let g = 0; g < group.length; g += READ_CONCURRENCY) {
        await Promise.all(group.slice(g, g + READ_CONCURRENCY).map((index) => runOne(index)));
      }
    } else {
      await runOne(i);
      i += 1;
    }
  }
  return out;
}

async function runCall(run: TurnRun, call: ToolUseBlock, cls: CallClass, invalidInput: boolean, step: number): Promise<CallOutcome> {
  const { deps, request, conversation, toolSet, emit } = run;
  emit({ type: 'tool.start', id: call.id, name: call.name, label_code: `tool.${call.name}` });

  let result: ToolRunResult;
  if (invalidInput) {
    result = { ok: false, code: 'validation_failed', params: { issues: 'The tool input was not valid JSON for this tool.' } };
  } else {
    const ctx: ToolCallContext = {
      adminId: request.adminId,
      adminName: request.adminName,
      conversationId: conversation.id,
      toolUseId: call.id,
      step,
      now: () => deps.now(),
      timeZone: request.timeZone,
      locale: request.locale,
      model: conversation.model,
      effort: conversation.effort,
      systemPromptVersion: conversation.system_prompt_version,
      toolRegistryVersion: conversation.tool_registry_version,
      userTextHash: run.userTextHash ?? null,
      // By reference only: the session is never copied, logged or stored.
      ...(request.dispatch === undefined ? {} : { dispatch: request.dispatch }),
    };
    try {
      result = await deps.tools.run(toolSet, { name: call.name, input: call.input }, ctx);
    } catch (error) {
      // A runtime answers a code and does not throw. Whatever it threw stays in the log; the model gets a code only.
      console.error(`[admin-agent] tool runtime threw for ${call.name}`, error);
      result = { ok: false, code: 'agent_harness_error' };
    }
  }

  const serialized = serializeToolResult(result);
  emit({ type: 'tool.end', id: call.id, name: call.name, ok: !serialized.isError, ...(serialized.code ? { code: serialized.code } : {}) });
  if (!serialized.isError) for (const event of result.events ?? []) emit(event);
  return {
    call,
    cls,
    serialized,
    ok: !serialized.isError,
    ...(result.ui !== undefined ? { ui: result.ui } : {}),
    ...(result.ok && result.refs !== undefined && result.refs.length > 0 ? { refs: [...result.refs] } : {}),
  };
}

/** The most refs one store call takes (`store/refs.ts`). */
const REF_CHUNK = 200;

/**
 * Records the ids this step's reads returned, before the results message is stored. Best effort: a write that names an id
 * which could not be recorded is refused as `unknown_reference` (provenance fails closed), so a failure here only costs
 * the admin a retry.
 */
export async function recordResultRefs(run: TurnRun, refs: readonly NewRef[]): Promise<void> {
  if (refs.length === 0) return;
  const unique = [...new Map(refs.map((ref) => [`${ref.kind}:${ref.id}`, ref])).values()];
  for (let i = 0; i < unique.length; i += REF_CHUNK) {
    try {
      await run.deps.store.refs.recordRefs(run.request.adminId, run.conversation.id, unique.slice(i, i + REF_CHUNK));
    } catch (error) {
      console.error('[admin-agent] could not record the ids a tool result returned', error);
      return;
    }
  }
}
