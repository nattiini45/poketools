/**
 * D36 fixes 4, 6 and 10 (owned query modules): the narrow reads select only
 * what their callers use, batch where the callers used to loop, and keep the
 * row semantics of the reads they replace. Served by an in-memory PostgREST
 * (no network); the recorded selects and filters are the assertions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';
import { buildFixtureTables, EPB_SEASON_ID, SAKURA_SEASON_ID } from '@/lib/worlds/__tests__/world-fixture-db';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import {
  getMatchesByTournament,
  getMatchesByTournamentIds,
} from '../matches';
import { listTeamLeadsBySeason, listTeamsBySeason } from '../teams';
import {
  getPublicSeasonParticipants,
  getSeasonFormatTypes,
  getSeasonParticipantGymTypes,
  getSeasonParticipants,
  getSeasonStageIds,
  getSeasonWithDetails,
  listSeasons,
} from '../seasons';
import { getAggregates, getAggregatesSummary } from '../aggregates';
import { getBattleStatsForTournaments } from '../games';
import { getLeagueSchedule } from '../league-standings';
import { teamToLead } from '@/lib/worlds/route-data';

function queriesOn(table: string) {
  return fake.current!.queries.filter((q) => q.table === table);
}

beforeEach(() => {
  fake.current = createFakeSupabase({
    ...buildFixtureTables(),
    aggregates: [
      {
        id: 'agg-1',
        scope_type: 'tournament',
        scope_id: 't-1',
        pokemon_name: 'Garchomp',
        total_appearances: 6,
        total_brought: 5,
        total_led: 2,
        total_kos_dealt: 7,
        total_koed: 3,
        total_wins: 4,
        total_games: 6,
        move_counts: { Earthquake: 12, 'Swords Dance': 4 },
        last_updated: '2026-09-20T00:00:00.000Z',
      },
    ],
  });
});

describe('getMatchesByTournamentIds', () => {
  it('reads every stage in ONE .in() query and groups rows per stage like the per-stage read', async () => {
    const perStage = {
      'e-stage-1': await getMatchesByTournament('e-stage-1'),
      'e-stage-2': await getMatchesByTournament('e-stage-2'),
    };
    fake.current!.reset();

    const grouped = await getMatchesByTournamentIds(['e-stage-1', 'e-stage-2']);

    expect(fake.current!.queries).toHaveLength(1);
    expect(fake.current!.queries[0].filters).toEqual([
      { op: 'in', column: 'tournament_id', value: ['e-stage-1', 'e-stage-2'] },
    ]);
    // One max_rows window, oldest first (a stable order is what makes paging safe).
    expect(fake.current!.queries[0].range).toEqual({ from: 0, to: 999 });
    expect(fake.current!.queries[0].limit).toBeNull();
    expect(fake.current!.queries[0].orders).toEqual([
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ]);
    expect(Object.fromEntries(grouped)).toEqual(perStage);
  });

  it('every requested id gets an entry; no ids means no query', async () => {
    const grouped = await getMatchesByTournamentIds(['e-stage-2', 'no-such-stage', 'e-stage-2']);
    expect([...grouped.keys()]).toEqual(['e-stage-2', 'no-such-stage']);
    expect(grouped.get('no-such-stage')).toEqual([]);

    fake.current!.reset();
    expect((await getMatchesByTournamentIds([])).size).toBe(0);
    expect(fake.current!.queries).toHaveLength(0);
  });

  /** `count` matches spread over `stages`, ids zero-padded so id order is creation order. */
  function manyMatches(stages: string[], count: number) {
    const tables = buildFixtureTables();
    const template = tables.matches[0];
    return {
      ...tables,
      matches: Array.from({ length: count }, (_, i) => ({
        ...template,
        id: `m-${String(i).padStart(5, '0')}`,
        tournament_id: stages[i % stages.length],
      })),
    };
  }

  it('pages past the max_rows ceiling with .range() instead of truncating', async () => {
    const stages = ['e-stage-1', 'e-stage-2', 'e-stage-3'];
    fake.current = createFakeSupabase(manyMatches(stages, 1200));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const grouped = await getMatchesByTournamentIds(stages);

      // Before: one read, silently capped at 1000 rows by PostgREST max_rows.
      expect(fake.current!.queries.map((q) => q.range)).toEqual([
        { from: 0, to: 999 },
        { from: 1000, to: 1499 },
      ]);
      expect(stages.map((id) => grouped.get(id)!.length)).toEqual([400, 400, 400]);
      const ids = [...grouped.values()].flat().map((m) => m.id);
      expect(new Set(ids).size).toBe(1200);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a full last window costs one extra, empty read and no warning', async () => {
    const stages = ['e-stage-1', 'e-stage-2', 'e-stage-3'];
    fake.current = createFakeSupabase(manyMatches(stages, 1000));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const grouped = await getMatchesByTournamentIds(stages);
      expect(fake.current!.queries).toHaveLength(2);
      expect([...grouped.values()].flat()).toHaveLength(1000);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('discloses reaching the per-tournament total (the per-stage reads capped at 500 each)', async () => {
    fake.current = createFakeSupabase(manyMatches(['e-stage-1', 'e-stage-2'], 1100));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const grouped = await getMatchesByTournamentIds(['e-stage-1', 'e-stage-2']);
      expect(fake.current!.queries).toHaveLength(1);
      expect([...grouped.values()].flat()).toHaveLength(1000);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('500-per-tournament cap'));
    } finally {
      warn.mockRestore();
    }
  });

  it('a read error on a later page is thrown, not dropped', async () => {
    const stages = ['e-stage-1', 'e-stage-2', 'e-stage-3'];
    const inner = createFakeSupabase(manyMatches(stages, 1200));
    let reads = 0;
    fake.current = {
      ...inner,
      client: {
        ...inner.client,
        from: (table: string) => {
          const builder = inner.client.from(table) as Record<string, unknown>;
          reads++;
          if (reads === 2) {
            builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: new Error('page 2 failed') }).then(onFulfilled, onRejected);
          }
          return builder;
        },
      },
    } as FakeSupabase;

    await expect(getMatchesByTournamentIds(stages)).rejects.toThrow('page 2 failed');
  });
});

describe('listTeamLeadsBySeason', () => {
  it('selects the lead species by JSON path, never the full sets', async () => {
    await listTeamLeadsBySeason(SAKURA_SEASON_ID);

    const [read] = queriesOn('teams');
    expect(read.select).toBe('id, player_id, updated_at, lead_species:pokemon->0->>species');
    expect(read.select).not.toMatch(/\*|pokemon(?!->)/);
    expect(read.orders).toEqual([{ column: 'created_at', ascending: true }]);
  });

  it('yields the same leads teamToLead derives from the full rows', async () => {
    const leads = await listTeamLeadsBySeason(SAKURA_SEASON_ID);
    const full = await listTeamsBySeason(SAKURA_SEASON_ID);

    expect(leads).toEqual(full.map(teamToLead));
    expect(leads.find((l) => l.id === 'team-d')?.lead_species).toBeNull();
  });
});

describe('season participant reads', () => {
  it('getPublicSeasonParticipants selects public columns only and returns the public row', async () => {
    const rows = await getPublicSeasonParticipants(SAKURA_SEASON_ID);

    const [read] = queriesOn('season_participants');
    expect(read.select).toBe('player_id, gym_type, core_types, players ( id, name, avatar_url )');
    expect(rows[0]).toEqual({
      id: 'p1',
      name: 'Mara Feldkamp',
      gym_type: 'Dragon',
      avatar_url: 'https://cdn.example.test/avatars/p1.png',
      core_types: ['Dragon', 'Fairy', 'Steel'],
    });
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['avatar_url', 'core_types', 'gym_type', 'id', 'name']);
    }
  });

  it('agrees with the full getter on every public field', async () => {
    const pub = await getPublicSeasonParticipants(EPB_SEASON_ID);
    const full = await getSeasonParticipants(EPB_SEASON_ID);

    expect(pub).toEqual(
      full.map((p) => ({
        id: p.id,
        name: p.name,
        gym_type: p.gym_type,
        avatar_url: p.avatar_url,
        core_types: p.core_types,
      })),
    );
  });

  it('getSeasonParticipantGymTypes reads two columns and no player join', async () => {
    const gymTypes = await getSeasonParticipantGymTypes(EPB_SEASON_ID);

    expect(queriesOn('season_participants')[0].select).toBe('player_id, gym_type');
    expect(gymTypes).toEqual({ p1: 'Fire', p2: 'Water', p3: null, p4: 'Grass' });
  });
});

describe('season reads', () => {
  it('list and detail reads use count embeds instead of child id arrays', async () => {
    const [list, detail] = await Promise.all([listSeasons(), getSeasonWithDetails(EPB_SEASON_ID)]);

    for (const q of queriesOn('seasons')) {
      expect(q.select).toMatch(/season_participants \( count \)/);
      expect(q.select).toMatch(/tournaments \( count \)/);
      expect(q.select).not.toMatch(/season_participants \( player_id \)|tournaments \( id \)/);
    }
    expect(detail).toMatchObject({ participant_count: 4, tournament_count: 2, ruleset_name: 'Liga-Regelwerk' });
    expect(list.find((s) => s.id === SAKURA_SEASON_ID)).toMatchObject({ participant_count: 4, tournament_count: 1 });
  });

  it('getSeasonFormatTypes resolves many seasons in one query (deduplicated)', async () => {
    const formats = await getSeasonFormatTypes([EPB_SEASON_ID, SAKURA_SEASON_ID, EPB_SEASON_ID]);

    expect(queriesOn('seasons')).toHaveLength(1);
    expect(queriesOn('seasons')[0].select).toBe('id, format_type');
    expect(Object.fromEntries(formats)).toEqual({
      [EPB_SEASON_ID]: 'evolution_point_buy',
      [SAKURA_SEASON_ID]: 'singles',
    });
    fake.current!.reset();
    expect((await getSeasonFormatTypes([])).size).toBe(0);
    expect(fake.current!.queries).toHaveLength(0);
  });

  it('getSeasonStageIds reads stage ids only', async () => {
    expect(await getSeasonStageIds(EPB_SEASON_ID)).toEqual(['e-stage-1', 'e-stage-2']);
    expect(queriesOn('tournaments')[0].select).toBe('id');
  });
});

describe('getAggregatesSummary', () => {
  it('reads the counter columns without move_counts; same counters as getAggregates', async () => {
    const summary = await getAggregatesSummary('tournament', 't-1');
    const full = await getAggregates('tournament', 't-1');

    const [summaryRead] = queriesOn('aggregates');
    expect(summaryRead.select).not.toContain('move_counts');
    expect(summaryRead.select).not.toContain('*');
    expect(summaryRead.orders).toEqual([{ column: 'total_appearances', ascending: false }]);
    expect(summary).toEqual(full.map((row) => ({ ...row, move_counts: {} })));
    expect(summary[0].move_counts).toEqual({});
  });

  it('global scope filters scope_id IS NULL', async () => {
    await getAggregatesSummary('all_time', null);
    expect(queriesOn('aggregates')[0].filters).toContainEqual({ op: 'is', column: 'scope_id', value: null });
  });
});

describe('getBattleStatsForTournaments', () => {
  it('no stage ids: no query', async () => {
    expect(await getBattleStatsForTournaments([])).toEqual([]);
    expect(fake.current!.queries).toHaveLength(0);
  });
});

describe('getLeagueSchedule', () => {
  it('standalone: stages, public participants and the season context, then ONE matches read', async () => {
    const schedule = await getLeagueSchedule(EPB_SEASON_ID);

    expect(queriesOn('matches')).toHaveLength(1);
    expect(queriesOn('season_participants')[0].select).not.toMatch(/players\s*\(\s*\*\s*\)/);
    // EPB: one season read and one evolution-points read, shared by both tables.
    expect(queriesOn('seasons')).toHaveLength(1);
    expect(queriesOn('evolution_tracker')).toHaveLength(1);
    expect(schedule.fixtures.map((f) => f.match.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']);
    // The order itself follows the active format pack's match points and tiebreak chain (the
    // private pack's moved copy pins it); here: every participant ranked once, rank changes balance.
    expect(schedule.standings.map((s) => s.player_id).sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(schedule.standings.every((s) => typeof s.rank_change === 'number')).toBe(true);
    expect(schedule.standings.reduce((sum, s) => sum + (s.rank_change ?? 0), 0)).toBe(0);
  });

  it('with a preload: only the matches read', async () => {
    const participants = await getPublicSeasonParticipants(SAKURA_SEASON_ID);
    fake.current!.reset();

    await getLeagueSchedule(SAKURA_SEASON_ID, {
      stages: [{ id: 's-stage-1', name: 'Gruppenphase' }],
      participants,
      context: { formatType: 'singles' },
    });

    expect(fake.current!.queries.map((q) => q.table)).toEqual(['matches']);
  });
});
