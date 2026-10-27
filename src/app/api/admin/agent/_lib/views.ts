/**
 * Projections from the store's rows to what the routes send (spec §18.5). Each one is an allow-list: a column that is
 * not named here (the model and effort, the version hashes, the blast counters, `turn_lease_until`, the admin's name,
 * thinking blocks, tool inputs, approval fingerprints) never reaches the browser. Message text is the admin's own words
 * and the assistant's own prose; every other label is a key the UI translates.
 */
import type {
  ConversationDetail,
  ConversationSeed,
  ConversationSummary,
  ProposalStatusValue,
  ProposalSummaryView,
  TranscriptItem,
} from '@/components/admin/assistant/types';
import { CLARIFICATION_KINDS, SEED_AREAS, SEED_KEYS, SEED_TABS, type ClarificationView } from '@/components/admin/assistant/types';
import type { AdminAgentConfig } from '@/lib/ai/admin-agent/env';
import { parseTextBlocks, parseToolResultBlocks } from '@/lib/ai/admin-agent/loop/blocks';
import { LOOP_EVENTS, readHarnessEvent } from '@/lib/ai/admin-agent/loop/harness';
import type { ToolRole } from '@/lib/ai/admin-agent/registry';
import type { ConversationRecord, Json, MessageRecord, ProposalSummary } from '@/lib/ai/admin-agent/store/types';
import { isValidUuid } from '@/lib/utils/uuid';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored seed, re-validated: only the whitelisted keys and uuid ids survive, whatever the column holds. */
export function readSeed(context: Json): ConversationSeed | null {
  if (!isObject(context)) return null;
  const { area, seed, entity, tab } = context;
  if (typeof area !== 'string' || !(SEED_AREAS as readonly string[]).includes(area)) return null;
  const out: ConversationSeed = { area: area as ConversationSeed['area'] };
  if (typeof seed === 'string' && (SEED_KEYS as readonly string[]).includes(seed)) out.seed = seed as ConversationSeed['seed'];
  if (typeof entity === 'string' && isValidUuid(entity)) out.entity = entity.toLowerCase();
  if (typeof tab === 'string' && (SEED_TABS as readonly string[]).includes(tab)) out.tab = tab as ConversationSeed['tab'];
  return out;
}

export function toConversationSummary(row: ConversationRecord, role: ToolRole, now: Date): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status === 'archived' ? 'archived' : 'active',
    // A tier change away from the conversation's tool set makes it read-only: start a new one (plan 4.6).
    readOnly: row.tool_set !== role,
    busy: row.turn_lease_until !== null && new Date(row.turn_lease_until).getTime() > now.getTime(),
    context: readSeed(row.context),
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    version: row.version,
  };
}

const EVENT_NAME = /^[a-z][a-z0-9_]{0,48}$/;
/** Events the transcript does not show: the model's own bookkeeping. */
const HIDDEN_EVENTS: ReadonlySet<string> = new Set([LOOP_EVENTS.stateRefresh]);

function textOfMessage(message: MessageRecord): string | null {
  if (message.content === null) return null;
  const blocks = parseTextBlocks(message.content);
  return blocks === null ? '' : blocks.map((block) => block.text).join('\n');
}

/** An assistant message's prose: its UI projection, else its stored text blocks. `null` when the content was purged. */
function assistantTextOf(message: MessageRecord): string | null {
  const ui = message.ui;
  if (isObject(ui) && typeof ui.text === 'string') return ui.text;
  if (message.content === null) return null;
  const blocks = Array.isArray(message.content) ? message.content : [];
  return blocks
    .filter((block): block is { type: 'text'; text: string } => isObject(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

function toolCallsOf(message: MessageRecord): Array<{ id: string; name: string }> {
  const calls: Array<{ id: string; name: string }> = [];
  const fromUi = isObject(message.ui) && Array.isArray(message.ui.tool_calls) ? message.ui.tool_calls : null;
  const stored: unknown[] = Array.isArray(message.content) ? message.content.filter((block) => isObject(block) && block.type === 'tool_use') : [];
  for (const call of fromUi ?? stored) {
    if (isObject(call) && typeof call.id === 'string' && typeof call.name === 'string') calls.push({ id: call.id, name: call.name });
  }
  return calls;
}

interface ToolResultView {
  id: string;
  ok: boolean;
  code: string | null;
  proposalId: string | null;
  clarification: ClarificationView | null;
}

const CLARIFICATION_TEXT_MAX = 300;
const CLARIFICATION_OPTIONS_MAX = 12;

/** The structured question of a `request_clarification` result, re-validated: bounded plain strings and a known kind only. */
export function readClarification(ui: unknown): ClarificationView | null {
  const raw = isObject(ui) ? ui.clarification : undefined;
  if (!isObject(raw) || typeof raw.question !== 'string' || raw.question.trim() === '') return null;
  if (typeof raw.kind !== 'string' || !(CLARIFICATION_KINDS as readonly string[]).includes(raw.kind)) return null;
  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((option): option is { value: string; label: string } => isObject(option) && typeof option.value === 'string' && typeof option.label === 'string')
        .slice(0, CLARIFICATION_OPTIONS_MAX)
        .map((option) => ({ value: option.value.slice(0, 60), label: option.label.slice(0, 80) }))
    : [];
  return { kind: raw.kind as ClarificationView['kind'], question: raw.question.slice(0, CLARIFICATION_TEXT_MAX), options };
}

/** The result entries of a tool-results message: from its UI projection, else from the stored result blocks. */
function resultsOf(message: MessageRecord): ToolResultView[] {
  const out: ToolResultView[] = [];
  const results = isObject(message.ui) && Array.isArray(message.ui.results) ? message.ui.results : null;
  if (results !== null) {
    for (const entry of results) {
      if (!isObject(entry) || typeof entry.tool_use_id !== 'string') continue;
      // The staged-tool runner sets `ui: { proposal_id }` on a result that staged a proposal; the id is re-checked here.
      const detail = isObject(entry.ui) ? entry.ui : null;
      const proposalId = detail !== null && typeof detail.proposal_id === 'string' && isValidUuid(detail.proposal_id) ? detail.proposal_id.toLowerCase() : null;
      out.push({ id: entry.tool_use_id, ok: entry.ok === true, code: typeof entry.code === 'string' ? entry.code : null, proposalId, clarification: readClarification(detail) });
    }
    return out;
  }
  for (const block of parseToolResultBlocks(message.content) ?? []) {
    out.push({ id: block.tool_use_id, ok: block.is_error !== true, code: null, proposalId: null, clarification: null });
  }
  return out;
}

/**
 * The transcript the UI renders: the admin's messages, the assistant's prose, one compact status line per tool call and
 * the handful of harness events an admin should see. Rows come in `seq` order.
 */
export function projectTranscript(messages: readonly MessageRecord[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, Extract<TranscriptItem, { type: 'tool' }>>();
  for (const message of messages) {
    if (message.kind === 'harness_event') {
      const event = readHarnessEvent(message);
      if (event === null || !EVENT_NAME.test(event.event) || HIDDEN_EVENTS.has(event.event)) continue;
      const data = isObject(event.data) ? event.data : {};
      const proposalId = typeof data.proposal_id === 'string' && isValidUuid(data.proposal_id) ? data.proposal_id.toLowerCase() : null;
      items.push({ type: 'event', seq: message.seq, at: message.created_at, event: event.event, proposalId });
    } else if (message.kind === 'tool_results') {
      for (const result of resultsOf(message)) {
        const tool = tools.get(result.id);
        if (tool === undefined) continue;
        tool.status = result.ok ? 'ok' : 'failed';
        tool.code = result.code;
        tool.proposalId = result.proposalId;
        if (result.clarification !== null) tool.clarification = result.clarification;
      }
    } else if (message.role === 'user') {
      items.push({ type: 'user', seq: message.seq, at: message.created_at, text: textOfMessage(message) });
    } else if (message.role === 'assistant') {
      const text = assistantTextOf(message);
      if (text === null || text.trim() !== '') items.push({ type: 'assistant', seq: message.seq, at: message.created_at, text });
      for (const call of toolCallsOf(message)) {
        const item: Extract<TranscriptItem, { type: 'tool' }> = {
          type: 'tool',
          seq: message.seq,
          id: call.id,
          name: call.name,
          status: 'pending',
          code: null,
          proposalId: null,
        };
        tools.set(call.id, item);
        items.push(item);
      }
    }
  }
  return items;
}

/** Whether the last message is a harness event nobody has answered (the rule for `{ continue: true }`). */
export function awaitsContinue(messages: readonly Pick<MessageRecord, 'kind'>[]): boolean {
  return messages.length > 0 && messages[messages.length - 1].kind === 'harness_event';
}

export function toProposalSummaryView(row: ProposalSummary, now: Date): ProposalSummaryView {
  const status = row.status as ProposalStatusValue;
  const expired = status === 'proposed' && new Date(row.expires_at).getTime() <= now.getTime();
  return {
    id: row.id,
    kind: row.kind as ProposalSummaryView['kind'],
    class: row.class === 'G' ? 'G' : 'B',
    status,
    effectiveStatus: expired ? 'expired' : status,
    planCode: row.proposal_hash.slice(0, 8),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function toLimits(config: AdminAgentConfig): ConversationDetail['limits'] {
  return {
    maxTextChars: config.limits.maxTextChars,
    conversationCapMicro: config.budgets.conversationMicro,
    conversationWarnMicro: config.budgets.conversationWarnMicro,
  };
}

/** The approve route executes from phase 1, and the executor does not exist in phase 0, so the UI offers no Approve yet. */
export function toCapabilities(config: AdminAgentConfig): ConversationDetail['capabilities'] {
  return { approve: false, maxPhase: config.maxPhase };
}
