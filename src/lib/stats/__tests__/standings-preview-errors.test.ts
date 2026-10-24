import { beforeEach, describe, expect, it, vi } from 'vitest';

// A failed read of the season's stages must reject the league preview. If it
// resolved instead, the public cache (publicReads.standingsPreview) would store
// a table with every player at 0-0 and serve it to every visitor.

const h = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown }>,
  tablesRead: [] as string[],
  getCompletedMatchRecordsBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      h.tablesRead.push(table);
      return {
        select: () => ({
          eq: () => Promise.resolve(h.results[table] ?? { data: [], error: null }),
        }),
      };
    },
  },
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getCompletedMatchRecords: vi.fn(),
  getCompletedMatchRecordsBatch: h.getCompletedMatchRecordsBatch,
}));

import { getStandingsPreview } from '../standings-preview';

const participantRow = {
  player_id: 'p1',
  gym_type: null,
  core_types: null,
  core_assigned_at: null,
  players: { id: 'p1', name: 'Ash', avatar_url: null, avatar_config: null, status: 'active' },
};

describe('getStandingsPreview (league)', () => {
  beforeEach(() => {
    h.results = { season_participants: { data: [participantRow], error: null } };
    h.tablesRead = [];
    h.getCompletedMatchRecordsBatch.mockReset();
  });

  it('rejects when the season stage read fails instead of returning a zeroed table', async () => {
    const stageError = { message: 'upstream timeout', code: '' };
    h.results.tournaments = { data: null, error: stageError };

    await expect(getStandingsPreview('league', 'season-1', 3)).rejects.toBe(stageError);
    expect(h.getCompletedMatchRecordsBatch).not.toHaveBeenCalled();
  });

  it('reads the matches of every stage when the stage read succeeds', async () => {
    h.results.tournaments = { data: [{ id: 't1' }, { id: 't2' }], error: null };
    h.getCompletedMatchRecordsBatch.mockResolvedValue(new Map());

    const rows = await getStandingsPreview('league', 'season-1', 3);

    expect(h.getCompletedMatchRecordsBatch).toHaveBeenCalledWith(['t1', 't2']);
    expect(rows).toEqual([{ rank: 1, player_id: 'p1', player_name: 'Ash', wins: 0, losses: 0 }]);
  });

  it('a league without a Swiss stage costs no rounds query and no separate season read', async () => {
    h.results.tournaments = {
      data: [
        { id: 't1', bracket_type: 'round_robin', seasons: { format_type: 'singles' } },
        { id: 't2', bracket_type: 'single_elim', seasons: { format_type: 'singles' } },
      ],
      error: null,
    };
    h.getCompletedMatchRecordsBatch.mockResolvedValue(new Map());

    await getStandingsPreview('league', 'season-1', 3);

    expect(h.tablesRead).toEqual(['season_participants', 'tournaments']);
  });
});
