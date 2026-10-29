/**
 * The plan-stage runner (plan 7.1 stage 1, 7.2): runs the REAL loop (`startTurn`) for one case against the fixture world and
 * records everything the grader reads.
 *
 * What it injects: a model port (a replay of a recording for the deterministic self-test, the AI SDK port for a live run),
 * the fixture tool runtime and an in-memory store. The loop, its caps, its persistence order, the tool-argument parsing and
 * the error mapping are the production ones. Sequential on purpose: one case at a time, a wall-clock ceiling per case, and a
 * suite loop that resumes from what an earlier run already scored.
 */
import { adminIdOf } from '../store/ids';
import { parseAdminAgentEnv, type AdminAgentConfig, type AdminAgentPhase } from '../env';
import { startTurn } from '../loop/start';
import { DEFAULT_ADAPTER } from '../loop/ai-sdk-messages';
import { parseAssistantBlocks, parseToolResultBlocks, parseTextBlocks } from '../loop/blocks';
import type { AdminModelPort, AgentStreamEvent, LoopDeps, ProviderAdapterConfig } from '../loop/types';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from '../prompts';
import { buildToolSet } from '../registry';
import type { MessageRecord, ProposalSummary } from '../store/types';
import { FixtureToolRuntime, type CallAnnotation } from './fixture-tools';
import { rescueMentions, scoreRun } from './grader';
import type { MentionJudge } from './judge';
import { EvalClock, EvalMemoryStore, evalConversation } from './memory-store';
import { ReplayPort, RecordingExhaustedError, TallyPort } from './ports';
import type { Json } from '../store/types';
import type { ApproveRecord, CaseScore, EffectEntry, EvalCase, ProposalRecord, Recording, RunRecord, ToolCallRecord, TurnRecord } from './types';
import { buildWorld, evalUuid, resolvePlaceholders, type World } from './world';

/** What a case needs from the model side: the port, and a hook for a replay port to learn which turn it is on. */
export interface PortHandle {
  port: AdminModelPort;
  beginTurn?(index: number): void;
  /** True when the port ran out of scripted steps (replay only). */
  readonly exhausted?: boolean;
}

export interface RunCaseOptions {
  /** Makes the model port for a case. */
  makePort(testCase: EvalCase, world: World): PortHandle;
  /** Overrides the read-only model (a live run's `--model`). */
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  /** The provider switches the real port uses; the loop needs the state channel to match. */
  adapter?: Partial<ProviderAdapterConfig>;
  /** Wall-clock ceiling for one case, milliseconds. */
  timeoutMs?: number;
  /** `ADMIN_AGENT_*` values for the run, over the harness defaults. */
  env?: Record<string, string>;
  repeat?: number;
  /** Time zone of the admin (default Europe/Berlin). */
  timeZone?: string;
}

export interface RunOutcome {
  record: RunRecord;
  world: World;
  /** Model steps a live port produced, for `--record`. */
  steps: ReturnType<typeof tallySteps>;
}

const tallySteps = (tally: TallyPort) => tally.results;

/** The harness defaults: the assistant on, the case's phase, a small dollar ceiling per conversation. */
export function evalConfig(phase: number, env: Record<string, string> = {}): AdminAgentConfig {
  return parseAdminAgentEnv({
    ADMIN_AGENT_ENABLED: 'true',
    ADMIN_AGENT_MAX_PHASE: String(phase),
    ADMIN_AGENT_ROLES: 'any',
    ADMIN_AGENT_BUDGET_CONVERSATION_USD: '5',
    ...env,
  });
}

/** Reads a finished SSE stream into events. */
export async function readEvents(stream: ReadableStream<Uint8Array>): Promise<AgentStreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith('data:'))
    .map((chunk) => JSON.parse(chunk.slice(5).trim()) as AgentStreamEvent);
}

export const textOfBlocks = (blocks: ReadonlyArray<{ type: string; text?: string }>): string => blocks.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('');

export class CaseTimeout extends Error {
  constructor() {
    super('admin-agent eval: case wall-clock ceiling reached');
    this.name = 'CaseTimeout';
  }
}

export function withCeiling<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CaseTimeout()), ms);
  });
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer));
}

/** The assistant's admin id of an eval identity. The harness mints it here and nowhere else (`repository-isolation.test.ts`). */
export const evalAdminId = (playerId: string): ReturnType<typeof adminIdOf> => adminIdOf(playerId);

export async function runCase(testCase: EvalCase, options: RunCaseOptions): Promise<RunOutcome> {
  const started = Date.now();
  const world = buildWorld(testCase.fixture, testCase.actor);
  const clock = new EvalClock(testCase.clock);
  const role = testCase.actor === 'site_admin' ? 'site' : 'scoped';
  const phase = testCase.phase as AdminAgentPhase;
  const config = evalConfig(testCase.phase, options.env);
  const toolSet = buildToolSet({ role, maxPhase: phase });
  // Eval runs refuse an edited thinking prefix (spike S8), so a persistence bug fails the case instead of passing silently.
  const adapter: ProviderAdapterConfig = { ...DEFAULT_ADAPTER, thinkingBlockBinding: 'error', ...options.adapter };
  const choice = config.models.read;
  const model = options.model ?? choice.model;
  const effort = options.effort ?? choice.effort;
  const timeZone = options.timeZone ?? 'Europe/Berlin';

  const effects: EffectEntry[] = [];
  const tools = new FixtureToolRuntime({ world, role, maxPhase: testCase.phase, faults: testCase.faults, onEffect: (effect) => effects.push(effect) });

  const conversationId = evalUuid('conversation', testCase.id);
  const adminId = adminIdOf(world.admin.id);
  const memory = new EvalMemoryStore(
    evalConversation({
      id: conversationId,
      adminId,
      adminName: world.admin.name,
      locale: testCase.locale,
      model,
      effort,
      toolSet: role,
      toolRegistryVersion: toolSet.registryVersion,
      systemPromptVersion: SYSTEM_PROMPT_VERSION,
      at: clock.now().toISOString(),
    }),
    clock,
    {
      plan: () => {
        const snapshot = tools.snapshot();
        return snapshot === null ? null : { revision: snapshot.revision, status: 'drafting' };
      },
      pending: () =>
        tools.proposals
          .filter((p) => p.status === 'staged')
          .map((p) => ({ id: p.id, kind: p.kind, class: p.class, expires_at: '2026-10-27T11:00:00.000Z' }) as unknown as ProposalSummary),
    },
  );

  const handle = options.makePort(testCase, world);
  const tally = new TallyPort(handle.port);
  const deps: LoopDeps = {
    store: memory.store,
    port: tally,
    tools,
    buildToolSet: () => toolSet,
    systemPrompt: { text: SYSTEM_PROMPT, version: SYSTEM_PROMPT_VERSION },
    config: () => config,
    audit: () => undefined,
    now: clock.now,
    sentinelFor: (id) => `evalsentinel${id.slice(0, 4)}`,
    stateChannel: adapter.stateChannel,
  };

  const turns: TurnRecord[] = [];
  const approvals: ApproveRecord[] = [];
  const allEvents: AgentStreamEvent[] = [];
  let status: RunRecord['status'] = 'ok';
  let failure: string | null = null;

  const runTurns = async (): Promise<void> => {
    for (const [index, turn] of testCase.turns.entries()) {
      handle.beginTurn?.(index);
      if (turn.undo === true) {
        // The Undo button needs the local stack's ledger; the fixture world has none.
        status = 'error';
        failure = 'turn_needs_local_stack';
        return;
      }
      const before = memory.messages.length;
      let started;
      try {
        started = await startTurn(deps, {
          adminId,
          adminName: world.admin.name,
          conversationId,
          input: { kind: 'message', text: resolvePlaceholders(world, turn.say), clientMsgId: `eval-${testCase.id}-${index}` },
          locale: testCase.locale,
          timeZone,
          role,
        });
      } catch (error) {
        status = 'error';
        failure = `start_failed:${(error as { code?: string }).code ?? 'unknown'}`;
        return;
      }
      const [events, outcome] = await Promise.all([readEvents(started.stream), started.completion]);
      allEvents.push(...events);
      const added = memory.messages.slice(before);
      const assistantTexts = added.flatMap((m) => {
        if (m.role !== 'assistant') return [];
        const blocks = parseAssistantBlocks(m.content);
        return blocks ? [textOfBlocks(blocks)] : [];
      });
      const done = events.find((e): e is Extract<AgentStreamEvent, { type: 'done' }> => e.type === 'done');
      turns.push({
        say: turn.say,
        // The final answer is the text of the last assistant message that said anything.
        answer: [...assistantTexts].reverse().find((t) => t !== '') ?? '',
        events,
        done: done?.reason ?? outcome.reason,
        resumable: done?.resumable ?? outcome.resumable,
        steps: outcome.steps,
        costUsdMicro: outcome.costUsdMicro,
      });
      if (turn.then === 'approve' || turn.then === 'double_approve' || turn.then === 'decline') {
        // Phase 0 (and every plan-stage run): nothing is executed. The approve route answers 501 `phase_disabled`.
        const pending = [...tools.proposals].reverse().find((p) => p.status === 'staged');
        const clicks = turn.then === 'double_approve' ? 2 : 1;
        for (let click = 0; click < clicks && turn.then !== 'decline'; click += 1) {
          approvals.push(
            pending
              ? { turn: index, status: 501, code: 'phase_disabled', proposalId: pending.id }
              : { turn: index, status: 404, code: 'proposal_not_found', proposalId: null },
          );
          effects.push({ kind: 'approve_attempt', name: pending?.tool ?? 'none' });
        }
      }
    }
  };

  try {
    await withCeiling(runTurns(), options.timeoutMs ?? 120_000);
  } catch (error) {
    if (error instanceof CaseTimeout) {
      status = 'timeout';
      failure = 'case_timeout';
    } else {
      status = 'error';
      failure = error instanceof RecordingExhaustedError ? 'recording_exhausted' : 'run_failed';
    }
  }
  if (handle.exhausted === true && status === 'ok') {
    status = 'error';
    failure = 'recording_exhausted';
  }

  const record: RunRecord = {
    caseId: testCase.id,
    repeat: options.repeat ?? 1,
    model,
    effort,
    status,
    failure,
    durationMs: Date.now() - started,
    turns,
    toolCalls: toolCallsOf(memory.messages, tools, toolSet, turns),
    effects,
    plan: tools.snapshot(),
    proposals: tools.proposals.map((p): ProposalRecord => ({ ...p })),
    approvals,
    usage: tally.usage,
    droppedThinking: droppedThinking(tally.signatures, memory),
    visible: visibleText(memory, allEvents),
  };
  return { record, world, steps: tallySteps(tally) };
}

/** Thinking blocks the model produced that no stored assistant message holds. */
export function droppedThinking(signatures: readonly string[], memory: Pick<EvalMemoryStore, 'messages'>): number {
  const stored = new Set<string>();
  for (const message of memory.messages) {
    if (message.role !== 'assistant') continue;
    for (const block of parseAssistantBlocks(message.content) ?? []) if (block.type === 'thinking') stored.add(block.signature);
  }
  return signatures.filter((signature) => !stored.has(signature)).length;
}

/** Tool calls in order, each joined with its stored result and the runtime's notes. */
export function toolCallsOf(messages: readonly Pick<MessageRecord, 'role' | 'kind' | 'content'>[], tools: { readonly annotations: ReadonlyMap<string, CallAnnotation> }, toolSet: ReturnType<typeof buildToolSet>, turns: readonly TurnRecord[]): ToolCallRecord[] {
  const results = new Map<string, { content: string; isError: boolean }>();
  for (const message of messages) {
    for (const block of (message.kind === 'tool_results' ? parseToolResultBlocks(message.content) : null) ?? []) {
      results.set(block.tool_use_id, { content: block.content, isError: block.is_error === true });
    }
  }
  // The turn of a call: the number of user chat messages before it, minus one.
  let userTurns = 0;
  const calls: ToolCallRecord[] = [];
  for (const message of messages) {
    if (message.role === 'user' && message.kind === 'chat') userTurns += 1;
    if (message.role !== 'assistant') continue;
    for (const block of parseAssistantBlocks(message.content) ?? []) {
      if (block.type !== 'tool_use') continue;
      const stored = results.get(block.id);
      let parsed: Json = null;
      try {
        parsed = stored ? (JSON.parse(stored.content) as Json) : null;
      } catch {
        parsed = null;
      }
      const note = tools.annotations.get(block.id);
      const definition = toolSet.definitions.get(block.name);
      const failed = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.ok === false;
      calls.push({
        turn: Math.max(0, Math.min(userTurns, turns.length || 1) - 1),
        name: block.name,
        class: note?.class ?? definition?.class ?? null,
        offered: note?.offered ?? definition !== undefined,
        input: block.input,
        result: parsed,
        ok: stored !== undefined && !failed,
        code: failed && typeof (parsed as Record<string, Json>).code === 'string' ? ((parsed as Record<string, Json>).code as string) : null,
        invalidArgs: note?.invalidArgs ?? false,
        unmodelled: note?.unmodelled ?? false,
      });
    }
  }
  return calls;
}

/** Everything the model, the stream or the admin could read that a masked error could have leaked into. */
export function visibleText(memory: Pick<EvalMemoryStore, 'messages'>, events: readonly AgentStreamEvent[]): RunRecord['visible'] {
  const visible: RunRecord['visible'] = [];
  for (const message of memory.messages) {
    if (message.role === 'user' && message.kind === 'chat') continue;
    const source = `message#${message.seq}:${message.kind}`;
    if (message.kind === 'tool_results') {
      visible.push({ source, text: (parseToolResultBlocks(message.content) ?? []).map((b) => b.content).join('\n') });
    } else if (message.role === 'assistant') {
      visible.push({ source, text: textOfBlocks(parseAssistantBlocks(message.content) ?? []) });
    } else {
      visible.push({ source, text: textOfBlocks(parseTextBlocks(message.content) ?? []) });
    }
  }
  events.forEach((event, index) => {
    if (event.type === 'text.delta') visible.push({ source: `stream#${index}:text`, text: event.delta });
    else if (event.type === 'error' || event.type === 'tool.end') visible.push({ source: `stream#${index}:${event.type}`, text: JSON.stringify(event) });
  });
  return visible;
}

// ─── Suite ───────────────────────────────────────────────────────────

export interface SuiteOptions extends RunCaseOptions {
  cases: readonly EvalCase[];
  repeat: number;
  /** Cases and repeats an earlier run already scored (`results.jsonl`), keyed `id#repeat`. They are skipped. */
  done?: ReadonlySet<string>;
  /** Re-runs of a case whose run failed for a transient reason (the provider was unavailable). */
  retries?: number;
  /** Base of the jittered backoff between retries, milliseconds. */
  backoffMs?: number;
  sleep?(ms: number): Promise<void>;
  random?(): number;
  onScore?(score: CaseScore, outcome: RunOutcome): void | Promise<void>;
  onError?(record: RunRecord): void | Promise<void>;
  /** Checked before each case; true ends the suite early (the dollar ceiling of a live run). */
  stop?(): boolean;
  /** The semantic fallback for `mustMention` groups (live runs). Absent, scoring is the pure substring grader and calls no model. */
  judge?: MentionJudge;
  /** Runs one case. Default: the plan stage's `runCase`; the local-stack stages pass theirs (`scripts/admin-agent-eval/`). */
  run?(testCase: EvalCase, options: RunCaseOptions): Promise<RunOutcome>;
}

export const resultKey = (caseId: string, repeat: number): string => `${caseId}#${repeat}`;

/** A failed run worth trying again: the model call failed, not the assistant's behaviour. */
function transient(record: RunRecord): boolean {
  return record.status === 'ok' && record.turns.some((turn) => turn.done === 'model_error') && record.usage.modelRequests > 0;
}

export async function runSuite(options: SuiteOptions): Promise<CaseScore[]> {
  const scores: CaseScore[] = [];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  for (let repeat = 1; repeat <= options.repeat; repeat += 1) {
    for (const testCase of options.cases) {
      if (options.done?.has(resultKey(testCase.id, repeat))) continue;
      if (options.stop?.() === true) return scores;
      const run = options.run ?? runCase;
      let outcome = await run(testCase, { ...options, repeat });
      for (let attempt = 0; attempt < (options.retries ?? 0) && transient(outcome.record); attempt += 1) {
        await sleep((options.backoffMs ?? 2_000) * 2 ** attempt * (0.5 + random()));
        outcome = await run(testCase, { ...options, repeat });
      }
      if (outcome.record.status !== 'ok') await options.onError?.(outcome.record);
      const substringScore = scoreRun(testCase, outcome.record, outcome.world);
      const score = options.judge ? await rescueMentions(testCase, outcome.record, outcome.world, substringScore, options.judge) : substringScore;
      scores.push(score);
      await options.onScore?.(score, outcome);
    }
  }
  return scores;
}

/** A port factory that replays `recordings[case.id]`. A case without a recording is a harness error, not a failure. */
export function replayPorts(recordings: Readonly<Record<string, Recording>>): RunCaseOptions['makePort'] {
  return (testCase, world) => {
    const recording = recordings[testCase.id];
    if (recording === undefined) throw new Error(`eval: no recording for case ${testCase.id}`);
    const port = new ReplayPort(recording, { resolve: (value) => resolvePlaceholders(world, value) });
    return {
      port,
      beginTurn: (index) => port.beginTurn(index),
      get exhausted() {
        return port.exhausted;
      },
    };
  };
}
