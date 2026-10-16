'use client';

import type { ReactNode } from 'react';
import { splitBoldSegments, type ChatMessage } from './agentChat';

/**
 * Shared chat-thread rendering for the agent UIs (PRD Phase 5). Both the
 * homepage `AgentChatWidget` and the teambuilder `AiChatPanel` render the same
 * bubble list + streaming/“thinking” indicator through this component; only the
 * surrounding chrome (scroll container, composer, branding) differs.
 *
 * Renders ONLY the bubble list — the parent owns the scroll container so each
 * surface can size it to fit. Assistant bubbles may carry an extra action row
 * (e.g. the teambuilder “Apply to slot” affordance) via `renderAssistantActions`.
 */

/** Assistant text with markdown-lite line breaks + `**bold**` (no raw HTML). */
export function AssistantText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i} className="block min-h-[1.2em]">
          {splitBoldSegments(line).map((seg, j) =>
            seg.bold ? (
              <strong key={j} className="font-semibold text-poke-text-primary">
                {seg.text}
              </strong>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )}
        </span>
      ))}
    </>
  );
}

interface AgentChatThreadProps {
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  /** Copy shown next to the spinner while the first tokens are pending. */
  thinkingLabel: string;
  /** Optional action row rendered under each completed assistant bubble. */
  renderAssistantActions?: (message: ChatMessage, index: number) => ReactNode;
}

export default function AgentChatThread({
  messages,
  streaming,
  streamingText,
  thinkingLabel,
  renderAssistantActions,
}: AgentChatThreadProps) {
  return (
    <>
      {messages.map((m, i) => (
        <div
          key={i}
          className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
        >
          <div
            className={
              m.role === 'user'
                ? 'max-w-[85%] rounded-poke-md bg-poke-blue/15 px-3 py-2 text-sm text-poke-text-primary whitespace-pre-wrap'
                : 'max-w-[85%] rounded-poke-md bg-poke-surface border border-poke-border px-3 py-2 text-sm text-poke-text-secondary leading-relaxed'
            }
          >
            {m.role === 'assistant' ? <AssistantText text={m.content} /> : m.content}
            {m.role === 'assistant' && renderAssistantActions?.(m, i)}
          </div>
        </div>
      ))}

      {streaming && (
        <div className="flex justify-start">
          <div className="max-w-[85%] rounded-poke-md bg-poke-surface border border-poke-border px-3 py-2 text-sm text-poke-text-secondary leading-relaxed">
            {streamingText ? (
              <AssistantText text={streamingText} />
            ) : (
              <span className="inline-flex items-center gap-2 text-poke-text-muted">
                <span className="w-3 h-3 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
                {thinkingLabel}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
