import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `clearTeamsMatchPointer` / `releaseTeamsFromMatches` against an in-memory
 * `teams` table: every PostgREST chain records its filters and runs on await,
 * so the test sees the rows the release leaves behind, and then reads them
 * back through the real `getPlayerTeamForTournament` / `getPlayerTeamForMatch`.
 */

interface Row {
  id: string;
  player_id: string;
  tournament_id: string | null;
  match_id: string | null;
  library_published_at: string | null;
  share_token: string | null;
  created_at: string;
  [key: string]: unknown;
}

const { db } = vi.hoisted(() => ({ db: { rows: [] as Row[] } }));

vi.mock('@/lib/supabase/client', () => {
  type Filter = (row: Row) => boolean;
  function chain() {
    const filters: Filter[] = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Partial<Row> = {};
    let single = false;
    let limitN: number | null = null;
    const run = () => {
      const hit = db.rows.filter((row) => filters.every((f) => f(row)));
      if (op === 'update') {
        for (const row of hit) Object.assign(row, patch);
      } else if (op === 'delete') {
        db.rows = db.rows.filter((row) => !hit.includes(row));
      }
      const rows = limitN === null ? hit : hit.slice(0, limitN);
      const copies = rows.map((row) => ({ ...row }));
      if (single) {
        if (copies.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
        return { data: copies[0] ?? null, error: null };
      }
      return { data: copies, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (values: Partial<Row>) => {
        op = 'update';
        patch = values;
        return builder;
      },
      delete: () => {
        op = 'delete';
        return builder;
      },
      eq: (col: string, value: unknown) => {
        filters.push((row) => row[col] === value);
        return builder;
      },
      neq: (col: string, value: unknown) => {
        filters.push((row) => row[col] !== value);
        return builder;
      },
      is: (col: string, value: null) => {
        filters.push((row) => row[col] === value);
        return builder;
      },
      or: (expr: string) => {
        const match = /^match_id\.eq\."([^"]+)",match_id\.is\.null$/.exec(expr);
        if (!match) throw new Error(`unexpected or(): ${expr}`);
        filters.push((row) => row.match_id === match[1] || row.match_id === null);
        return builder;
      },
      order: () => builder,
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      maybeSingle: () => {
        single = true;
        return Promise.resolve(run());
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }
  return { supabase: { from: () => chain() } };
});

import {
  clearTeamsMatchPointer,
  getPlayerTeamForMatch,
  getPlayerTeamForTournament,
  releaseTeamsFromMatches,
} from '../teams';

const team = (overrides: Partial<Row> & { id: string }): Row => ({
  player_id: 'p1',
  tournament_id: 't1',
  match_id: null,
  library_published_at: null,
  share_token: null,
  created_at: '2026-10-01T00:00:00Z',
  name: null,
  season_id: null,
  pokemon: [],
  import_source: 'manual',
  locked: false,
  is_draft_team: false,
  draft_pool_id: null,
  library_title: null,
  library_description: null,
  library_tags: null,
  forked_from_team_id: null,
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  db.rows = [];
});

describe('clearTeamsMatchPointer — a reset never leaves two planned rows', () => {
  it('keeps the released prep row as a personal team when the player already has a planned row, so the planned lookups still resolve', async () => {
    db.rows = [
      team({ id: 'planned' }),
      team({ id: 'prep', match_id: 'm1', created_at: '2026-10-02T00:00:00Z' }),
    ];

    expect(await clearTeamsMatchPointer('m1')).toBe(1);

    // Never deleted: the roster is the player's (teambuilder list), and the
    // reset also deletes match_prep_teams, so it may exist nowhere else.
    expect(db.rows.map((row) => row.id)).toEqual(['planned', 'prep']);
    expect(db.rows.find((row) => row.id === 'prep')).toMatchObject({ match_id: null, tournament_id: null });
    expect((await getPlayerTeamForTournament('p1', 't1'))?.id).toBe('planned');
    expect((await getPlayerTeamForMatch('p1', { id: 'm2', tournament_id: 't1' }))?.id).toBe('planned');
  });

  it('keeps a published or shared prep row, moved out of the tournament (personal team)', async () => {
    db.rows = [
      team({ id: 'planned' }),
      team({ id: 'prep-published', match_id: 'm1', library_published_at: '2026-10-03T00:00:00Z' }),
      team({ id: 'prep-shared', player_id: 'p2', match_id: 'm1', share_token: 'tok' }),
      team({ id: 'planned-p2', player_id: 'p2' }),
    ];

    expect(await clearTeamsMatchPointer('m1')).toBe(2);

    const published = db.rows.find((row) => row.id === 'prep-published');
    const shared = db.rows.find((row) => row.id === 'prep-shared');
    expect(published).toMatchObject({ match_id: null, tournament_id: null });
    expect(shared).toMatchObject({ match_id: null, tournament_id: null });
    expect((await getPlayerTeamForTournament('p1', 't1'))?.id).toBe('planned');
    expect((await getPlayerTeamForTournament('p2', 't1'))?.id).toBe('planned-p2');
  });

  it('a released row without a planned sibling becomes the planned row (row preserved)', async () => {
    db.rows = [team({ id: 'prep', match_id: 'm1' })];

    expect(await clearTeamsMatchPointer('m1')).toBe(1);

    expect(db.rows).toHaveLength(1);
    expect((await getPlayerTeamForTournament('p1', 't1'))?.id).toBe('prep');
  });

  it('leaves rows of other matches and other players alone', async () => {
    db.rows = [
      team({ id: 'planned' }),
      team({ id: 'prep-m2', match_id: 'm2' }),
      team({ id: 'other-player', player_id: 'p9', match_id: 'm1' }),
    ];

    await clearTeamsMatchPointer('m1');

    expect(db.rows.map((row) => [row.id, row.match_id])).toEqual([
      ['planned', null],
      ['prep-m2', 'm2'],
      ['other-player', null],
    ]);
  });
});

describe('releaseTeamsFromMatches — before a match hard delete', () => {
  it('two released prep rows of one player and tournament leave exactly one planned row', async () => {
    db.rows = [
      team({ id: 'prep-a', match_id: 'm1' }),
      team({ id: 'prep-b', match_id: 'm2' }),
    ];

    await releaseTeamsFromMatches(['m1', 'm2']);

    expect(db.rows.map((row) => [row.id, row.tournament_id])).toEqual([
      ['prep-a', 't1'],
      ['prep-b', null],
    ]);
    expect((await getPlayerTeamForTournament('p1', 't1'))?.id).toBe('prep-a');
  });
});
