/**
 * Client-side adapter for the agent UI-message stream (PRD §7).
 *
 * The agent routes return `toUIMessageStreamResponse()` — an SSE stream of
 * `data: <UIMessageChunk JSON>` lines (text-delta / error / tool chunks),
 * which is a different protocol from the legacy `{status}` SSE the match cards
 * were built around. This helper distils that stream down to the plain text the
 * cards render: it accumulates `text-delta` chunks, surfaces the first `error`
 * chunk, and tolerates partial lines split across network reads.
 *
 * Browser-only (uses `ReadableStream` / `TextDecoder`); no `ai` import so it
 * stays dependency-light and safe to pull into client components.
 */
export interface AgentStreamResult {
  text: string;
  error: string | null;
  /**
   * The server's `X-Agent-Conversation-Id` header, if present. Multi-turn
   * clients resend this as `conversation_id` so the agent appends to the same
   * persisted conversation instead of forking a fresh one each turn.
   */
  conversationId: string | null;
}

export async function streamAgentText(
  response: Response,
  onText?: (full: string) => void,
): Promise<AgentStreamResult> {
  if (!response.body) {
    throw new Error('No response body');
  }

  const conversationId = response.headers.get('X-Agent-Conversation-Id');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let error: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // Keep the last (possibly partial) line in the buffer until the next read.
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const chunk = JSON.parse(data) as { type?: string; delta?: unknown; errorText?: unknown };
        if (chunk.type === 'text-delta' && typeof chunk.delta === 'string') {
          text += chunk.delta;
          onText?.(text);
        } else if (chunk.type === 'error' && typeof chunk.errorText === 'string') {
          error = chunk.errorText;
        }
      } catch {
        /* ignore keep-alive / non-JSON lines */
      }
    }
  }

  return { text, error, conversationId };
}
