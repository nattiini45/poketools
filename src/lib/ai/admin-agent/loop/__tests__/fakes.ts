/**
 * Test doubles for the loop: an in-memory store (same contract as the real one for the calls the loop makes), a scripted
 * model port, a scripted tool runtime and a controllable clock. `npm run test` never reaches a database or a provider.
 */
import { AdminAgentStoreError } from '../../store/errors';
import { adminIdOf, type AdminId } from '../../store/ids';
import { findForbiddenMessageContent } from '../../store/payload-guard';
import type { ConversationRecord, MessageRecord, NewMessage, PlanRecord, ProposalSummary, ReserveUsageResult, UsageCaps, UsageMeters, UsageReservation, UsageSettlement } from '../../store/types';
import { parseAdminAgentEnv, type AdminAgentConfig } from '../../env';
import type { ToolSet, WireTool } from '../../registry';
import type { ToolDefinition } from '../../registry';
import type { ModelCompleteInput, ModelCompleteResult, ModelStopInfo, ModelStepInput, ModelStepResult, ToolCallContext, ToolRunResult, ToolRuntime, LoopDeps, LoopStore, AgentStreamEvent, AdminModelPort } from '../types';
import type { AssistantBlock } from '../blocks';

export const ADMIN: AdminId = adminIdOf('11111111-1111-4111-8111-111111111111');
export const OTHER_ADMIN: AdminId = adminIdOf('22222222-2222-4222-8222-222222222222');
export const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';

export const ZERO_USAGE: UsageMeters = { inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

// ─── Clock ───────────────────────────────────────────────────────────

export class Clock {
  private ms: number;
  constructor(iso = '2026-10-27T10:00:00.000Z') {
    this.ms = Date.parse(iso);
  }
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

// ─── In-memory store ─────────────────────────────────────────────────

export function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: CONVERSATION_ID,
    admin_id: ADMIN,
    admin_name: 'Test Admin',
    title: null,
    status: 'active',
    ui_locale: 'en',
    context: {},
    model: 'claude-opus-5-5',
    effort: 'medium',
    tool_set: 'site',
    tool_registry_version: 'registry-test',
    system_prompt_version: 'prompt-test',
    active_plan_id: null,
    seq_head: 0,
    turn_lease_until: null,
    version: 1,
    blast_league_creates: 0,
    blast_tournament_creates: 0,
    blast_ruleset_creates: 0,
    blast_format_creates: 0,
    blast_golive_executions: 0,
    blast_pin_targets: 0,
    last_message_at: '2026-10-27T09:00:00.000Z',
    created_at: '2026-10-27T09:00:00.000Z',
    updated_at: '2026-10-27T09:00:00.000Z',
    ...overrides,
  };
}

interface UsageRow {
  id: string;
  adminId: string;
  conversationId: string | null;
  purpose: string;
  model: string;
  reserved: number;
  cost: number;
  settled: boolean;
  stopReason: string | null;
  meters: UsageMeters | null;
}

/** Everything the store saw, in order, for the persistence-order assertions. */
export type StoreLogEntry =
  | { op: 'append'; seq: number; role: string; kind: string }
  | { op: 'reserve'; usageId: string; estimate: number }
  | { op: 'settle'; usageId: string; cost: number }
  | { op: 'lease'; acquired: boolean }
  | { op: 'release' };

export class FakeStore {
  conversation: ConversationRecord;
  messages: MessageRecord[] = [];
  usage: UsageRow[] = [];
  log: StoreLogEntry[] = [];
  plan: Pick<PlanRecord, 'revision' | 'status'> | null = null;
  pending: Array<Pick<ProposalSummary, 'id' | 'kind' | 'class' | 'expires_at'>> = [];
  /** Appends of this kind fail once (with a plain error) when set. */
  failAppend: { kind: string; times: number } | null = null;
  /** Settle fails once when true. */
  failSettle = false;
  /** Every ref the loop recorded, in order (provenance, plan 6.3). */
  refs: Array<{ kind: string; id: string; label?: string | null; source: string }> = [];
  failRecordRefs = false;
  clock: Clock;
  private nextId = 1;

  constructor(conversation: ConversationRecord = makeConversation(), clock = new Clock()) {
    this.conversation = conversation;
    this.clock = clock;
  }

  private own(adminId: string, conversationId: string): boolean {
    return adminId === this.conversation.admin_id && conversationId === this.conversation.id;
  }

  /** Seeds a stored message without going through the loop. */
  seed(message: Omit<NewMessage, 'content'> & { content: unknown }): MessageRecord {
    const seq = this.messages.length === 0 ? 1 : this.messages[this.messages.length - 1].seq + 1;
    const record: MessageRecord = {
      conversation_id: this.conversation.id,
      seq,
      role: message.role,
      kind: message.kind,
      content: message.content as MessageRecord['content'],
      content_purged_at: null,
      ui: message.ui ?? null,
      model: message.model ?? null,
      stop_reason: message.stopReason ?? null,
      usage: message.usage ?? null,
      client_msg_id: message.clientMsgId ?? null,
      created_at: this.clock.now().toISOString(),
    };
    this.messages.push(record);
    this.conversation = { ...this.conversation, seq_head: seq };
    return record;
  }

  /** Total of settled cost and unsettled reservations, micro-dollars. */
  spend(): number {
    return this.usage.reduce((sum, row) => sum + (row.settled ? row.cost : row.reserved), 0);
  }

  readonly store: LoopStore = {
    conversations: {
      getConversation: async (adminId, id) => (this.own(adminId, id) ? this.conversation : null),
      acquireTurnLease: async (adminId, id) => {
        if (!this.own(adminId, id)) return { ok: false, reason: 'not_found' };
        const until = this.conversation.turn_lease_until;
        if (until !== null && Date.parse(until) > this.clock.now().getTime()) {
          this.log.push({ op: 'lease', acquired: false });
          return { ok: false, reason: 'conversation_busy' };
        }
        const leaseUntil = new Date(this.clock.now().getTime() + 320_000).toISOString();
        this.conversation = { ...this.conversation, turn_lease_until: leaseUntil };
        this.log.push({ op: 'lease', acquired: true });
        return { ok: true, leaseUntil };
      },
      releaseTurnLease: async (adminId, id, leaseUntil) => {
        if (!this.own(adminId, id) || this.conversation.turn_lease_until !== leaseUntil) return false;
        this.conversation = { ...this.conversation, turn_lease_until: null };
        this.log.push({ op: 'release' });
        return true;
      },
      updateConversation: async (adminId, id, patch, expectedVersion) => {
        if (!this.own(adminId, id)) throw new AdminAgentStoreError('conversation_not_found');
        if (this.conversation.version !== expectedVersion) return null;
        this.conversation = {
          ...this.conversation,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          version: expectedVersion + 1,
        };
        return this.conversation;
      },
    },
    messages: {
      appendMessage: async (adminId, id, input) => {
        if (!this.own(adminId, id)) throw new AdminAgentStoreError('conversation_not_found');
        if (this.failAppend && this.failAppend.kind === input.kind && this.failAppend.times > 0) {
          this.failAppend.times -= 1;
          throw new Error('append failed (test)');
        }
        if (input.clientMsgId) {
          const existing = this.messages.find((m) => m.client_msg_id === input.clientMsgId);
          if (existing) return { message: existing, duplicate: true };
        }
        const violation = findForbiddenMessageContent(input.role, input.content);
        if (violation) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'payload_forbidden', detail: { path: violation.path } });
        const message = this.seed(input);
        this.log.push({ op: 'append', seq: message.seq, role: message.role, kind: message.kind });
        return { message, duplicate: false };
      },
      loadHistory: async (adminId, id) => {
        if (!this.own(adminId, id)) throw new AdminAgentStoreError('conversation_not_found');
        return { messages: [...this.messages].sort((a, b) => a.seq - b.seq), truncated: false };
      },
    },
    usage: {
      reserveUsage: async (adminId, input: UsageReservation): Promise<ReserveUsageResult> => {
        const caps: UsageCaps = input.caps ?? { conversationMicro: Infinity, adminDayMicro: Infinity, adminMonthMicro: Infinity, globalDayMicro: Infinity };
        const used = this.spend();
        const conversationUsed = this.usage.filter((r) => r.conversationId === input.conversationId).reduce((s, r) => s + (r.settled ? r.cost : r.reserved), 0);
        if (conversationUsed + input.estimateUsdMicro > caps.conversationMicro) {
          return { ok: false, exceeded: 'conversation', usedMicro: conversationUsed, capMicro: caps.conversationMicro };
        }
        if (used + input.estimateUsdMicro > caps.adminDayMicro) return { ok: false, exceeded: 'admin_day', usedMicro: used, capMicro: caps.adminDayMicro };
        const usageId = `44444444-4444-4444-8444-${String(this.nextId++).padStart(12, '0')}`;
        this.usage.push({ id: usageId, adminId, conversationId: input.conversationId, purpose: input.purpose, model: input.model, reserved: input.estimateUsdMicro, cost: 0, settled: false, stopReason: null, meters: null });
        this.log.push({ op: 'reserve', usageId, estimate: input.estimateUsdMicro });
        return { ok: true, usageId };
      },
      settleUsage: async (_adminId, usageId, settlement: UsageSettlement) => {
        if (this.failSettle) {
          this.failSettle = false;
          throw new Error('settle failed (test)');
        }
        const row = this.usage.find((r) => r.id === usageId);
        if (!row) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'usage_not_found' });
        if (row.settled) return false;
        row.settled = true;
        row.cost = settlement.costUsdMicro;
        row.stopReason = settlement.stopReason;
        row.meters = { inputTokens: settlement.inputTokens, cacheWrite5mTokens: settlement.cacheWrite5mTokens, cacheWrite1hTokens: settlement.cacheWrite1hTokens, cacheReadTokens: settlement.cacheReadTokens, outputTokens: settlement.outputTokens };
        this.log.push({ op: 'settle', usageId, cost: settlement.costUsdMicro });
        return true;
      },
      releaseUsage: async (adminId, usageId, reason) =>
        this.store.usage.settleUsage(adminId, usageId, { ...ZERO_USAGE, costUsdMicro: 0, stopReason: reason ?? 'not_called' }),
      getSpend: async (_adminId, conversationId) => ({
        conversationMicro: conversationId === undefined ? null : this.usage.filter((r) => r.conversationId === conversationId).reduce((s, r) => s + (r.settled ? r.cost : r.reserved), 0),
        adminDayMicro: this.spend(),
        adminMonthMicro: this.spend(),
        truncated: false,
      }),
    },
    plans: {
      getActivePlan: async () => (this.plan ? ({ ...this.plan } as PlanRecord) : null),
    },
    proposals: {
      listPendingProposals: async () => this.pending as ProposalSummary[],
    },
    refs: {
      recordRefs: async (_adminId, _conversationId, refs) => {
        this.refs.push(...refs.map((ref) => ({ ...ref })));
        if (this.failRecordRefs) throw new Error('record refs failed (test)');
        return refs.length;
      },
    },
  };
}

// ─── Model port ──────────────────────────────────────────────────────

export interface StepSpec extends ModelStopInfo {
  blocks: AssistantBlock[];
  stopReason?: ModelStepResult['stopReason'];
  rawStopReason?: string | null;
  usage?: Partial<UsageMeters>;
  model?: string;
  /** Text deltas to stream before the step returns (default: the text blocks, whole). */
  deltas?: string[];
  /** Milliseconds the fake clock advances while this step runs. */
  advanceMs?: number;
  invalidToolCallIds?: string[];
}

export function textStep(text: string, extra: Partial<StepSpec> = {}): StepSpec {
  return { blocks: [{ type: 'text', text }], stopReason: 'end_turn', ...extra };
}

export function toolStep(calls: Array<{ name: string; input?: Record<string, unknown>; id?: string }>, extra: Partial<StepSpec> & { text?: string } = {}): StepSpec {
  const { text, ...rest } = extra;
  let n = 0;
  const blocks: AssistantBlock[] = [
    { type: 'thinking', thinking: 'thinking about it', signature: 'sig-abc' },
    ...(text ? ([{ type: 'text', text }] as AssistantBlock[]) : []),
    ...calls.map((call): AssistantBlock => {
      n += 1;
      return { type: 'tool_use', id: call.id ?? `toolu_${n}`, name: call.name, input: (call.input ?? {}) as never };
    }),
  ];
  return { blocks, stopReason: 'tool_use', ...rest };
}

export class FakePort implements AdminModelPort {
  readonly steps: Array<StepSpec | Error> = [];
  readonly inputs: ModelStepInput[] = [];
  readonly completions: ModelCompleteInput[] = [];
  completeText: string | Error = 'Draft a league';
  /** Extra fields every `complete` call returns (stop reason and details). */
  completeExtra: Partial<ModelCompleteResult> = {};
  constructor(private readonly clock?: Clock) {}

  script(...specs: Array<StepSpec | Error>): this {
    this.steps.push(...specs);
    return this;
  }

  async step(input: ModelStepInput): Promise<ModelStepResult> {
    // The transcript array is the loop's live one: keep a snapshot of what this call saw.
    this.inputs.push({ ...input, transcript: [...input.transcript] });
    const spec = this.steps.shift();
    if (spec === undefined) throw new Error('FakePort: no scripted step left');
    if (spec instanceof Error) throw spec;
    for (const delta of spec.deltas ?? spec.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []))) input.onTextDelta?.(delta);
    this.clock?.advance(spec.advanceMs ?? 0);
    const toolCalls = spec.blocks.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input, ...(spec.invalidToolCallIds?.includes(b.id) ? { invalid: true } : {}) }] : []));
    return {
      blocks: spec.blocks,
      toolCalls,
      stopReason: spec.stopReason ?? (toolCalls.length > 0 ? 'tool_use' : 'end_turn'),
      rawStopReason: spec.rawStopReason ?? null,
      usage: { inputTokens: 1000, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 200, ...spec.usage },
      model: spec.model ?? input.model,
      ...(spec.finishReason !== undefined ? { finishReason: spec.finishReason } : {}),
      ...(spec.rawFinishReason !== undefined ? { rawFinishReason: spec.rawFinishReason } : {}),
      ...(spec.stopDetails !== undefined ? { stopDetails: spec.stopDetails } : {}),
      ...(spec.iterations !== undefined ? { iterations: spec.iterations } : {}),
    };
  }

  async complete(input: ModelCompleteInput): Promise<ModelCompleteResult> {
    this.completions.push(input);
    if (this.completeText instanceof Error) throw this.completeText;
    return { text: this.completeText, usage: { ...ZERO_USAGE, inputTokens: 100, outputTokens: 10 }, model: input.model, ...this.completeExtra };
  }
}

// ─── Tool set and runtime ────────────────────────────────────────────

export function fakeToolSet(classes: Record<string, 'R' | 'P' | 'D' | 'B' | 'G'>, registryVersion = 'registry-test'): ToolSet {
  const names = Object.keys(classes).sort();
  const definitions = new Map<string, ToolDefinition>(names.map((name) => [name, { name, class: classes[name] } as unknown as ToolDefinition]));
  const tools: WireTool[] = names.map((name) => ({ name, description: `${name} (${classes[name]})`, input_schema: { type: 'object', properties: {}, additionalProperties: false }, strict: true }));
  return { role: 'site', maxPhase: 0, tools, names, wireBytes: JSON.stringify(tools), registryVersion, definitions } as ToolSet;
}

export type ToolHandler = (input: unknown, ctx: ToolCallContext) => ToolRunResult | Promise<ToolRunResult>;

export class FakeTools implements ToolRuntime {
  readonly calls: Array<{ name: string; input: unknown; ctx: ToolCallContext }> = [];
  /** Names in the order they started and finished. */
  readonly timeline: string[] = [];
  constructor(private readonly handlers: Record<string, ToolHandler> = {}) {}

  on(name: string, handler: ToolHandler): this {
    this.handlers[name] = handler;
    return this;
  }

  async run(_set: ToolSet, call: { name: string; input: unknown }, ctx: ToolCallContext): Promise<ToolRunResult> {
    this.calls.push({ name: call.name, input: call.input, ctx });
    this.timeline.push(`start:${call.name}`);
    const handler = this.handlers[call.name];
    try {
      if (!handler) return { ok: false, code: 'tool_not_available' };
      return await handler(call.input, ctx);
    } finally {
      this.timeline.push(`end:${call.name}`);
    }
  }
}

// ─── Deps ────────────────────────────────────────────────────────────

export function testConfig(env: Record<string, string> = {}): AdminAgentConfig {
  return parseAdminAgentEnv({ ADMIN_AGENT_ENABLED: 'true', ...env });
}

export interface Harness {
  fake: FakeStore;
  port: FakePort;
  tools: FakeTools;
  clock: Clock;
  audit: Array<Parameters<LoopDeps['audit']>[0]>;
  deps: LoopDeps;
  toolSet: ToolSet;
}

export function harness(options: { classes?: Record<string, 'R' | 'P' | 'D' | 'B' | 'G'>; env?: Record<string, string>; conversation?: Partial<ConversationRecord>; stateChannel?: LoopDeps['stateChannel'] } = {}): Harness {
  const clock = new Clock();
  // A conversation that already has a title: the title call is its own test.
  const fake = new FakeStore(makeConversation({ title: 'Existing title', ...options.conversation }), clock);
  const port = new FakePort(clock);
  const tools = new FakeTools();
  const audit: Harness['audit'] = [];
  const toolSet = fakeToolSet(options.classes ?? { league_get: 'R', league_list: 'R', dex_lookup: 'P', plan_set: 'D', plan_patch: 'D', propose_build: 'B', propose_start_phase: 'G', propose_publish_ruleset: 'G' });
  const config = testConfig(options.env);
  const deps: LoopDeps = {
    store: fake.store,
    port,
    tools,
    buildToolSet: () => toolSet,
    systemPrompt: { text: 'SYSTEM PROMPT', version: 'prompt-test' },
    config: () => config,
    audit: (entry) => audit.push(entry),
    now: clock.now,
    sentinelFor: (id) => `sentinel-${id.slice(0, 4)}`,
    stateChannel: options.stateChannel ?? 'system-message',
  };
  return { fake, port, tools, clock, audit, deps, toolSet };
}

// ─── Stream helpers ──────────────────────────────────────────────────

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

export const typesOf = (events: readonly AgentStreamEvent[]) => events.map((e) => e.type);
