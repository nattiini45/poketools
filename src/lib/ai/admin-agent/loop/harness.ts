/**
 * Harness events (plan 3.4, 4.5, 6.3 items 3 and 5): the only channel through which the model learns an approval, a
 * decline, a build outcome, a deadline or a refreshed piece of server state.
 *
 * A harness event is a persisted `system` message (`kind: 'harness_event'`). Its content is one text block, the exact
 * text the model reads; `ui` carries the structured form (`{ event, data }`) for the UI and for the loop's own checks
 * (the unconsumed-event rule, the state-refresh hash). The text always starts with the marker `[harness_event]`. Nothing
 * outside server code can produce that marker: admin text, stored text (`registry/fence.ts`) and tool output are all
 * stripped of it before they reach the model, and the frozen system prompt tells the model to trust it only as the first
 * line of a server message.
 */
import { stripHiddenChars } from '@/lib/utils/hidden-text';
import type { Json, MessageRecord, NewMessage } from '../store/types';
import { parseTextBlocks } from './blocks';

export const HARNESS_MARKER = '[harness_event]';

/** The loop's own events. The approve and decline routes add theirs (`proposal_approved`, ...) through `harnessEventMessage`. */
export const LOOP_EVENTS = {
  /** The 240 s wall clock ran out between steps: the turn is resumable. */
  turnDeadline: 'turn_deadline',
  /** The step or tool-call cap of a turn was reached: the turn is resumable. */
  turnLimit: 'turn_limit',
  /** The turn stopped on a failure (model unavailable, budget, refusal): the admin can resume or resend. */
  turnInterrupted: 'turn_interrupted',
  /** Server state the model should know (date, weekday, zone, reply language, Plan revision, pending proposals, drift). */
  stateRefresh: 'state_refresh',
} as const;

export type LoopEventName = (typeof LOOP_EVENTS)[keyof typeof LOOP_EVENTS];

/** Stable, key-sorted JSON: the same data always renders to the same bytes (replay and prompt cache depend on it). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** The text of a harness event: the marker and the name on one line, then the data as stable JSON (omitted when empty). */
export function harnessEventText(event: string, data: Readonly<Record<string, Json | undefined>> = {}): string {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined);
  return keys.length === 0 ? `${HARNESS_MARKER} ${event}` : `${HARNESS_MARKER} ${event}\n${stableStringify(data)}`;
}

/** The `NewMessage` of a harness event, ready for `store.messages.appendMessage`. */
export function harnessEventMessage(event: string, data: Readonly<Record<string, Json | undefined>> = {}): NewMessage {
  const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Record<string, Json>;
  return {
    role: 'system',
    kind: 'harness_event',
    content: [{ type: 'text', text: harnessEventText(event, clean) }],
    ui: { event, data: clean },
  };
}

/** The event name and data of a stored harness-event message (from `ui`; the name falls back to the first text line). */
export function readHarnessEvent(message: Pick<MessageRecord, 'ui' | 'content'>): { event: string; data: Json } | null {
  const ui = message.ui;
  if (typeof ui === 'object' && ui !== null && !Array.isArray(ui) && typeof ui.event === 'string') {
    return { event: ui.event, data: ui.data ?? {} };
  }
  const blocks = parseTextBlocks(message.content);
  const first = blocks?.[0]?.text.split('\n', 1)[0];
  if (first?.startsWith(`${HARNESS_MARKER} `)) return { event: first.slice(HARNESS_MARKER.length + 1).trim(), data: {} };
  return null;
}

/**
 * Whether the transcript ends in a harness event nobody has answered yet: the rule for `{continue: true}` (spec §18.6).
 * An event is consumed once the assistant has replied after it, so only the last message can be unconsumed.
 */
export function hasUnconsumedHarnessEvent(tail: ReadonlyArray<Pick<MessageRecord, 'kind' | 'role'>>): boolean {
  const last = tail[tail.length - 1];
  return last !== undefined && last.kind === 'harness_event';
}

// The same pattern `registry/fence.ts` defuses in stored text.
const MARKER_LOOKALIKE = /harness[\s_-]*event/giu;
const MARKER_PRESENT = /harness[\s_-]*event/iu;

/**
 * Admin-typed text, made safe to store and show the model: the harness marker and any lookalike defused, and the
 * conversation's sentinel (when the sentinel channel is in use) removed. The admin's own words are otherwise left alone (a
 * roster paste keeps its line breaks and an emoji its joiners); invisible characters are removed only from text that hides
 * a marker behind them.
 */
export function neutralizeAdminText(text: string, sentinel?: string): string {
  let out = text.normalize('NFC');
  if (sentinel) out = out.split(sentinel).join('');
  // Hidden characters as the fence strips them, so a marker cannot hide behind a zero-width joiner or a tag character.
  const visible = stripHiddenChars(out);
  if (!MARKER_PRESENT.test(visible)) return out;
  return visible.replace(MARKER_LOOKALIKE, 'harness event');
}
