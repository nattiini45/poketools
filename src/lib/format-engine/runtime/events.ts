/**
 * Events of a running format: what happened (a stage started, a round began, a match completed, an action locked, a
 * calendar mark was reached) and the stable key that makes firing it idempotent. A rule's `EventSpec` matches an event
 * when the kinds are equal and every field the spec names agrees; a field the spec leaves out matches anything.
 * Pure and client-safe.
 */
import type { EventSpec } from '@/lib/format-kit/types';

export interface KitEvent {
  event: 'stage_start' | 'stage_end' | 'match_completed' | 'round_start' | 'round_end' | 'action_locked' | 'time';
  /** The stage key the event belongs to. */
  stage?: string;
  /** The round number of a round event, or of the match of `match_completed`. */
  round?: number;
  action?: string;
  mark?: string;
  match_id?: string;
  /** The players the event is about (`event_players` in an effect target); absent means the whole roster. */
  players?: string[];
}

/** The idempotency key of an event: the same key fires once per league. */
export function eventKey(event: KitEvent): string {
  switch (event.event) {
    case 'stage_start':
    case 'stage_end':
      return `${event.event}:${event.stage ?? '-'}`;
    case 'round_start':
    case 'round_end':
      return `${event.event}:${event.stage ?? '-'}:${event.round ?? 0}`;
    case 'match_completed':
      return `match_completed:${event.match_id ?? '-'}`;
    case 'action_locked':
      return `action_locked:${event.action ?? '-'}`;
    case 'time':
      return `time:${event.mark ?? '-'}`;
  }
}

/** Whether `spec` (a rule's trigger) is satisfied by `event`. */
export function eventMatches(spec: EventSpec, event: KitEvent): boolean {
  if (spec.event !== event.event) return false;
  switch (spec.event) {
    case 'stage_start':
    case 'stage_end':
    case 'match_completed':
      return spec.stage === undefined || spec.stage === event.stage;
    case 'round_start':
    case 'round_end':
      return (spec.stage === undefined || spec.stage === event.stage) && (spec.round === undefined || spec.round === event.round);
    case 'action_locked':
      return spec.action === event.action;
    case 'time':
      return spec.mark === event.mark;
  }
}
