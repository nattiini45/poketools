/**
 * listUnfinishedFormatLeaguesOfPlayer: the delete route's check for a player enrolled in an unfinished league that runs a
 * format. Served by an in-memory stub of the three tables it reads (no network).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  fail: null as string | null,
  formatLookups: [] as string[][],
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      let playerId: string | null = null;
      let ids: string[] | null = null;
      const builder = {
        select: () => builder,
        eq: (_column: string, value: string) => {
          playerId = value;
          return builder;
        },
        not: () => builder,
        in: (_column: string, values: string[]) => {
          ids = values;
          state.formatLookups.push(values);
          return builder;
        },
        then<T>(resolve: (result: { data: Row[] | null; error: { message: string } | null }) => T) {
          if (state.fail === table) return resolve({ data: null, error: { message: 'boom' } });
          const rows = (state.tables[table] ?? []).filter((row) => {
            if (playerId !== null && row.player_id !== playerId) return false;
            if (ids !== null && !ids.includes(String(row.season_id))) return false;
            return true;
          });
          return resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  },
}));

import { listUnfinishedFormatLeaguesOfPlayer } from '../player-format-leagues';

const season = (id: string, name: string, status = 'active', archived = false) => ({ id, name, status, archived });
const onRoster = (playerId: string, s: ReturnType<typeof season>) => ({ player_id: playerId, seasons: s });
const inPhase = (playerId: string, s: ReturnType<typeof season>) => ({ player_id: playerId, tournaments: { season_id: s.id, seasons: s } });

const WINTER = season('s-w', 'Winter Cup');
const AUTUMN = season('s-a', 'Autumn League', 'upcoming');

beforeEach(() => {
  state.tables = { season_participants: [], tournament_participants: [], season_formats: [] };
  state.fail = null;
  state.formatLookups = [];
});

describe('listUnfinishedFormatLeaguesOfPlayer', () => {
  it('names the unfinished leagues with a format the player is on the roster of, sorted by name', async () => {
    state.tables.season_participants = [onRoster('p1', WINTER), onRoster('p1', AUTUMN), onRoster('p2', season('s-x', 'Other'))];
    state.tables.season_formats = [{ season_id: 's-w' }, { season_id: 's-a' }, { season_id: 's-x' }];

    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).resolves.toEqual([
      { id: 's-a', name: 'Autumn League' },
      { id: 's-w', name: 'Winter Cup' },
    ]);
  });

  it('counts a player enrolled in a phase only (not on the roster) and names that league once', async () => {
    state.tables.tournament_participants = [inPhase('p1', WINTER), inPhase('p1', WINTER)];
    state.tables.season_participants = [onRoster('p1', WINTER)];
    state.tables.season_formats = [{ season_id: 's-w' }];

    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).resolves.toEqual([{ id: 's-w', name: 'Winter Cup' }]);
    expect(state.formatLookups).toEqual([['s-w']]);
  });

  it('lets a finished league through: a completed one and an archived one do not block', async () => {
    state.tables.season_participants = [onRoster('p1', season('s-c', 'Done', 'completed')), onRoster('p1', season('s-r', 'Shelved', 'active', true))];
    state.tables.season_formats = [{ season_id: 's-c' }, { season_id: 's-r' }];

    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).resolves.toEqual([]);
    // Nothing unfinished: the formats are not even looked up.
    expect(state.formatLookups).toEqual([]);
  });

  it('lets a league without an attached format through', async () => {
    state.tables.season_participants = [onRoster('p1', WINTER)];
    state.tables.season_formats = [];

    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).resolves.toEqual([]);
  });

  it('is empty for a player enrolled nowhere', async () => {
    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).resolves.toEqual([]);
  });

  it('rethrows a failed read, so the delete is not decided on a guess', async () => {
    for (const table of ['season_participants', 'tournament_participants']) {
      state.fail = table;
      await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).rejects.toMatchObject({ message: 'boom' });
    }
    state.fail = 'season_formats';
    state.tables.season_participants = [onRoster('p1', WINTER)];
    await expect(listUnfinishedFormatLeaguesOfPlayer('p1')).rejects.toMatchObject({ message: 'boom' });
  });
});
