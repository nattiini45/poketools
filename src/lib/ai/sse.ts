/**
 * Transport helpers for the streamed AI generators (`api/ai/**`).
 *
 * Writing to a response stream the browser has already dropped throws. Persistence must never
 * depend on that: a generation that is stored as completed has to stay completed, whether or not
 * anyone is still listening. Every frame therefore goes through `send()`, which reports a closed
 * stream as `false` instead of throwing, and `close()` is idempotent.
 */
export interface SafeSseSender {
  /** Enqueue one `data:` frame. Returns false when the stream is closed or errored. */
  send(payload: string | Record<string, unknown>): boolean;
  /** Close the stream; a second call, or a close after the client left, is a no-op. */
  close(): void;
}

export function createSafeSseSender(controller: ReadableStreamDefaultController<Uint8Array>): SafeSseSender {
  const encoder = new TextEncoder();
  let closed = false;

  return {
    send(payload) {
      if (closed) return false;
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
      try {
        controller.enqueue(encoder.encode(`data: ${body}\n\n`));
        return true;
      } catch {
        // The client disconnected; nothing left to tell it.
        closed = true;
        return false;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed or errored */
      }
    },
  };
}
