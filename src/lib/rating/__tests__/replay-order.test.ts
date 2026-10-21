import { describe, expect, it } from 'vitest';
import { compareReplayOrder, type ReplayOrderMatch } from '@/lib/rating/replay-order';

const m = (id: string, date_played: string | null, created_at: string): ReplayOrderMatch => ({
  id,
  date_played,
  created_at,
});

describe('compareReplayOrder', () => {
  it('orders by date_played, falling back to created_at', () => {
    const rows = [
      m('c', '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      m('b', null, '2026-02-01T00:00:00Z'),
      m('a', '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z'),
    ];
    expect(rows.sort(compareReplayOrder).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts a dated match before an undated one with the same timestamp', () => {
    const rows = [m('undated', null, '2026-01-01T00:00:00Z'), m('dated', '2026-01-01T00:00:00Z', '2025-12-01T00:00:00Z')];
    expect(rows.sort(compareReplayOrder).map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('reproduces the reader order on ties: created_at desc, then id desc', () => {
    const day = '2026-01-01T00:00:00Z';
    const rows = [
      m('00000000-0000-0000-0000-000000000001', day, '2026-01-01T01:00:00Z'),
      m('00000000-0000-0000-0000-000000000002', day, '2026-01-01T01:00:00Z'),
      m('00000000-0000-0000-0000-000000000003', day, '2026-01-01T02:00:00Z'),
    ];
    expect(rows.sort(compareReplayOrder).map((r) => r.id.slice(-1))).toEqual(['3', '2', '1']);
  });

  it('compares created_at at microsecond precision (a tie inside one millisecond keeps the reader order)', () => {
    const day = '2026-01-01T00:00:00+00:00';
    const rows = [
      // Same millisecond; the higher id would win an id tie, but the newer microsecond comes first.
      m('00000000-0000-0000-0000-000000000009', day, '2026-01-01T01:00:00.123001+00:00'),
      m('00000000-0000-0000-0000-000000000001', day, '2026-01-01T01:00:00.123999+00:00'),
    ];
    expect(rows.sort(compareReplayOrder).map((r) => r.id.slice(-1))).toEqual(['1', '9']);
    // The primary key too: an undated match 1 microsecond later replays later.
    expect(
      compareReplayOrder(m('a', null, '2026-01-01T00:00:00.000001+00:00'), m('b', null, '2026-01-01T00:00:00.000002+00:00')),
    ).toBeLessThan(0);
  });

  it('treats equal timestamps written in different formats as equal', () => {
    expect(compareReplayOrder(m('x', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00Z'), m('x', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z'))).toBe(0);
  });
});
