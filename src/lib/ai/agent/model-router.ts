/**
 * Model tier selection + escalation chain (PRD §2).
 *
 * `selectModels()` produces the ordered candidate list for a request (honouring
 * the user's stored `model_priority`, putting the vision model first when an
 * image is present, and dropping unconfigured providers).
 *
 * `streamWithFallback()` walks that list, calling the Vercel AI SDK
 * `streamText()` against each model. It escalates to the next model on any of
 * the four PRD §2 triggers — rate-limit/429, tool-call args failing Zod (after
 * one same-model repair retry), empty/truncated completion, or a per-call
 * timeout — bounded to **max 2 hops** (3 attempts total). Every hop is logged
 * via the injected telemetry callback. If every candidate fails it throws
 * {@link AgentExhaustedError} carrying the full trigger chain.
 *
 * The function is transport-agnostic: it returns the raw `streamText` result
 * object so callers (route handler, future Discord/CLI) adapt the stream.
 */
import { streamText, stepCountIs } from 'ai';
import {
  AGENT_MODELS,
  LEGACY_MODEL_IDS,
  createCompatibleModel,
  getAgentProviderOptions,
  isModelConfigured,
  type AgentModelEntry,
} from './provider';
import { AGENT_TOOLS } from './tools/registry';
import type { EscalationLog, EscalationReason } from './types';

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_PER_CALL_TIMEOUT_MS = 60_000;
/** Max escalation hops (PRD §2). 2 hops = 3 total attempts (T0→T1→T2). */
const DEFAULT_MAX_HOPS = 2;

// ─── Types ───────────────────────────────────────────────────────────

/** A user profile slice carrying the ordered model preference (PRD §6). */
export interface ModelPriorityProfile {
  model_priority?: unknown;
}

/** Params forwarded to `streamText`, minus the bits the router controls. */
export type StreamWithFallbackParams = Omit<
  Parameters<typeof streamText>[0],
  'model' | 'abortSignal'
>;

export type StreamResult = ReturnType<typeof streamText>;

/** Telemetry sink for escalation hops (PRD §9). */
export type EscalationTelemetry = (log: EscalationLog) => void;

export interface StreamWithFallbackOptions {
  /** Per-call budget before a timeout escalation (PRD §2). Default 60s. */
  perCallTimeoutMs?: number;
  /** Max escalation hops. Default 2 (3 attempts). */
  maxHops?: number;
}

// ─── selectModels ────────────────────────────────────────────────────

function parseModelPriority(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .map((id) => LEGACY_MODEL_IDS[id] ?? id);
}

/**
 * Build the ordered, configured candidate list for a request.
 *
 * Order of precedence:
 *   1. The user's stored `model_priority` (by model id), when present.
 *   2. Vision requests force the T0-V model(s) to the front.
 *   3. Unconfigured providers (missing env) are dropped.
 *
 * Both sorts are stable, so the registry order (PRD §2) is preserved within
 * each band.
 */
export function selectModels(
  profile: ModelPriorityProfile | null | undefined,
  needsVision: boolean,
): AgentModelEntry[] {
  let ordered: AgentModelEntry[] = [...AGENT_MODELS];

  const priority = parseModelPriority(profile?.model_priority);
  if (priority.length > 0) {
    const rank = (entry: AgentModelEntry): number => {
      const idx = priority.indexOf(entry.id);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    ordered = [...ordered].sort((a, b) => rank(a) - rank(b));
  }

  if (needsVision) {
    // Stable sort: T0-V entries float to the front, everything else keeps order.
    ordered = [...ordered].sort((a, b) => {
      const av = a.tier === 'T0-V' ? 0 : 1;
      const bv = b.tier === 'T0-V' ? 0 : 1;
      return av - bv;
    });
  }

  return ordered.filter((entry) => isModelConfigured(entry));
}

// ─── Errors ──────────────────────────────────────────────────────────

/** Thrown when every candidate model fails. Carries the full trigger chain. */
export class AgentExhaustedError extends Error {
  readonly escalations: EscalationLog[];
  readonly reasons: EscalationReason[];

  constructor(escalations: EscalationLog[]) {
    const chain = escalations.map((e) => `${e.from}→${e.to} (${e.reason})`).join(', ');
    super(`All agent models exhausted${chain ? `: ${chain}` : ''}`);
    this.name = 'AgentExhaustedError';
    this.escalations = escalations;
    this.reasons = escalations.map((e) => e.reason);
  }
}

// ─── Trigger classification ──────────────────────────────────────────

/** HTTP status off an error, from either the `statusCode` or `status` field. */
function statusOf(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { statusCode?: unknown; status?: unknown };
  if (typeof e.statusCode === 'number') return e.statusCode;
  if (typeof e.status === 'number') return e.status;
  return undefined;
}

/** Lower-cased haystack of the fields providers stash error type/detail in. */
function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const e = err as {
    name?: unknown;
    message?: unknown;
    responseBody?: unknown;
    data?: { error?: { type?: unknown; code?: unknown } } | unknown;
  };
  const parts: string[] = [];
  if (typeof e.name === 'string') parts.push(e.name);
  if (typeof e.message === 'string') parts.push(e.message);
  if (typeof e.responseBody === 'string') parts.push(e.responseBody);
  const inner = (e.data as { error?: { type?: unknown; code?: unknown } } | undefined)?.error;
  if (inner && typeof inner === 'object') {
    if (typeof inner.type === 'string') parts.push(inner.type);
    if (typeof inner.code === 'string') parts.push(inner.code);
  }
  return parts.join(' ').toLowerCase();
}

/** True for an AI SDK `APICallError` (duck-typed so tests need not construct one). */
function isApiCallError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; isRetryable?: unknown };
  return e.name === 'AI_APICallError' || typeof e.isRetryable === 'boolean';
}

function isRateLimit(err: unknown): boolean {
  if (statusOf(err) === 429) return true;
  return /rate.?limit|too many requests|\b429\b/.test(errorText(err));
}

/**
 * Authentication / authorization failure (HTTP 401/403, or an
 * `authentication_error` / `permission_error`). A dead or forbidden key on one
 * tier must escalate, not take the whole agent down (PRD §2 robustness).
 */
function isProviderAuth(err: unknown): boolean {
  const status = statusOf(err);
  if (status === 401 || status === 403) return true;
  return /authentication_error|permission_error|invalid api key|unauthorized|forbidden/.test(
    errorText(err),
  );
}

/**
 * A provider API call error that retrying the SAME model cannot fix — e.g. a
 * 400 invalid model / `invalid_request_error`. Auth and rate-limit are
 * classified earlier, so they never reach here. We rely on the SDK's own
 * `isRetryable === false` signal first, then fall back to status/pattern.
 */
function isProviderError(err: unknown): boolean {
  if (isApiCallError(err)) {
    const e = err as { isRetryable?: unknown };
    if (e.isRetryable === false) return true;
    const status = statusOf(err);
    if (status !== undefined && status >= 400 && status < 500) return true;
  }
  return /invalid_request_error|invalid model|invalid_model|model_not_found|not_found_error/.test(
    errorText(err),
  );
}

/** Validate the model's tool calls against the registry Zod schemas (PRD §2 (b)). */
function validateToolCalls(toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>): {
  ok: true;
} | { ok: false; error: string } {
  for (const call of toolCalls) {
    const tool = AGENT_TOOLS[call.toolName];
    if (!tool) {
      return { ok: false, error: `Unknown tool '${call.toolName}'` };
    }
    // What the model was shown: the server-set fields are not its to fill in (the strict schema runs after the overrides).
    const parsed = (tool.modelInputSchema ?? tool.inputSchema).safeParse(call.input);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { ok: false, error: `Invalid arguments for '${call.toolName}': ${detail}` };
    }
  }
  return { ok: true };
}

type AttemptOutcome =
  | { ok: true; result: StreamResult }
  | { ok: false; reason: EscalationReason; detail: string };

interface SettledStream {
  finishReason: string;
  text: string;
  toolCalls: ReadonlyArray<{ toolName: string; input: unknown }>;
}

/**
 * Drive a `streamText` call to completion under a timeout, surfacing the bits
 * the router needs to classify the outcome. Rejects on stream error or timeout.
 */
async function settle(result: StreamResult, timeoutMs: number): Promise<SettledStream> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RouterTimeoutError()), timeoutMs);
  });
  try {
    const settled = await Promise.race([
      (async (): Promise<SettledStream> => {
        const [finishReason, text, toolCalls] = await Promise.all([
          result.finishReason,
          result.text,
          result.toolCalls,
        ]);
        return {
          finishReason: String(finishReason),
          text: text ?? '',
          toolCalls: (toolCalls ?? []) as ReadonlyArray<{ toolName: string; input: unknown }>,
        };
      })(),
      timeout,
    ]);
    return settled;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class RouterTimeoutError extends Error {
  constructor() {
    super('Agent model call timed out');
    this.name = 'RouterTimeoutError';
  }
}

/**
 * Pick the most informative error to classify after a `streamText` attempt
 * fails. `streamText` is LAZY: a provider failure (auth, rate-limit, bad
 * request) never throws from the call — the awaited promises
 * (`text`/`finishReason`/`toolCalls`) reject with a generic
 * `AI_NoOutputGeneratedError` that carries NO `cause`, while the REAL provider
 * error is delivered only to the `onError` callback. So we prefer the captured
 * provider error over the thrown wrapper. A router timeout always wins (the
 * stream never errored, so nothing was captured).
 */
function pickError(thrown: unknown, captured: unknown): unknown {
  if (thrown instanceof RouterTimeoutError) return thrown;
  return captured ?? thrown;
}

function classifyError(err: unknown): { reason: EscalationReason; detail: string } {
  if (err instanceof RouterTimeoutError) {
    return { reason: 'timeout', detail: err.message };
  }
  // Auth before rate-limit: a 401/403 must escalate as provider-auth, and a
  // dead key sometimes surfaces alongside a generic message.
  if (isProviderAuth(err)) {
    return { reason: 'provider-auth', detail: err instanceof Error ? err.message : 'auth failed' };
  }
  if (isRateLimit(err)) {
    return { reason: 'rate_limit', detail: err instanceof Error ? err.message : 'rate limited' };
  }
  // Non-retryable provider call errors (invalid model, bad request) — retrying
  // the same model is pointless, so escalate as provider-error.
  if (isProviderError(err)) {
    return {
      reason: 'provider-error',
      detail: err instanceof Error ? err.message : 'provider error',
    };
  }
  // Stream errors and truncated/aborted completions are treated as
  // empty/truncated per PRD §2 (c) ("a finish reason of length/error").
  return {
    reason: 'empty_truncated',
    detail: err instanceof Error ? err.message : 'stream failed',
  };
}

function classifySettled(s: SettledStream): { reason: EscalationReason; detail: string } | null {
  if (s.finishReason === 'length' || s.finishReason === 'error') {
    return { reason: 'empty_truncated', detail: `finishReason=${s.finishReason}` };
  }
  if (s.text.trim().length === 0 && s.toolCalls.length === 0) {
    return { reason: 'empty_truncated', detail: 'no text and no tool calls' };
  }
  if (s.toolCalls.length > 0) {
    const check = validateToolCalls(s.toolCalls);
    if (!check.ok) return { reason: 'tool_schema', detail: check.error };
  }
  return null;
}

// ─── Single-model attempt (with one repair retry on schema failure) ──

async function attemptModel(
  model: AgentModelEntry,
  params: StreamWithFallbackParams,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const languageModel = createCompatibleModel(model);
  const providerOptions = getAgentProviderOptions(model);

  // First pass.
  const first = await runOnce(languageModel, params, providerOptions, timeoutMs);
  if (first.ok) return { ok: true, result: first.result };
  if (first.reason !== 'tool_schema') return first;

  // PRD §2 (b): ONE repair retry — re-ask the SAME model with the validation
  // error appended, before escalating.
  const repaired = await runOnce(
    languageModel,
    appendRepairMessage(params, first.detail),
    providerOptions,
    timeoutMs,
  );
  if (repaired.ok) return { ok: true, result: repaired.result };
  // Whatever the repair produced (schema-fail again or anything else) escalates.
  return repaired;
}

async function runOnce(
  languageModel: ReturnType<typeof createCompatibleModel>,
  params: StreamWithFallbackParams,
  providerOptions: ReturnType<typeof getAgentProviderOptions>,
  timeoutMs: number,
): Promise<AttemptOutcome> {
  const abort = new AbortController();
  // `streamText` reports the underlying provider error (the one with the real
  // status / `authentication_error` type) ONLY through `onError`; the awaited
  // promises just reject with a causeless `AI_NoOutputGeneratedError`. Capture
  // it here so `classifyError` can see the true failure. Supplying our own
  // `onError` also suppresses the SDK's default `console.error(error)` dump.
  let streamError: unknown;
  try {
    const result = streamText({
      ...params,
      model: languageModel,
      ...(providerOptions ? { providerOptions } : {}),
      onError: ({ error }: { error: unknown }) => {
        streamError = error;
      },
      abortSignal: abort.signal,
    } as Parameters<typeof streamText>[0]);

    let settled: SettledStream;
    try {
      settled = await settle(result, timeoutMs);
    } catch (err) {
      abort.abort();
      return { ok: false, ...classifyError(pickError(err, streamError)) };
    }

    const failure = classifySettled(settled);
    if (failure) return { ok: false, ...failure };
    return { ok: true, result };
  } catch (err) {
    abort.abort();
    return { ok: false, ...classifyError(pickError(err, streamError)) };
  }
}

function appendRepairMessage(
  params: StreamWithFallbackParams,
  validationError: string,
): StreamWithFallbackParams {
  const repairNote = {
    role: 'system' as const,
    content:
      `Your previous tool call had invalid arguments: ${validationError}. ` +
      'Re-issue the tool call with arguments that satisfy the schema.',
  };
  const existing = Array.isArray((params as { messages?: unknown }).messages)
    ? ((params as { messages: unknown[] }).messages as unknown[])
    : [];
  return {
    ...params,
    messages: [...existing, repairNote],
  } as StreamWithFallbackParams;
}

// ─── streamFinalAnswer ───────────────────────────────────────────────

/**
 * One forced final-answer turn on the SAME winning model.
 *
 * The tool loop can burn its whole step budget on tool calls and stop with NO
 * trailing assistant text (finishReason `tool-calls`), which would surface an
 * empty reply to the user. The orchestrator detects that and calls this to
 * re-ask the SAME model with `toolChoice: 'none'` and a single-step bound, so
 * the model must answer now from the tool results already gathered. No
 * escalation and no repair retry — this is a best-effort closing turn, returned
 * as a raw `streamText` result the caller settles like any other.
 */
export function streamFinalAnswer(
  model: AgentModelEntry,
  params: StreamWithFallbackParams,
): StreamResult {
  const languageModel = createCompatibleModel(model);
  const providerOptions = getAgentProviderOptions(model);
  return streamText({
    ...params,
    model: languageModel,
    toolChoice: 'none',
    stopWhen: stepCountIs(1),
    ...(providerOptions ? { providerOptions } : {}),
  } as Parameters<typeof streamText>[0]);
}

// ─── streamWithFallback ──────────────────────────────────────────────

export async function streamWithFallback(
  models: AgentModelEntry[],
  params: StreamWithFallbackParams,
  telemetry?: EscalationTelemetry,
  options?: StreamWithFallbackOptions,
): Promise<{ result: StreamResult; model: AgentModelEntry; escalations: EscalationLog[] }> {
  const timeoutMs = options?.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  const maxHops = options?.maxHops ?? DEFAULT_MAX_HOPS;
  const maxAttempts = maxHops + 1;

  const candidates = models.slice(0, maxAttempts);
  if (candidates.length === 0) {
    throw new AgentExhaustedError([]);
  }

  const escalations: EscalationLog[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    // Any throw here is a failure BEFORE the stream is usable — including model
    // construction / provider-option errors that escape `attemptModel`. Classify
    // and escalate so one bad tier never crashes the whole router; if every
    // candidate fails the loop falls through to AgentExhaustedError below.
    let outcome: AttemptOutcome;
    try {
      outcome = await attemptModel(model, params, timeoutMs);
    } catch (err) {
      outcome = { ok: false, ...classifyError(err) };
    }

    if (outcome.ok) {
      return { result: outcome.result, model, escalations };
    }

    // Record the hop to the next candidate (or to "(exhausted)" on the last).
    const to = candidates[i + 1]?.id ?? '(exhausted)';
    const hop: EscalationLog = { from: model.id, to, reason: outcome.reason };
    escalations.push(hop);
    telemetry?.(hop);
  }

  throw new AgentExhaustedError(escalations);
}
