/**
 * The seat succession (`seat-succession.ts`): who holds a seat after the substitutions logged since a match completed, and the
 * revert of that match following the seat. Pure; the revert hook itself is covered in `hooks.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  SEAT_MOVED_EVENT,
  currentHolder,
  microsecondsOf,
  revokesToCurrentHolders,
  seatMovesOf,
  type SeatLogRow,
} from '../seat-succession';
import type { FormatOp } from '../types';

const move = (from: string, to: string, firedAt: string): SeatLogRow => ({ event: SEAT_MOVED_EVENT, payload: { from, to, rows: {} }, fired_at: firedAt });
const COMPLETED: SeatLogRow = { event: 'match_completed', fired_at: '2026-11-08T10:00:00.500000+00:00' };

const revoke = (player_id: string, resource = 'picks'): FormatOp => ({
  op: 'revoke_item', resource, player_id, item_id: 'garchomp', amount: 1, source: 'event', source_ref: null,
});
const points = (player_id: string): FormatOp => ({ op: 'adjust_points', stage: 'main', player_id, points: -3, reason: 'reverted: win' });

describe('microsecondsOf', () => {
  it('keeps the microseconds PostgREST sends and normalises the zone', () => {
    expect(microsecondsOf('2026-11-08T10:00:00.123456+00:00')).toBe(Date.parse('2026-11-08T10:00:00Z') * 1000 + 123456);
    expect(microsecondsOf('2026-11-08T10:00:00.5+00:00')).toBe(Date.parse('2026-11-08T10:00:00Z') * 1000 + 500000);
    expect(microsecondsOf('2026-11-08T10:00:00+00')).toBe(Date.parse('2026-11-08T10:00:00Z') * 1000);
    expect(microsecondsOf('2026-11-08T12:00:00+02:00')).toBe(Date.parse('2026-11-08T10:00:00Z') * 1000);
    expect(microsecondsOf('2026-11-08 10:00:00Z')).toBe(Date.parse('2026-11-08T10:00:00Z') * 1000);
  });

  it('orders two stamps that differ only below the millisecond', () => {
    const a = microsecondsOf('2026-11-08T10:00:00.123111+00:00');
    const b = microsecondsOf('2026-11-08T10:00:00.123999+00:00');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect((a as number) < (b as number)).toBe(true);
  });

  it('is null for what is not a timestamp', () => {
    expect(microsecondsOf('yesterday')).toBeNull();
    expect(microsecondsOf(undefined)).toBeNull();
    expect(microsecondsOf(5)).toBeNull();
  });
});

describe('seatMovesOf', () => {
  it('reads only seat_moved rows, oldest first', () => {
    const moves = seatMovesOf([
      move('b', 'c', '2026-11-08T12:00:00+00:00'),
      { event: 'match_completed', payload: { from: 'x', to: 'y' }, fired_at: '2026-11-08T09:00:00+00:00' },
      move('a', 'b', '2026-11-08T11:00:00+00:00'),
    ]);
    expect(moves.map((m) => `${m.from}>${m.to}`)).toEqual(['a>b', 'b>c']);
  });

  it('throws on a seat_moved row it cannot read, so a revert fails visibly instead of revoking from the wrong player', () => {
    expect(() => seatMovesOf([{ event: SEAT_MOVED_EVENT, payload: { from: 'a' }, fired_at: '2026-11-08T11:00:00+00:00' }])).toThrow(/seat_moved/);
    expect(() => seatMovesOf([{ event: SEAT_MOVED_EVENT, payload: { from: 'a', to: 'b' }, fired_at: 'later' }])).toThrow(/seat_moved/);
    expect(() => seatMovesOf([{ event: SEAT_MOVED_EVENT, fired_at: '2026-11-08T11:00:00+00:00' }])).toThrow(/seat_moved/);
  });

  it('is empty for a league whose seats never moved', () => {
    expect(seatMovesOf([])).toEqual([]);
    expect(seatMovesOf([{ event: 'match_completed' }])).toEqual([]);
  });
});

describe('currentHolder', () => {
  const moves = seatMovesOf([
    move('a', 'b', '2026-11-08T11:00:00+00:00'),
    move('b', 'c', '2026-11-08T12:00:00+00:00'),
    move('c', 'a', '2026-11-08T13:00:00+00:00'),
    move('a', 'd', '2026-11-08T14:00:00+00:00'),
  ]);
  const at = (stamp: string) => microsecondsOf(stamp) as number;

  it('follows a chain, including a seat that came back, to its holder at the end', () => {
    expect(currentHolder('a', at('2026-11-08T10:00:00+00:00'), moves)).toBe('d');
  });

  it('starts after the completion: a grant made later went to the then current holder', () => {
    // b -> c (12:00) is before this completion: b stays b, and the later moves are from other players.
    expect(currentHolder('b', at('2026-11-08T12:30:00+00:00'), moves)).toBe('b');
    expect(currentHolder('c', at('2026-11-08T14:30:00+00:00'), moves)).toBe('c');
    // Completed between the first two moves: b follows b -> c -> a -> d.
    expect(currentHolder('b', at('2026-11-08T11:30:00+00:00'), moves)).toBe('d');
  });

  it('leaves a player whose seat never moved', () => {
    expect(currentHolder('z', at('2026-11-08T10:00:00+00:00'), moves)).toBe('z');
  });

  it('does not treat a move at the very instant of the completion as after it', () => {
    expect(currentHolder('a', at('2026-11-08T14:00:00+00:00'), moves)).toBe('a');
  });
});

describe('revokesToCurrentHolders', () => {
  it('returns the ops unchanged, without reading the completion, when no seat ever moved', () => {
    const ops = [revoke('a'), points('a')];
    expect(revokesToCurrentHolders(ops, undefined, [])).toEqual(ops);
  });

  it('moves a revoke of the player who left to the substitute, with the rest of the op intact', () => {
    const moves = seatMovesOf([move('out', 'in', '2026-11-08T11:00:00+00:00')]);

    expect(revokesToCurrentHolders([revoke('out')], COMPLETED, moves)).toEqual([
      { op: 'revoke_item', resource: 'picks', player_id: 'in', item_id: 'garchomp', amount: 1, source: 'event', source_ref: null },
    ]);
  });

  it('leaves the revoke of a completion that came after the move on the player it names', () => {
    const moves = seatMovesOf([move('out', 'in', '2026-11-08T09:00:00+00:00')]);

    expect(revokesToCurrentHolders([revoke('in'), revoke('out')], COMPLETED, moves)).toEqual([revoke('in'), revoke('out')]);
  });

  it('leaves a points adjustment with the player it was written for, so the pair still cancels', () => {
    const moves = seatMovesOf([move('out', 'in', '2026-11-08T11:00:00+00:00')]);

    expect(revokesToCurrentHolders([points('out'), revoke('out')], COMPLETED, moves)).toEqual([points('out'), revoke('in')]);
  });

  it('follows a chain A -> B -> C for each revoke separately', () => {
    const moves = seatMovesOf([move('a', 'b', '2026-11-08T11:00:00+00:00'), move('b', 'c', '2026-11-08T12:00:00+00:00')]);

    expect(revokesToCurrentHolders([revoke('a'), revoke('b'), revoke('c')], COMPLETED, moves).map((op) => (op as { player_id: string }).player_id)).toEqual(['c', 'c', 'c']);
  });

  it('throws when seats moved and the completion has no readable time', () => {
    const moves = seatMovesOf([move('out', 'in', '2026-11-08T11:00:00+00:00')]);

    expect(() => revokesToCurrentHolders([revoke('out')], undefined, moves)).toThrow(/no readable time/);
    expect(() => revokesToCurrentHolders([revoke('out')], { event: 'match_completed' }, moves)).toThrow(/no readable time/);
  });
});
