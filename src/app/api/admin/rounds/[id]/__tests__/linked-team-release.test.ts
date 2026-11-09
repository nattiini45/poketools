import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * DELETE /api/admin/rounds/[id] with the real `deleteRoundWithMatches` and `releaseTeamsFromMatches`, mocked one layer
 * down: an in-memory service-role client holding `matches` and `teams`. `teams.match_id` follows the schema's
 * `ON DELETE SET NULL`, so a match-prep row that is not released first survives its match as a second planned row.
 */

interface MatchRow {
  id: string;
  round_id: string;
  status: string;
}
interface TeamRow {
  id: string;
  player_id: string;
  tournament_id: string | null;
  match_id: string | null;
}

const { db } = vi.hoisted(() => ({
  db: { matches: [] as MatchRow[], teams: [] as TeamRow[], log: [] as string[] },
}));

vi.mock('@/lib/supabase/client', () => {
  type Row = Record<string, unknown>;
  function chain(table: 'matches' | 'teams') {
    const filters: Array<(row: Row) => boolean> = [];
    let op: 'select' | 'update' | 'delete' = 'select';
    let patch: Row = {};
    let columns = '*';
    let limitN: number | null = null;
    let rangeTo: [number, number] | null = null;
    const rows = () => db[table] as unknown as Row[];
    const run = () => {
      const hit = rows().filter((row) => filters.every((f) => f(row)));
      if (op === 'update') {
        db.log.push(`update:${table}`);
        for (const row of hit) Object.assign(row, patch);
      } else if (op === 'delete') {
        db.log.push(`delete:${table}`);
        const gone = new Set(hit.map((row) => row.id));
        (db as unknown as Record<string, Row[]>)[table] = rows().filter((row) => !gone.has(row.id));
        if (table === 'matches') {
          for (const team of db.teams) if (team.match_id && gone.has(team.match_id)) team.match_id = null;
        }
        return { data: null, error: null };
      }
      let out = hit;
      if (rangeTo) out = out.slice(rangeTo[0], rangeTo[1] + 1);
      if (limitN !== null) out = out.slice(0, limitN);
      const keys = columns === '*' ? null : columns.split(',').map((key) => key.trim());
      return {
        data: out.map((row) => (keys ? Object.fromEntries(keys.map((key) => [key, row[key]])) : { ...row })),
        error: null,
      };
    };
    const builder: Record<string, unknown> = {
      select: (cols?: string) => {
        if (cols) columns = cols;
        return builder;
      },
      update: (values: Row) => {
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
      order: () => builder,
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      range: (from: number, to: number) => {
        rangeTo = [from, to];
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  }
  // round_delete: the matches and the round in one transaction (`teams.match_id` follows the schema's ON DELETE SET NULL).
  const rpc = (name: string, args: { p_round_id: string }) => {
    if (name !== 'round_delete') return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    db.log.push('delete:matches');
    const gone = new Set(db.matches.filter((row) => row.round_id === args.p_round_id).map((row) => row.id));
    db.matches = db.matches.filter((row) => !gone.has(row.id));
    for (const team of db.teams) if (team.match_id && gone.has(team.match_id)) team.match_id = null;
    return Promise.resolve({ data: { outcome: 'deleted', matches: gone.size }, error: null });
  };
  return { supabase: { from: (table: 'matches' | 'teams') => chain(table), rpc } };
});

vi.mock('@/lib/auth/helpers', () => {
  class AuthError extends Error {
    statusCode = 401;
  }
  return { requirePlayer: vi.fn(), AuthError };
});
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(),
  getRoundsByTournament: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/queries/matches')>()),
  getMatchesByRound: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/games', () => ({ getGamesByMatch: vi.fn() }));
vi.mock('@/lib/pkmn/game-pipeline', () => ({ resetMatch: vi.fn() }));
vi.mock('@/lib/match/aggregate-rebuild', () => ({ rebuildAggregatesForScope: vi.fn() }));
vi.mock('@/lib/revalidation', () => ({ revalidateMatchPages: vi.fn() }));
vi.mock('@/lib/supabase/queries/tournaments', () => ({ updateTournament: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ logAuditEvent: vi.fn() }));

import { DELETE } from '@/app/api/admin/rounds/[id]/route';
import { requirePlayer } from '@/lib/auth/helpers';
import { getRoundById, getRoundsByTournament } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound } from '@/lib/supabase/queries/matches';
import { getGamesByMatch } from '@/lib/supabase/queries/games';

const ROUND_ID = 'ccd1e4a6-92f3-48fe-8cb7-1fd927e0e38f';
const routeParams = { params: Promise.resolve({ id: ROUND_ID }) };
const round = {
  id: ROUND_ID,
  tournament_id: 'tourn-1',
  name: 'Round 1',
  round_number: 1,
  bracket_side: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlayer).mockResolvedValue({ playerId: 'admin-1', isAdmin: true, isCreator: false, name: 'Admin' } as never);
  vi.mocked(getRoundById).mockResolvedValue(round as never);
  vi.mocked(getRoundsByTournament).mockResolvedValue([round] as never);
  vi.mocked(getGamesByMatch).mockResolvedValue([] as never);
  db.log = [];
  db.matches = [{ id: 'match-1', round_id: ROUND_ID, status: 'scheduled' }];
  vi.mocked(getMatchesByRound).mockResolvedValue([{ id: 'match-1', status: 'scheduled' }] as never);
});

describe('DELETE /api/admin/rounds/[id] with a linked team row', () => {
  it('linked team release: a match that left scheduled refuses the delete before any team link is released', async () => {
    db.matches = [{ id: 'match-1', round_id: ROUND_ID, status: 'completed' }];
    db.teams = [{ id: 'match-prep', player_id: 'p1', tournament_id: 'tourn-1', match_id: 'match-1' }];

    const res = await DELETE({} as NextRequest, routeParams);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('round_changed');
    expect(db.log).toEqual([]);
    expect(db.teams[0].match_id).toBe('match-1');
  });

  it('linked team release: releases the scheduled match team row before the matches delete and leaves the player one planned team row', async () => {
    db.teams = [
      { id: 'planned', player_id: 'p1', tournament_id: 'tourn-1', match_id: null },
      { id: 'match-prep', player_id: 'p1', tournament_id: 'tourn-1', match_id: 'match-1' },
    ];

    const res = await DELETE({} as NextRequest, routeParams);

    expect((await res.json()).success).toBe(true);
    expect(db.log).toEqual(['update:teams', 'update:teams', 'delete:matches']);
    expect(db.matches).toEqual([]);
    const planned = db.teams.filter((t) => t.player_id === 'p1' && t.tournament_id === 'tourn-1' && t.match_id === null);
    expect(planned.map((t) => t.id)).toEqual(['planned']);
    expect(db.teams.find((t) => t.id === 'match-prep')).toEqual({
      id: 'match-prep',
      player_id: 'p1',
      tournament_id: null,
      match_id: null,
    });
  });

  it('linked team release: a prep row with no planned sibling becomes the planned row instead of vanishing', async () => {
    db.teams = [{ id: 'match-prep', player_id: 'p1', tournament_id: 'tourn-1', match_id: 'match-1' }];

    const res = await DELETE({} as NextRequest, routeParams);

    expect((await res.json()).success).toBe(true);
    expect(db.teams).toEqual([{ id: 'match-prep', player_id: 'p1', tournament_id: 'tourn-1', match_id: null }]);
  });
});
