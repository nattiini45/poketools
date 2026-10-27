/**
 * Server state the model needs but must not see in the frozen prefix (plan 3.4 "Caching", 5.6): today's date and
 * weekday, the viewer's zone, the reply language, the Plan revision, the proposals waiting for the admin and the drift
 * list. The prompt-cache prefix (tools, system prompt) holds none of it.
 *
 * It is composed from server data only (enums, integers, ids, ISO times, short codes), never from stored free text. The
 * loop persists it as a `state_refresh` harness event when it differs from the last one in the transcript, so every
 * request replays exactly what the model saw (thinking blocks are bound to the prefix they were produced under: text
 * injected into one request and absent from the next would break that binding).
 */
import { createHash } from 'node:crypto';
import type { Json } from '../store/types';
import { stableStringify } from './harness';
import type { Locale } from './types';

export interface DynamicState {
  /** `YYYY-MM-DD` in `timeZone`. */
  date: string;
  /** English weekday name in `timeZone`. */
  weekday: string;
  timeZone: string;
  replyLanguage: Locale;
  plan: { revision: number; status: string } | null;
  pendingProposals: ReadonlyArray<{ id: string; kind: string; tier: string; expiresAt: string }>;
  drift: readonly string[];
}

const FALLBACK_ZONE = 'Europe/Berlin';
const MAX_PENDING = 10;
const MAX_DRIFT = 20;

function validZone(zone: string): string {
  try {
    // i18n-ignore: the state is read by the model, not shown to a viewer; it is English whatever the UI language
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_ZONE;
  }
}

/** The date and the English weekday of `now` in `zone` (`Intl`, no locale of the viewer involved). */
export function localDate(now: Date, zone: string): { date: string; weekday: string; timeZone: string } {
  const timeZone = validZone(zone);
  // i18n-ignore: the state is read by the model, not shown to a viewer; it is English whatever the UI language
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday'), timeZone };
}

export interface StateInputs {
  now: Date;
  timeZone: string;
  locale: Locale;
  plan: { revision: number; status: string } | null;
  pending: ReadonlyArray<{ id: string; kind: string; class: string; expires_at: string }>;
  drift?: readonly string[];
}

export function composeDynamicState(input: StateInputs): DynamicState {
  const { date, weekday, timeZone } = localDate(input.now, input.timeZone);
  return {
    date,
    weekday,
    timeZone,
    replyLanguage: input.locale,
    plan: input.plan,
    pendingProposals: [...input.pending]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, MAX_PENDING)
      .map((p) => ({ id: p.id, kind: p.kind, tier: p.class, expiresAt: p.expires_at })),
    drift: [...(input.drift ?? [])].slice(0, MAX_DRIFT),
  };
}

/** The state as event data (`Json`), with a hash of itself so the loop can tell whether it changed. */
export function stateData(state: DynamicState): Record<string, Json> {
  const body = {
    date: state.date,
    weekday: state.weekday,
    time_zone: state.timeZone,
    reply_language: state.replyLanguage,
    plan: state.plan ? { revision: state.plan.revision, status: state.plan.status } : null,
    pending_proposals: state.pendingProposals.map((p) => ({ id: p.id, kind: p.kind, tier: p.tier, expires_at: p.expiresAt })),
    drift: [...state.drift],
  };
  const hash = createHash('sha256').update(stableStringify(body)).digest('hex').slice(0, 16);
  return { ...body, hash } as Record<string, Json>;
}

/** The hash a stored `state_refresh` event carries, or `null` for any other data. */
export function storedStateHash(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    const hash = (data as Record<string, unknown>).hash;
    if (typeof hash === 'string') return hash;
  }
  return null;
}
