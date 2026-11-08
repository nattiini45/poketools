/**
 * Who holds a seat now. A substitution moves the format rows of the player who left to the substitute
 * (`format_substitute_seat`, 20261106090000) and logs one `seat_moved` event {from, to} in `format_event_log`. The event log
 * itself stays as history: the ops of an event that fired before the move still name the player who left.
 *
 * `onMatchReverted` takes back what a `match_completed` event applied by replaying the inverse of its logged ops. A revoke
 * names the player the grant went to; after a substitution that player holds nothing, the lenient revoke would find no row and
 * the substitute would keep the units the reverted match granted. `revokesToCurrentHolders` therefore follows the seat moves
 * logged AFTER the completion from the named player to the player who holds the seat now (a chain A -> B -> C resolves to C, and
 * a seat that came back resolves to its holder at the end).
 *
 * Only revokes follow the seat. A points adjustment (`format_adjustments`) stays with the player it was written for, and so
 * does its inverse: both rows name the same player, so the pair still cancels. Every other logged op is irreversible and is
 * not inverted at all (`inverseOps`).
 *
 * Pure: no I/O, no clock. Server side (the log rows are server data).
 */
import type { Json } from '@/types/database';
import type { FormatOp } from './types';

/** The `event` of the row `format_substitute_seat` logs. */
export const SEAT_MOVED_EVENT = 'seat_moved';

/** The fields of a `format_event_log` row this module reads. */
export interface SeatLogRow {
  event?: string;
  payload?: Json;
  fired_at?: string;
}

/** One move of a seat, `at` in microseconds since the epoch. */
export interface SeatMove {
  from: string;
  to: string;
  at: number;
}

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * A `timestamptz` as PostgREST returns it, in microseconds since the epoch (the log rows are ordered by the microsecond, which
 * `Date.parse` would cut to milliseconds), or null when it does not parse.
 */
export function microsecondsOf(timestamp: unknown): number | null {
  if (typeof timestamp !== 'string') return null;
  const match = TIMESTAMP.exec(timestamp);
  if (match === null) return null;
  let zone = match[4] ?? 'Z';
  if (/^[+-]\d{2}$/.test(zone)) zone = `${zone}:00`;
  else if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const milliseconds = Date.parse(`${match[1]}T${match[2]}${zone}`);
  if (Number.isNaN(milliseconds)) return null;
  return milliseconds * 1000 + Number((match[3] ?? '').padEnd(6, '0') || '0');
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The seat moves of a league's event log, oldest first. A `seat_moved` row that cannot be read (no players in the payload, a
 * timestamp that does not parse) throws: a revert planned without it would revoke from the wrong player in silence, and the
 * caller reports the throw as a failed `format` step instead.
 */
export function seatMovesOf(eventLog: readonly SeatLogRow[]): SeatMove[] {
  const moves: SeatMove[] = [];
  for (const row of eventLog) {
    if (row.event !== SEAT_MOVED_EVENT) continue;
    const from = isRecord(row.payload) ? row.payload.from : undefined;
    const to = isRecord(row.payload) ? row.payload.to : undefined;
    const at = microsecondsOf(row.fired_at);
    if (typeof from !== 'string' || typeof to !== 'string' || at === null) {
      throw new Error('a seat_moved event of the league log cannot be read (players or time missing)');
    }
    moves.push({ from, to, at });
  }
  return moves.sort((a, b) => a.at - b.at);
}

/** The player who holds `playerId`'s seat after the moves that came after `since` (microseconds). */
export function currentHolder(playerId: string, since: number, moves: readonly SeatMove[]): string {
  let holder = playerId;
  for (const move of moves) {
    if (move.at > since && move.from === holder) holder = move.to;
  }
  return holder;
}

/**
 * `ops` (the inverse of a logged completion) with every revoke moved to the player who holds the seat now. `completion` is the
 * logged `match_completed` row the ops undo: only the moves after its `fired_at` apply, because a grant made after a move went
 * to the then current holder. Throws when there are seat moves and the completion has no readable time (see `seatMovesOf`).
 */
export function revokesToCurrentHolders(ops: readonly FormatOp[], completion: SeatLogRow | undefined, moves: readonly SeatMove[]): FormatOp[] {
  if (moves.length === 0) return [...ops];
  const since = microsecondsOf(completion?.fired_at);
  if (since === null) {
    throw new Error('the logged completion has no readable time, so the seat moves after it cannot be told');
  }
  return ops.map((op) => (op.op === 'revoke_item' ? { ...op, player_id: currentHolder(op.player_id, since, moves) } : op));
}
