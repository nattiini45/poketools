/**
 * An in-memory `LoopStore` for the plan stage: the same contract as the real store for the calls the loop makes, with no
 * database. The loop's own test double (`loop/__tests__/fakes.ts`) is test code and stays there; this one belongs to the
 * harness, which ships in the runner, and adds what grading needs: every stored message is readable afterwards (the leak
 * scan and the dropped-thinking check read them) and the Plan and pending proposals come from the fixture runtime.
 *
 * It applies the payload guard (a stored message with a private key or a webhook URL is refused, as in production) and the
 * per-conversation and per-day dollar caps, so a run that overspends stops the way a real one does.
 */
import { AdminAgentStoreError } from '../store/errors';
import { findForbiddenMessageContent } from '../store/payload-guard';
import type { ConversationRecord, MessageRecord, NewMessage, PlanRecord, ProposalSummary, ReserveUsageResult, UsageCaps, UsageMeters, UsageReservation, UsageSettlement } from '../store/types';
import type { LoopStore } from '../loop/types';

const UUID_TAIL = (n: number) => String(n).padStart(12, '0');

export class EvalClock {
  private ms: number;
  constructor(iso: string) {
    this.ms = Date.parse(iso);
  }
  now = (): Date => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

export function evalConversation(input: {
  id: string;
  adminId: string;
  adminName: string;
  locale: 'en' | 'de';
  model: string;
  effort: string;
  toolSet: 'site' | 'scoped';
  toolRegistryVersion: string;
  systemPromptVersion: string;
  at: string;
}): ConversationRecord {
  return {
    id: input.id,
    admin_id: input.adminId,
    admin_name: input.adminName,
    title: 'Eval conversation',
    status: 'active',
    ui_locale: input.locale,
    context: {},
    model: input.model,
    effort: input.effort,
    tool_set: input.toolSet,
    tool_registry_version: input.toolRegistryVersion,
    system_prompt_version: input.systemPromptVersion,
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
    last_message_at: input.at,
    created_at: input.at,
    updated_at: input.at,
  };
}

interface UsageRow {
  id: string;
  conversationId: string | null;
  reserved: number;
  cost: number;
  settled: boolean;
}

export interface MemoryStoreHooks {
  /** The Plan the conversation has, from the fixture runtime. */
  plan(): { revision: number; status: string } | null;
  /** The proposals waiting for the admin, from the fixture runtime. */
  pending(): ProposalSummary[];
}

export class EvalMemoryStore {
  conversation: ConversationRecord;
  readonly messages: MessageRecord[] = [];
  private readonly usage: UsageRow[] = [];
  private nextUsage = 1;

  constructor(
    conversation: ConversationRecord,
    private readonly clock: EvalClock,
    private readonly hooks: MemoryStoreHooks,
  ) {
    this.conversation = conversation;
  }

  private own(adminId: string, conversationId: string): boolean {
    return adminId === this.conversation.admin_id && conversationId === this.conversation.id;
  }

  private spend(): number {
    return this.usage.reduce((sum, row) => sum + (row.settled ? row.cost : row.reserved), 0);
  }

  /** Total settled cost, micro-dollars. */
  settledCost(): number {
    return this.usage.filter((row) => row.settled).reduce((sum, row) => sum + row.cost, 0);
  }

  private append(message: NewMessage): MessageRecord {
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

  readonly store: LoopStore = {
    conversations: {
      getConversation: async (adminId, id) => (this.own(adminId, id) ? this.conversation : null),
      acquireTurnLease: async (adminId, id) => {
        if (!this.own(adminId, id)) return { ok: false, reason: 'not_found' };
        const until = this.conversation.turn_lease_until;
        if (until !== null && Date.parse(until) > this.clock.now().getTime()) return { ok: false, reason: 'conversation_busy' };
        const leaseUntil = new Date(this.clock.now().getTime() + 320_000).toISOString();
        this.conversation = { ...this.conversation, turn_lease_until: leaseUntil };
        return { ok: true, leaseUntil };
      },
      releaseTurnLease: async (adminId, id, leaseUntil) => {
        if (!this.own(adminId, id) || this.conversation.turn_lease_until !== leaseUntil) return false;
        this.conversation = { ...this.conversation, turn_lease_until: null };
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
        if (input.clientMsgId) {
          const existing = this.messages.find((m) => m.client_msg_id === input.clientMsgId);
          if (existing) return { message: existing, duplicate: true };
        }
        const violation = findForbiddenMessageContent(input.role, input.content);
        if (violation) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'payload_forbidden', detail: { path: violation.path } });
        return { message: this.append(input), duplicate: false };
      },
      loadHistory: async (adminId, id) => {
        if (!this.own(adminId, id)) throw new AdminAgentStoreError('conversation_not_found');
        return { messages: [...this.messages].sort((a, b) => a.seq - b.seq), truncated: false };
      },
    },
    usage: {
      reserveUsage: async (_adminId, input: UsageReservation): Promise<ReserveUsageResult> => {
        const caps: UsageCaps = input.caps ?? { conversationMicro: Infinity, adminDayMicro: Infinity, adminMonthMicro: Infinity, globalDayMicro: Infinity };
        const conversationUsed = this.usage.filter((r) => r.conversationId === input.conversationId).reduce((s, r) => s + (r.settled ? r.cost : r.reserved), 0);
        if (conversationUsed + input.estimateUsdMicro > caps.conversationMicro) {
          return { ok: false, exceeded: 'conversation', usedMicro: conversationUsed, capMicro: caps.conversationMicro };
        }
        const used = this.spend();
        if (used + input.estimateUsdMicro > caps.adminDayMicro) return { ok: false, exceeded: 'admin_day', usedMicro: used, capMicro: caps.adminDayMicro };
        const usageId = `44444444-4444-4444-8444-${UUID_TAIL(this.nextUsage++)}`;
        this.usage.push({ id: usageId, conversationId: input.conversationId, reserved: input.estimateUsdMicro, cost: 0, settled: false });
        return { ok: true, usageId };
      },
      settleUsage: async (_adminId, usageId, settlement: UsageSettlement) => {
        const row = this.usage.find((r) => r.id === usageId);
        if (!row) throw new AdminAgentStoreError('agent_harness_error', undefined, { reason: 'usage_not_found' });
        if (row.settled) return false;
        row.settled = true;
        row.cost = settlement.costUsdMicro;
        return true;
      },
      releaseUsage: async (adminId, usageId, reason) => {
        const none: UsageMeters = { inputTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
        return this.store.usage.settleUsage(adminId, usageId, { ...none, costUsdMicro: 0, stopReason: reason ?? 'not_called' });
      },
      getSpend: async (_adminId, conversationId) => ({
        conversationMicro: conversationId === undefined ? null : this.usage.filter((r) => r.conversationId === conversationId).reduce((s, r) => s + (r.settled ? r.cost : r.reserved), 0),
        adminDayMicro: this.spend(),
        adminMonthMicro: this.spend(),
        truncated: false,
      }),
    },
    plans: {
      getActivePlan: async () => {
        const plan = this.hooks.plan();
        return plan === null ? null : ({ revision: plan.revision, status: plan.status } as PlanRecord);
      },
    },
    proposals: {
      listPendingProposals: async () => this.hooks.pending(),
    },
    // The plan stage's fixture tools do not stage writes that name ids, so provenance has nothing to prove here.
    refs: {
      recordRefs: async (_adminId, _conversationId, refs) => refs.length,
    },
  };
}
