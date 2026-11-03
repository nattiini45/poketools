/**
 * The dashboard reads that used to sit inline in GET /api/admin/dashboard: counts, the attention list,
 * the audit trail and the site totals.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTENTION_NOTE_MAX_LENGTH } from '@/lib/admin/dashboard';
import { callsOf, mock, resetQueryMock } from './query-mock';

vi.mock('@/lib/supabase/client', async () => ({ supabase: (await import('./query-mock')).mock.supabase }));

import { countMatches, countSiteTotals, loadAttention, loadRecentActivity } from '../admin-dashboard';

beforeEach(resetQueryMock);

function attentionRow(id: string, updatedAt: string, status = 'disputed', notes: string | null = null) {
  return {
    id,
    tournament_id: 't1',
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: updatedAt,
    notes,
    player_1: { name: 'Ash' },
    player_2: null,
    tournaments: { name: 'Cup', seasons: { name: 'Season 1' } },
  };
}

describe('countMatches', () => {
  it('sums the head counts of every tournament id chunk', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `t${i}`);
    mock.state.results.push({ count: 4 }, { count: 3 });

    await expect(countMatches(['scheduled'], ids)).resolves.toBe(7);

    expect(mock.state.queries).toHaveLength(2);
    const chunkSizes = mock.state.queries.map(
      (query) => (query.calls.find((c) => c[0] === 'in' && c[1][0] === 'tournament_id')?.[1][1] as string[]).length
    );
    expect(chunkSizes).toEqual([100, 50]);
  });

  it('issues no query for no tournaments', async () => {
    await expect(countMatches(['scheduled'], [])).resolves.toBe(0);
    expect(mock.state.queries).toHaveLength(0);
  });

  it('throws a failed read instead of counting it as zero', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ error: failure });
    await expect(countMatches(['scheduled'], ['t1'])).rejects.toBe(failure);
  });
});

describe('loadAttention', () => {
  it('lists the oldest rows first, caps the dispute note and totals both statuses', async () => {
    mock.state.results.push(
      {
        data: [
          attentionRow('b', '2026-02-02T00:00:00.000Z', 'pending_confirmation', 'ignored'),
          attentionRow('a', '2026-02-01T00:00:00.000Z', 'disputed', `  ${'x'.repeat(500)}  `),
        ],
      },
      { count: 1 },
      { count: 1 }
    );

    const result = await loadAttention(['t1']);

    expect(result.rows.map((row) => row.id)).toEqual(['a', 'b']);
    expect(result.rows[0].note).toBe('x'.repeat(ATTENTION_NOTE_MAX_LENGTH));
    expect(result.rows[1].note).toBeNull();
    expect(result.rows[0]).toMatchObject({ tournament_name: 'Cup', season_name: 'Season 1', player_1_name: 'Ash', player_2_name: null });
    expect(result.total).toBe(2);
    expect(result.byStatus).toEqual({ disputed: 1, pending_confirmation: 1 });
  });

  it('answers empty without a query when there are no tournaments', async () => {
    await expect(loadAttention([])).resolves.toEqual({
      rows: [],
      total: 0,
      byStatus: { disputed: 0, pending_confirmation: 0 },
    });
    expect(mock.state.queries).toHaveLength(0);
  });
});

describe('loadRecentActivity', () => {
  it('reads the newest 20 audit rows and maps the dashboard columns', async () => {
    mock.state.results.push({
      data: [
        {
          id: 'e1',
          actor_name: 'Admin',
          action: 'round.reset',
          resource_type: 'round',
          resource_id: 'r1',
          resource_name: 'Round 1',
          created_at: '2026-02-01T00:00:00.000Z',
          ip_address: '1.2.3.4',
        },
      ],
    });

    const rows = await loadRecentActivity();

    expect(mock.state.queries[0].table).toBe('audit_log');
    expect(callsOf(0).limit).toEqual([20]);
    expect(rows).toEqual([
      {
        id: 'e1',
        actor_name: 'Admin',
        action: 'round.reset',
        resource_type: 'round',
        resource_id: 'r1',
        resource_name: 'Round 1',
        created_at: '2026-02-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('countSiteTotals', () => {
  it('counts non-test players and every game', async () => {
    mock.state.results.push({ count: 12 }, { count: 340 });

    await expect(countSiteTotals()).resolves.toEqual({ players: 12, games: 340 });

    expect(mock.state.queries.map((q) => q.table)).toEqual(['players', 'games']);
    expect(callsOf(0).eq).toEqual(['is_test_account', false]);
  });

  it('throws a failed count', async () => {
    const failure = new Error('boom');
    mock.state.results.push({ count: 1 }, { error: failure });
    await expect(countSiteTotals()).rejects.toBe(failure);
  });
});
