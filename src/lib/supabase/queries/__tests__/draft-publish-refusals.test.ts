import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  calls: [] as { table: string; cols: string; col: string; ids: string[] }[],
  result: { data: [] as unknown[] | null, error: null as unknown },
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        in: async (col: string, ids: string[]) => {
          db.calls.push({ table, cols, col, ids });
          return db.result;
        },
      }),
    }),
  },
}));

import { getPublishRefusals, getPublishRefusedAt } from '../draft-publish-refusals';

beforeEach(() => {
  db.calls = [];
  db.result = { data: [], error: null };
});

describe('draft publish refusals (admin data)', () => {
  it('makes no query for no pools', async () => {
    expect(await getPublishRefusals([])).toEqual({});
    expect(db.calls).toEqual([]);
  });

  it('reads id + publish_refused_at of the given pools once and lists only refused ones', async () => {
    db.result = {
      data: [
        { id: 'p1', publish_refused_at: '2026-10-18T22:00:05Z' },
        { id: 'p2', publish_refused_at: null },
      ],
      error: null,
    };
    expect(await getPublishRefusals(['p1', 'p2'])).toEqual({ p1: '2026-10-18T22:00:05Z' });
    expect(db.calls).toEqual([{ table: 'draft_pools', cols: 'id, publish_refused_at', col: 'id', ids: ['p1', 'p2'] }]);
  });

  it('one pool: its instant, or null when never refused', async () => {
    db.result = { data: [{ id: 'p1', publish_refused_at: '2026-10-18T22:00:05Z' }], error: null };
    expect(await getPublishRefusedAt('p1')).toBe('2026-10-18T22:00:05Z');
    db.result = { data: [{ id: 'p1', publish_refused_at: null }], error: null };
    expect(await getPublishRefusedAt('p1')).toBeNull();
  });

  it('a failed read throws (never "not refused")', async () => {
    db.result = { data: null, error: { code: '57014', message: 'statement timeout' } };
    await expect(getPublishRefusals(['p1'])).rejects.toMatchObject({ code: '57014' });
    await expect(getPublishRefusedAt('p1')).rejects.toMatchObject({ code: '57014' });
  });
});
