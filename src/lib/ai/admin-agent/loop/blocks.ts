/**
 * The exact content blocks of the transcript, in the shape the Messages API uses (plan 3.4, "persist exact content blocks").
 *
 * `admin_agent_messages.content` holds these blocks and nothing provider-specific: the AI SDK port converts them to its
 * own message parts and back (`ai-sdk-messages.ts`), so a port on another client reads the stored rows unchanged, and
 * the store's payload guard (which looks for `tool_use` inputs and `tool_result` content) sees the real tool-facing
 * data. Thinking blocks keep their text and signature byte for byte: they are replayed, never edited.
 */
import { z } from 'zod';
import type { Json } from '../store/types';

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Json;
}
/** `content` is the tool result as one JSON string: byte-exact on replay. */
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: true;
}

export type AssistantBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock;
export type UserBlock = TextBlock | ToolResultBlock;

const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue.optional())]),
) as z.ZodType<Json>;

const textBlock = z.object({ type: z.literal('text'), text: z.string() });
const assistantBlock = z.discriminatedUnion('type', [
  textBlock,
  z.object({ type: z.literal('thinking'), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal('redacted_thinking'), data: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string().min(1), name: z.string().min(1), input: jsonValue }),
]);
const toolResultBlock = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string().min(1),
  content: z.string(),
  is_error: z.literal(true).optional(),
});

const assistantBlocks = z.array(assistantBlock).min(1);
const textBlocks = z.array(textBlock).min(1);
const toolResultBlocks = z.array(toolResultBlock).min(1);

/** The stored assistant content as blocks, or `null` when it is not a valid, non-empty block list. */
export function parseAssistantBlocks(content: unknown): AssistantBlock[] | null {
  const parsed = assistantBlocks.safeParse(content);
  return parsed.success ? (parsed.data as AssistantBlock[]) : null;
}

/** The stored admin or event content as text blocks, or `null`. A plain string is read as one text block. */
export function parseTextBlocks(content: unknown): TextBlock[] | null {
  if (typeof content === 'string') return content === '' ? null : [{ type: 'text', text: content }];
  const parsed = textBlocks.safeParse(content);
  return parsed.success ? (parsed.data as TextBlock[]) : null;
}

/** The stored tool results as blocks, or `null`. */
export function parseToolResultBlocks(content: unknown): ToolResultBlock[] | null {
  const parsed = toolResultBlocks.safeParse(content);
  return parsed.success ? (parsed.data as ToolResultBlock[]) : null;
}

/** The tool calls of an assistant message, in order. */
export function toolUsesOf(blocks: readonly AssistantBlock[]): ToolUseBlock[] {
  return blocks.filter((block): block is ToolUseBlock => block.type === 'tool_use');
}

/** The text of an assistant message (its text blocks joined; thinking excluded). */
export function textOf(blocks: readonly AssistantBlock[]): string {
  return blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/** `value` as plain JSON (no `undefined`, no class instances): what the `jsonb` columns hold. */
export function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? null)) as Json;
}
