import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mode: vi.fn(),
  rows: {} as Record<string, { id: string } | null>,
  calls: [] as string[],
}));

vi.mock('@/lib/league-phase/route-mode', () => ({ getPhaseRouteMode: h.mode }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const filters: string[] = [table];
      const query = {
        select: () => query,
        eq: (column: string, value: string) => { filters.push(`${column}=${value}`); return query; },
        not: (column: string) => { filters.push(`${column}!null`); return query; },
        maybeSingle: async () => {
          const key = filters.join(' ');
          h.calls.push(key);
          return { data: h.rows[key] ?? null, error: null };
        },
      };
      return query;
    },
  },
}));

import { libraryEntryIsPublished, shareLinkIsLive } from '../page-existence';

const token = '00000000-0000-4000-8000-000000000021';
const id = '00000000-0000-4000-8000-000000000022';

beforeEach(() => {
  h.mode.mockReset();
  h.rows = {};
  h.calls = [];
});

describe('page existence for team pages', () => {
  it('reads only the legacy store in legacy mode', async () => {
    h.mode.mockResolvedValue('legacy');
    h.rows[`phase_teams share_token=${token} share_enabled_at!null`] = { id };
    expect(await shareLinkIsLive(token)).toBe(false);
    expect(h.calls).toEqual([`teams share_token=${token} share_enabled_at!null`]);
  });

  it.each(['phase', 'frozen_legacy', 'frozen_phase'])('finds a live native share link in %s mode', async (mode) => {
    h.mode.mockResolvedValue(mode);
    h.rows[`phase_teams share_token=${token} share_enabled_at!null`] = { id };
    expect(await shareLinkIsLive(token)).toBe(true);
  });

  it('finds a published native library entry in phase mode', async () => {
    h.mode.mockResolvedValue('phase');
    h.rows[`phase_teams id=${id} library_published_at!null`] = { id };
    expect(await libraryEntryIsPublished(id)).toBe(true);
  });

  it('still finds a legacy entry in phase mode, and answers false when neither store holds one', async () => {
    h.mode.mockResolvedValue('phase');
    h.rows[`teams id=${id} library_published_at!null`] = { id };
    expect(await libraryEntryIsPublished(id)).toBe(true);
    expect(await shareLinkIsLive(token)).toBe(false);
    expect(h.calls).toContain(`phase_teams share_token=${token} share_enabled_at!null`);
  });
});
