/**
 * Redraft seat order. Client-safe and pure.
 *
 * The worst first-half standing picks first, then ascending toward the best
 * (snake order is generated from the seats by the SQL queue). The route
 * computes the standings once and freezes the result as `participant_order`.
 */
import { DraftRuleError } from '@/lib/draft/errors';

export interface RedraftSeat {
  player_id: string;
  /** 1 = picks first = last place. */
  seat: number;
  /** 1 = best first-half standing. */
  standing_rank: number;
}

/**
 * Seats from the first-half standings, best first. Seat 1 = last place; ties keep the
 * order of the standings as computed (it is frozen, never re-sorted). Duplicate or empty
 * player ids → `SEATS_INVALID`.
 */
export function computeRedraftSeats(standingsBestFirst: readonly { player_id: string }[]): RedraftSeat[] {
  const seen = new Set<string>();
  for (const row of standingsBestFirst) {
    if (!row.player_id || seen.has(row.player_id)) throw new DraftRuleError('SEATS_INVALID');
    seen.add(row.player_id);
  }
  const n = standingsBestFirst.length;
  return standingsBestFirst
    .map((row, index) => ({ player_id: row.player_id, seat: n - index, standing_rank: index + 1 }))
    .sort((a, b) => a.seat - b.seat);
}

/** Player ids in seat order (seat 1 first): the `participant_order` a redraft pool is created with. */
export function redraftParticipantOrder(standingsBestFirst: readonly { player_id: string }[]): string[] {
  return computeRedraftSeats(standingsBestFirst).map((s) => s.player_id);
}
