import { describe, expect, it } from 'vitest';
import { detailNumber, parseDbError } from '../db-errors';

describe('parseDbError', () => {
  it('is null for anything that is not an object', () => {
    for (const value of [null, undefined, 'boom', 7, true]) expect(parseDbError(value)).toBeNull();
  });

  it('reads the SQLSTATE, the message and the constraint name', () => {
    const signal = parseDbError({ code: '23514', message: 'new row for relation "t" violates check constraint "t_draft_size"' });
    expect(signal).toMatchObject({ code: '23514', constraint: 't_draft_size', detail: {} });
  });

  it('parses the DETAIL json of a RAISE EXCEPTION', () => {
    const signal = parseDbError({ code: 'P0001', message: 'STALE', details: '{"draft_rev":5,"max":100}' });
    expect(signal?.detail).toEqual({ draft_rev: 5, max: 100 });
  });

  it('an unparsable or non-object DETAIL is an empty object', () => {
    for (const details of ['not json', '[1,2]', '7', 'null', 42, null]) {
      expect(parseDbError({ code: 'P0001', message: 'X', details })?.detail).toEqual({});
    }
  });

  it('a missing or non-text member is undefined, a message without a constraint has none', () => {
    expect(parseDbError({ code: 5, message: 6 })).toEqual({ code: undefined, message: undefined, detail: {}, constraint: null });
    expect(parseDbError({ message: 'plain' })?.constraint).toBeNull();
  });
});

describe('detailNumber', () => {
  it('reads a finite number, else the fallback', () => {
    const signal = parseDbError({ code: 'P0001', message: 'X', details: '{"n":4,"s":"4","inf":1e999}' });
    if (signal === null) throw new Error('unreachable');
    expect(detailNumber(signal, 'n', 0)).toBe(4);
    expect(detailNumber(signal, 's', 9)).toBe(9);
    expect(detailNumber(signal, 'inf', 9)).toBe(9);
    expect(detailNumber(signal, 'missing', 1)).toBe(1);
  });
});
