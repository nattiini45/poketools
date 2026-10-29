/**
 * The AI SDK adapter's message conversion (plan 3.4; spikes S2 and S3): everything that depends on how the provider and the
 * SDK want a transcript spelled lives here and in `ai-sdk-port.ts`, behind `ProviderAdapterConfig`.
 *
 *  - `renderTranscript`: the persisted, provider-neutral transcript to AI SDK `ModelMessage[]`. Thinking blocks go back as
 *    `reasoning` parts with their signature, tool calls as `tool-call` parts, tool results as `tool-result` parts whose
 *    output is the stored string (so the bytes the API sees are the bytes that were stored). Harness events follow the
 *    configured channel: a `system` role message (default) or a user message tagged with the conversation's sentinel.
 *  - `blocksOfContent`: the SDK's content parts of a finished step back to the persisted blocks.
 *
 * Pure: no network, no SDK runtime import (types only), so the output shape is unit-tested without a provider.
 */
import type { ModelMessage } from 'ai';
import type { AssistantBlock, ToolUseBlock } from './blocks';
import { toJson } from './blocks';
import { HARNESS_MARKER } from './harness';
import type { ProviderAdapterConfig } from './types';
import type { TranscriptEntry } from './transcript';

export const DEFAULT_ADAPTER: ProviderAdapterConfig = {
  stateChannel: 'system-message',
  systemAnchor: 'auto',
  strictTools: true,
  sendReasoning: true,
  cacheTtl: '1h',
  cacheToolsBreakpoint: true,
  thinkingBlockBinding: 'default',
};

/** The user message a `system-message` channel needs when a system message would directly follow an assistant message. */
export const ANCHOR_TEXT = `${HARNESS_MARKER} resume`;

export interface RenderOptions {
  adapter: ProviderAdapterConfig;
  sentinel: string;
}

/** `[harness_event] name` becomes `[harness_event:<sentinel>] name` on the sentinel channel. */
export function sentinelText(text: string, sentinel: string): string {
  return text.startsWith(HARNESS_MARKER) ? `${HARNESS_MARKER.slice(0, -1)}:${sentinel}]${text.slice(HARNESS_MARKER.length)}` : `[harness_event:${sentinel}] ${text}`;
}

/**
 * The Messages API places two constraints on a mid-conversation `system` message (spike S2 and a live 400,
 * "role system must precede an assistant message or end the array"): it must directly follow a user-role message (a tool
 * result is one), and it must be followed by an assistant message or end the request. So `renderTranscript` never emits a
 * harness event where it sits in the transcript: it holds events back and writes them just before the next assistant
 * entry or at the end, where the previous message is a user-role one. A turn that stopped on a limit leaves its event
 * after the last tool results, and the admin's next message then lands before the event instead of after it.
 */
export function renderTranscript(entries: readonly TranscriptEntry[], options: RenderOptions): ModelMessage[] {
  const out: ModelMessage[] = [];
  let lastAssistantTools = new Map<string, string>();
  const pendingEvents: string[] = [];
  const systemChannel = options.adapter.stateChannel !== 'sentinel-user';

  const flushEvents = (): void => {
    if (pendingEvents.length === 0) return;
    const previous = out[out.length - 1];
    if (options.adapter.systemAnchor === 'auto' && (previous === undefined || previous.role === 'assistant')) {
      out.push({ role: 'user', content: [{ type: 'text', text: ANCHOR_TEXT }] });
    }
    for (const text of pendingEvents) out.push({ role: 'system', content: text });
    pendingEvents.length = 0;
  };

  for (const entry of entries) {
    switch (entry.role) {
      case 'user': {
        if (entry.kind === 'chat') {
          out.push({ role: 'user', content: entry.blocks.map((block) => ({ type: 'text' as const, text: block.text })) });
        } else {
          out.push({
            role: 'tool',
            content: entry.blocks.map((block) => ({
              type: 'tool-result' as const,
              toolCallId: block.tool_use_id,
              toolName: lastAssistantTools.get(block.tool_use_id) ?? 'unknown_tool',
              output: block.is_error ? { type: 'error-text' as const, value: block.content } : { type: 'text' as const, value: block.content },
            })),
          });
        }
        break;
      }
      case 'assistant': {
        flushEvents();
        lastAssistantTools = new Map();
        const parts: Extract<ModelMessage, { role: 'assistant' }>['content'] = [];
        for (const block of entry.blocks) {
          if (block.type === 'text') parts.push({ type: 'text', text: block.text });
          else if (block.type === 'thinking') {
            parts.push({ type: 'reasoning', text: block.thinking, providerOptions: { anthropic: { signature: block.signature } } });
          } else if (block.type === 'redacted_thinking') {
            parts.push({ type: 'reasoning', text: '', providerOptions: { anthropic: { redactedData: block.data } } });
          } else {
            lastAssistantTools.set(block.id, block.name);
            parts.push({ type: 'tool-call', toolCallId: block.id, toolName: block.name, input: block.input });
          }
        }
        out.push({ role: 'assistant', content: parts });
        break;
      }
      case 'event': {
        if (systemChannel) pendingEvents.push(entry.text);
        else out.push({ role: 'user', content: [{ type: 'text', text: sentinelText(entry.text, options.sentinel) }] });
        break;
      }
    }
  }
  flushEvents();
  return out;
}

/** A part of the SDK's step content, as far as the conversion reads it. */
export interface SdkContentPart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  invalid?: boolean;
  providerMetadata?: unknown;
  providerOptions?: unknown;
}

function anthropicMeta(part: SdkContentPart): { signature?: string; redactedData?: string } {
  const sources = [part.providerMetadata, part.providerOptions];
  for (const source of sources) {
    if (typeof source !== 'object' || source === null) continue;
    const anthropic = (source as { anthropic?: unknown }).anthropic;
    if (typeof anthropic === 'object' && anthropic !== null) {
      const { signature, redactedData } = anthropic as { signature?: unknown; redactedData?: unknown };
      return {
        ...(typeof signature === 'string' ? { signature } : {}),
        ...(typeof redactedData === 'string' ? { redactedData } : {}),
      };
    }
  }
  return {};
}

export interface ConvertedContent {
  blocks: AssistantBlock[];
  /** Tool calls whose input the SDK could not parse (kept as an empty input so the history stays valid). */
  invalidToolCallIds: string[];
  /** Thinking parts dropped because they carry no signature and so cannot be replayed. */
  droppedThinking: number;
}

/** The persisted blocks of one step's content parts, in order. Empty text is dropped (the API rejects an empty text block). */
export function blocksOfContent(parts: readonly SdkContentPart[]): ConvertedContent {
  const blocks: AssistantBlock[] = [];
  const invalidToolCallIds: string[] = [];
  let droppedThinking = 0;
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text && part.text.length > 0) blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'reasoning') {
      const meta = anthropicMeta(part);
      if (meta.signature !== undefined) blocks.push({ type: 'thinking', thinking: part.text ?? '', signature: meta.signature });
      else if (meta.redactedData !== undefined) blocks.push({ type: 'redacted_thinking', data: meta.redactedData });
      else droppedThinking += 1;
    } else if (part.type === 'tool-call' && typeof part.toolCallId === 'string' && typeof part.toolName === 'string') {
      const plain = typeof part.input === 'object' && part.input !== null && !Array.isArray(part.input);
      if (part.invalid || !plain) invalidToolCallIds.push(part.toolCallId);
      const block: ToolUseBlock = { type: 'tool_use', id: part.toolCallId, name: part.toolName, input: plain && !part.invalid ? toJson(part.input) : {} };
      blocks.push(block);
    }
  }
  return { blocks, invalidToolCallIds, droppedThinking };
}
