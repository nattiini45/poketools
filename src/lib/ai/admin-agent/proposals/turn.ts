/**
 * Per-turn staging limits (plan 3.4): at most 4 stagings in one assistant turn, and at most ONE Go-live (G) proposal, so a
 * single model step can never put a pile of irreversible cards in front of the admin. The loop makes one counter object per
 * turn (`newTurnStaging()`), passes it to every `stageProposal` call, and `stageProposal` checks and records on it.
 *
 * The per-conversation cap of 2 pending proposals is separate: it is enforced by the store when the row is inserted.
 */
import type { ApiErrorCode } from '@/i18n/messages/errors';
import type { TurnStaging } from './types';

export const newTurnStaging = (): TurnStaging => ({ stagings: 0, goLive: 0 });

/** At most one Go-live proposal per assistant turn. */
export const MAX_GOLIVE_PER_TURN = 1;

export interface TurnRefusal {
  code: ApiErrorCode;
  params: { limit: number };
}

/** The refusal for staging one more proposal of `cls` in this turn, or `null` when it fits. */
export function checkTurnStaging(turn: TurnStaging, cls: 'B' | 'G', maxStagingsPerTurn: number): TurnRefusal | null {
  if (cls === 'G' && turn.goLive >= MAX_GOLIVE_PER_TURN) return { code: 'agent_cap_reached', params: { limit: MAX_GOLIVE_PER_TURN } };
  if (turn.stagings >= maxStagingsPerTurn) return { code: 'agent_cap_reached', params: { limit: maxStagingsPerTurn } };
  return null;
}

/** Records a proposal that was staged. */
export function recordTurnStaging(turn: TurnStaging, cls: 'B' | 'G'): void {
  turn.stagings += 1;
  if (cls === 'G') turn.goLive += 1;
}
