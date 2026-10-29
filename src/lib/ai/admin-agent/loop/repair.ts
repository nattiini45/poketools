/**
 * Keeping the history valid when something other than the loop appends to it (plan 3.4, 4.5).
 *
 * A crash or a platform kill between an assistant message and its tool results leaves a trailing assistant message whose
 * `tool_use` calls nobody answered. The next turn answers them with `unknown_outcome` before it appends anything. Anything
 * else that appends first (a decline, an approval, a resume: they add a harness event) would put a message between a
 * `tool_use` and its results, and the append-only triggers forbid repairing that afterwards: every later turn would be
 * refused as a bad history. `appendHarnessEvent` therefore answers the dangling calls first, then writes the event.
 *
 * The caller holds the conversation's turn lease (no loop is mid-step while a harness event is appended).
 */
import type { AdminAgentStore } from '../store/create';
import type { AdminId } from '../store/ids';
import type { Json, NewMessage } from '../store/types';
import { parseAssistantBlocks, toJson, toolUsesOf, type ToolUseBlock } from './blocks';
import { harnessEventMessage } from './harness';
import { failureResult, toolResultBlock } from './tool-results';

/** The tool-results message that answers calls nobody ran to completion with `unknown_outcome` (never `ok`). */
export function danglingRepairMessage(uses: readonly ToolUseBlock[]): NewMessage {
  const serialized = failureResult('unknown_outcome');
  return {
    role: 'user',
    kind: 'tool_results',
    content: toJson(uses.map((use) => toolResultBlock(use.id, serialized))),
    ui: { repaired: true, results: uses.map((use) => ({ tool_use_id: use.id, name: use.name, ok: false, code: 'unknown_outcome' })) } as Json,
  };
}

type EventStore = { messages: Pick<AdminAgentStore['messages'], 'loadTail' | 'appendMessage'> };

/** The calls of the conversation's last message when it is an assistant message that still waits for its results. */
export async function danglingToolUsesOf(store: EventStore, adminId: AdminId, conversationId: string): Promise<ToolUseBlock[]> {
  const [last] = await store.messages.loadTail(adminId, conversationId, 1);
  if (last === undefined || last.role !== 'assistant' || last.kind !== 'chat' || last.content === null) return [];
  const blocks = parseAssistantBlocks(last.content);
  return blocks === null ? [] : toolUsesOf(blocks);
}

/**
 * Appends a harness event (`proposal_declined`, `proposal_approved`, ...) to a conversation, after answering any tool
 * calls its last message left dangling. Under the turn lease only.
 */
export async function appendHarnessEvent(
  store: EventStore,
  adminId: AdminId,
  conversationId: string,
  event: string,
  data: Readonly<Record<string, Json | undefined>> = {},
): Promise<void> {
  const dangling = await danglingToolUsesOf(store, adminId, conversationId);
  if (dangling.length > 0) await store.messages.appendMessage(adminId, conversationId, danglingRepairMessage(dangling));
  await store.messages.appendMessage(adminId, conversationId, harnessEventMessage(event, data));
}
