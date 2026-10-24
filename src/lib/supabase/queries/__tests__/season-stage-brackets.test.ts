import { beforeEach, describe, expect, it, vi } from 'vitest';

// getSeasonStageBrackets: the stage ids, the Swiss flag and the season format from ONE tournaments query.

const h = vi.hoisted(() => ({
  result: { data: [], error: null } as { data: unknown; error: unknown },
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      h.from(table);
      return {
        select: (columns: string) => {
          h.select(columns);
          return {
            eq: (column: string, value: string) => {
              h.eq(column, value);
              return Promise.resolve(h.result);
            },
          };
        },
      };
    },
  },
}));

import { getSeasonStageBrackets } from '../seasons';

beforeEach(() => {
  vi.clearAllMocks();
  h.result = { data: [], error: null };
});

describe('getSeasonStageBrackets', () => {
  it('reads the stage ids, bracket types and the season format in one tournaments query', async () => {
    h.result = {
      data: [
        { id: 'a', bracket_type: 'round_robin', seasons: { format_type: 'singles' } },
        { id: 'b', bracket_type: 'swiss', seasons: { format_type: 'singles' } },
      ],
      error: null,
    };

    await expect(getSeasonStageBrackets('season-1')).resolves.toEqual({
      stageIds: ['a', 'b'],
      hasSwissStage: true,
      formatType: 'singles',
    });
    expect(h.from).toHaveBeenCalledTimes(1);
    expect(h.from).toHaveBeenCalledWith('tournaments');
    expect(h.select).toHaveBeenCalledWith('id, bracket_type, seasons ( format_type )');
    expect(h.eq).toHaveBeenCalledWith('season_id', 'season-1');
  });

  it('reports no Swiss stage for round robin and elimination stages', async () => {
    h.result = {
      data: [
        { id: 'a', bracket_type: 'round_robin', seasons: { format_type: 'evolution_point_buy' } },
        { id: 'b', bracket_type: 'single_elim', seasons: { format_type: 'evolution_point_buy' } },
      ],
      error: null,
    };

    await expect(getSeasonStageBrackets('season-1')).resolves.toMatchObject({
      hasSwissStage: false,
      formatType: 'evolution_point_buy',
    });
  });

  it('a season without a stage has no ids, no Swiss stage and no format', async () => {
    await expect(getSeasonStageBrackets('season-1')).resolves.toEqual({
      stageIds: [],
      hasSwissStage: false,
      formatType: null,
    });
  });

  it('throws a failed read instead of answering an empty season', async () => {
    const failure = { message: 'upstream timeout', code: '' };
    h.result = { data: null, error: failure };

    await expect(getSeasonStageBrackets('season-1')).rejects.toBe(failure);
  });
});
