/**
 * The stream (plan 5.7, spec §18.5 "Stream events"): server-sent events whose `data:` line is one JSON object with a
 * `type`, the shape the repo's other streaming routes use. Events carry data, never HTML, and `error` always carries a
 * catalogued code.
 *
 * Spike S7: the loop never observes the client connection. `createEventStream` therefore hands the loop a sink that
 * stops writing once the reader has gone and otherwise never throws, and the stream's `cancel` only marks it closed; it
 * does not stop any work.
 */
import type { AgentStreamEvent, EventSink } from './types';

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** One event as its wire text. */
export function encodeSseEvent(event: AgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface EventStream {
  stream: ReadableStream<Uint8Array>;
  /** Writes an event unless the stream is closed. Never throws. */
  emit: EventSink;
  /** Ends the stream (idempotent). */
  close(): void;
  /** Whether the reader has gone or `close` ran. */
  readonly closed: boolean;
}

export function createEventStream(): EventStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      // The client went away. The turn keeps running and keeps persisting; it just has nobody to tell.
      closed = true;
      controller = null;
    },
  });

  const emit: EventSink = (event) => {
    if (closed || controller === null) return;
    try {
      controller.enqueue(encoder.encode(encodeSseEvent(event)));
    } catch {
      closed = true;
      controller = null;
    }
  };

  return {
    stream,
    emit,
    close() {
      if (closed) return;
      closed = true;
      const c = controller;
      controller = null;
      try {
        c?.close();
      } catch {
        // already closed by the reader
      }
    },
    get closed() {
      return closed;
    },
  };
}

/** Wraps a sink so a throwing consumer can never reach the loop. */
export function safeSink(sink: EventSink | undefined): EventSink {
  return (event) => {
    if (!sink) return;
    try {
      sink(event);
    } catch {
      // A closed connection or a buggy consumer: the work goes on.
    }
  };
}
