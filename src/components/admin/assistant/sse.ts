/**
 * Reads the chat route's server-sent events (spec §18.5 "Stream events"). Each frame is `data: <one JSON object>`; frames
 * end at a blank line and may be split across network reads. A frame that is not JSON, or not one of the known event
 * shapes, is dropped: the stream carries data for the UI, never instructions.
 */
import type { AgentEvent } from './types';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Narrows a parsed frame to an event the UI knows, checking the fields it reads. */
export function asAgentEvent(value: unknown): AgentEvent | null {
  if (!isObject(value) || !isString(value.type)) return null;
  switch (value.type) {
    case 'text.delta':
      return isNumber(value.step) && isString(value.delta) ? (value as AgentEvent) : null;
    case 'tool.start':
      return isString(value.id) && isString(value.name) ? (value as AgentEvent) : null;
    case 'tool.end':
      return isString(value.id) && isString(value.name) && typeof value.ok === 'boolean' ? (value as AgentEvent) : null;
    case 'card':
      return isString(value.kind) && isString(value.ref) ? (value as AgentEvent) : null;
    case 'plan.updated':
      return isNumber(value.revision) ? (value as AgentEvent) : null;
    case 'proposal':
      return isString(value.id) && isString(value.hash) ? (value as AgentEvent) : null;
    case 'action.updated':
      return isString(value.id) && isString(value.status) ? (value as AgentEvent) : null;
    case 'usage':
      return isNumber(value.cost_usd_micro) && typeof value.warn === 'boolean' ? (value as AgentEvent) : null;
    case 'error':
      return isString(value.code) ? (value as AgentEvent) : null;
    case 'done':
      return isString(value.reason) && typeof value.resumable === 'boolean' ? (value as AgentEvent) : null;
    default:
      return null;
  }
}

export interface SseParser {
  push(chunk: string): void;
  /** Flushes a final frame that had no closing blank line. */
  end(): void;
}

export function createSseParser(onEvent: (event: AgentEvent) => void): SseParser {
  let buffer = '';

  const frame = (text: string): void => {
    const data = text
      .split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data === '') return;
    // A frame that does not parse, or parses into no known event, is skipped, but not silently: a lost `done` or `error`
    // frame must at least show in the console. Only the parse is guarded: a throw in the handler is the caller's own bug.
    let event: AgentEvent | null;
    try {
      event = asAgentEvent(JSON.parse(data));
    } catch (error) {
      console.warn('[assistant] dropped a malformed stream frame', error);
      return;
    }
    if (event === null) {
      console.warn('[assistant] dropped an unrecognised stream frame', data.slice(0, 200));
      return;
    }
    onEvent(event);
  };

  return {
    push(chunk) {
      buffer += chunk;
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        frame(buffer.slice(0, boundary));
        const rest = buffer.slice(boundary);
        buffer = rest.replace(/^\r?\n\r?\n/, '');
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    },
    end() {
      if (buffer.trim() !== '') frame(buffer);
      buffer = '';
    },
  };
}

/** Reads a response body to its end, calling `onEvent` for every event. Throws if the read itself fails. */
export async function readAgentStream(response: Response, onEvent: (event: AgentEvent) => void): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}
