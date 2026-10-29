/**
 * History rebuild (plan 3.4: "history is loaded by conversation id after `admin_id` equality; the browser sends only new
 * text and ids"). The stored rows become a provider-neutral transcript; nothing the browser sent is ever in it.
 *
 * Rules the Messages API enforces, checked here before a request is built, because the append-only trigger forbids
 * repairing a bad history afterwards:
 *  - every assistant `tool_use` is answered by the very next message, with exactly its ids;
 *  - nothing else sits between a `tool_use` and its results.
 * The one case a crash can leave is an assistant message whose results were never written: `danglingToolUses` finds it
 * and the turn start answers it with `unknown_outcome` results before anything else is appended.
 */
import type { MessageRecord } from '../store/types';
import { AdminAgentLoopError, loopCode } from './codes';
import {
  parseAssistantBlocks,
  parseTextBlocks,
  parseToolResultBlocks,
  toolUsesOf,
  type AssistantBlock,
  type TextBlock,
  type ToolResultBlock,
  type ToolUseBlock,
} from './blocks';
import { readHarnessEvent } from './harness';

export type TranscriptEntry =
  | { role: 'user'; kind: 'chat'; seq: number; blocks: TextBlock[] }
  | { role: 'assistant'; kind: 'chat'; seq: number; blocks: AssistantBlock[] }
  | { role: 'user'; kind: 'tool_results'; seq: number; blocks: ToolResultBlock[] }
  | { role: 'event'; kind: 'harness_event'; seq: number; event: string; text: string; data: unknown };

function badHistory(seq: number, why: string): never {
  throw new AdminAgentLoopError('agent_harness_error', `bad_history:${why}`, { seq });
}

/** One stored message as a transcript entry. A purged or malformed row throws `agent_harness_error` (reason `bad_history`). */
export function entryOf(message: MessageRecord): TranscriptEntry {
  const { seq, role, kind } = message;
  // Content purged after the retention window (idle conversations): not a fault, the conversation is just too old to continue.
  if (message.content === null || message.content_purged_at) throw new AdminAgentLoopError(loopCode('outdated'), 'bad_history:purged');
  if (kind === 'chat' && role === 'user') {
    const blocks = parseTextBlocks(message.content);
    return blocks ? { role: 'user', kind: 'chat', seq, blocks } : badHistory(seq, 'user_content');
  }
  if (kind === 'chat' && role === 'assistant') {
    const blocks = parseAssistantBlocks(message.content);
    return blocks ? { role: 'assistant', kind: 'chat', seq, blocks } : badHistory(seq, 'assistant_content');
  }
  if (kind === 'tool_results' && role === 'user') {
    const blocks = parseToolResultBlocks(message.content);
    return blocks ? { role: 'user', kind: 'tool_results', seq, blocks } : badHistory(seq, 'tool_results_content');
  }
  if (kind === 'harness_event' && role === 'system') {
    const blocks = parseTextBlocks(message.content);
    const event = readHarnessEvent(message);
    if (!blocks || !event) return badHistory(seq, 'event_content');
    return { role: 'event', kind: 'harness_event', seq, event: event.event, text: blocks.map((b) => b.text).join(''), data: event.data };
  }
  return badHistory(seq, 'role_kind');
}

/** The stored messages (any order) as a transcript in `seq` order. */
export function rebuildTranscript(messages: readonly MessageRecord[]): TranscriptEntry[] {
  return [...messages].sort((a, b) => a.seq - b.seq).map(entryOf);
}

/**
 * The tool calls of the last assistant message that have no results yet: empty when the transcript is sound. Anything
 * other than "assistant message with tool calls at the very end" is either fine (a complete pair) or corrupt.
 */
export function danglingToolUses(entries: readonly TranscriptEntry[]): ToolUseBlock[] {
  const last = entries[entries.length - 1];
  return last?.role === 'assistant' ? toolUsesOf(last.blocks) : [];
}

/** Checks the pairing rule over the whole transcript. Returns the `seq` of the first offending message, or `null`. */
export function firstPairingViolation(entries: readonly TranscriptEntry[]): number | null {
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.role === 'assistant') {
      const uses = toolUsesOf(entry.blocks);
      const next = entries[i + 1];
      if (uses.length === 0) {
        if (next?.role === 'user' && next.kind === 'tool_results') return next.seq;
        continue;
      }
      // The very last message may be dangling; the turn start repairs it.
      if (next === undefined) continue;
      if (next.role !== 'user' || next.kind !== 'tool_results') return next.seq;
      const wanted = new Set(uses.map((use) => use.id));
      const got = next.blocks.map((block) => block.tool_use_id);
      if (got.length !== wanted.size || got.some((id) => !wanted.has(id)) || new Set(got).size !== got.length) return next.seq;
    } else if (entry.role === 'user' && entry.kind === 'tool_results') {
      const before = entries[i - 1];
      if (before?.role !== 'assistant') return entry.seq;
    }
  }
  return null;
}

/** The tool-call id to tool-name map of an assistant message (results are rendered with the name of their call). */
export function toolNamesOf(entry: Extract<TranscriptEntry, { role: 'assistant' }>): Map<string, string> {
  return new Map(toolUsesOf(entry.blocks).map((use) => [use.id, use.name]));
}
