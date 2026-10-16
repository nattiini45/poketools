/**
 * Pure helpers for the homepage Professor Linden chat widget (PRD Phase 5).
 *
 * Kept dependency-light and free of React/DOM so the request-shaping, error
 * mapping, and markdown-lite parsing can be unit-tested in the node vitest
 * environment (the widget itself renders these in JSX). The actual streaming is
 * handled by `streamAgentText` from `@/lib/ai/agent/client-stream`.
 *
 * Error copy lives in the `agent` namespace (`agent.errors.*`). Components
 * store the key from `chatErrorKeyForStatus` and translate at render; the
 * English constants below stay for callers that still show English text.
 */
import { agentMessages } from '@/i18n/messages/agent';
import type agentEn from '@/i18n/messages/agent/en';

/** The teambuilding persona drives the homepage widget (PRD §4). */
export const LINDEN_PERSONA = 'linden_teambuilding' as const;

/** A key of `agent.errors`. */
export type AgentChatErrorKey = keyof typeof agentEn.errors;

/** Friendly copy for the per-player daily limit (chat route returns 429). English; see `agent.errors.rateLimited`. */
export const RATE_LIMIT_MESSAGE: string = agentMessages.en.errors.rateLimited;

/** Shown when the user somehow hits the route while signed out. English; see `agent.errors.signInRequired`. */
export const AUTH_ERROR_MESSAGE: string = agentMessages.en.errors.signInRequired;

/** Generic fallback so no server internals ever surface to the client. English; see `agent.errors.unavailable`. */
export const GENERIC_ERROR_MESSAGE: string = agentMessages.en.errors.unavailable;

/** A single turn in the client-side conversation thread. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Optional teambuilding context the chat route forwards to the context pack. */
export interface ChatContext {
  format?: string;
  team_id?: string;
  /** Active league ruleset id (plan mode) — agent builds within league rules. */
  ruleset_id?: string;
  /** Upcoming match id (plan mode) — lets the server resolve the player's core. */
  upcoming_match_id?: string;
}

export interface BuildChatBodyOptions {
  /** Continuation id captured from the prior turn's `X-Agent-Conversation-Id`. */
  conversationId?: string | null;
  /** Editor-derived context (format / open team) for the teambuilder panel. */
  context?: ChatContext;
}

/**
 * Build the `POST /api/ai/agent/chat` body. The full thread is replayed each
 * turn for context; once the first turn returns a `conversation_id` (via the
 * `X-Agent-Conversation-Id` response header) the client resends it so the agent
 * appends to the SAME persisted row instead of forking a new one each turn.
 */
export function buildChatBody(
  messages: ChatMessage[],
  options?: BuildChatBodyOptions,
): {
  messages: ChatMessage[];
  persona: typeof LINDEN_PERSONA;
  conversation_id?: string;
  context?: ChatContext;
} {
  const context = options?.context
    ? Object.fromEntries(
        Object.entries(options.context).filter(([, v]) => v != null && v !== ''),
      )
    : undefined;
  return {
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    persona: LINDEN_PERSONA,
    ...(options?.conversationId ? { conversation_id: options.conversationId } : {}),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
  };
}

/** Map a non-OK chat response status to the `agent.errors` key of its friendly copy. */
export function chatErrorKeyForStatus(status: number): AgentChatErrorKey {
  if (status === 429) return 'rateLimited';
  if (status === 401 || status === 403) return 'signInRequired';
  return 'unavailable';
}

/** Map a non-OK chat response status to safe, friendly user-facing copy (English). */
export function errorMessageForStatus(status: number): string {
  return agentMessages.en.errors[chatErrorKeyForStatus(status)];
}

/** Fingerprint of a Showdown paste body (mirrors the orchestrator's detector). */
const SHOWDOWN_MARKERS = /(Ability:|EVs:|Tera Type:|\s@\s)/;

/**
 * Extract fenced code blocks from an assistant reply whose body looks like a
 * Showdown paste. Used by the teambuilder panel to offer an "Apply to slot"
 * action; the actual parse into typed sets happens server-side via
 * `/api/import-team` (keeps `@pkmn/sets` out of the client bundle).
 */
export function extractShowdownBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fences = text.match(/```[\s\S]*?```/g);
  if (!fences) return blocks;
  for (const block of fences) {
    const inner = block.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    if (inner && SHOWDOWN_MARKERS.test(inner)) blocks.push(inner);
  }
  return blocks;
}

/** A run of assistant text, optionally emphasised (`**bold**`). */
export interface TextSegment {
  text: string;
  bold: boolean;
}

/**
 * Split one line into bold / plain segments on `**` markers — the only inline
 * markdown the assistant bubbles honour. Returned segments are rendered as
 * plain React nodes (`<strong>` / text), never via `dangerouslySetInnerHTML`.
 */
export function splitBoldSegments(line: string): TextSegment[] {
  const parts = line.split('**');
  const segments: TextSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '') continue;
    // Odd indices sit between a pair of `**` markers → emphasised.
    segments.push({ text: parts[i], bold: i % 2 === 1 });
  }
  return segments;
}
