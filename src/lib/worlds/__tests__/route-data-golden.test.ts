/**
 * D36 fix 4 + the PII boundary: `buildWorldRouteData` against an in-memory
 * PostgREST (no network), compared with the output the PRE-CHANGE code
 * produced for the same fixture seasons (`world-route-data.golden.json`,
 * captured from the old implementation before the query reshaping).
 *
 * The contract must be deep-equal to that golden except for the participant
 * rows and the fixtures' matches, which now carry only the public fields
 * (`PublicParticipant`, `PublicMatch`) — so the 3D worlds receive exactly the
 * values they rendered before, and nothing private. The golden itself stays
 * the record of the old shape (it still holds the private columns).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import golden from './world-route-data.golden.json';
import { createFakeSupabase, type FakeSupabase } from './fake-postgrest';
import {
  buildFixtureTables,
  EPB_SEASON_ID,
  PLAYERS,
  PRIVATE_PLAYER_FIELDS,
  SAKURA_SEASON_ID,
} from './world-fixture-db';
import { toLineId } from '@/lib/draft/line-identity';
import { epbPack } from '@/lib/format-pack';
import { PUBLIC_PARTICIPANT_FIELDS } from '@/lib/players/public-player';
import { PRIVATE_MATCH_FIELDS, PUBLIC_MATCH_FIELDS } from '@/lib/match/public-match';
import { expectNoPrivateMatchData, PRIVATE_MATCH_SENTINELS } from '@/lib/match/__tests__/private-match-fields';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));

vi.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return fake.current!.client;
  },
}));

import { buildWorldRouteData } from '@/lib/worlds/route-data';
import { getSeasonWithDetails, getPublicSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getStagesBySeasonId } from '@/lib/supabase/queries/tournaments';

type GoldenFixture = { match: Record<string, unknown> } & Record<string, unknown>;
type GoldenPayload = {
  participants: Record<string, unknown>[];
  fixtures: GoldenFixture[];
} & Record<string, unknown>;

/**
 * The old payload with each participant projected onto the public participant
 * fields and each fixture's match onto the public match fields.
 */
function publicProjection(payload: GoldenPayload): GoldenPayload {
  return {
    ...payload,
    participants: payload.participants.map((row) =>
      Object.fromEntries(PUBLIC_PARTICIPANT_FIELDS.map((key) => [key, row[key]])),
    ),
    fixtures: payload.fixtures.map((fixture) => ({
      ...fixture,
      match: Object.fromEntries(PUBLIC_MATCH_FIELDS.map((key) => [key, fixture.match[key]])),
    })),
  };
}

/** The fixture tables with every match's admin-only columns set to sentinels. */
function tablesWithPrivateMatchValues() {
  const tables = buildFixtureTables();
  for (const row of tables.matches) {
    row.notes = PRIVATE_MATCH_SENTINELS.notes;
    row.submitter_id = PRIVATE_MATCH_SENTINELS.submitter_id;
    row.auto_confirm_at = PRIVATE_MATCH_SENTINELS.auto_confirm_at;
    row.confirmed_at = PRIVATE_MATCH_SENTINELS.confirmed_at;
  }
  return tables;
}

/** JSON round trip: the RSC boundary is JSON, so compare what would cross it. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

type RosterLineWire = Record<string, unknown> & {
  base_pokemon: string;
  stage2_pokemon: string;
  stage3_pokemon: string | null;
};

/**
 * Point-buy roster lines gained two additive fields after the golden was
 * captured: `line_id` and `overrides`. They are checked
 * on their own below; this strips them so everything else still compares
 * against the old capture.
 */
function withoutLineFields(payload: unknown): unknown {
  const data = payload as { rosterLines: RosterLineWire[] | null } & Record<string, unknown>;
  if (!data.rosterLines) return data;
  return {
    ...data,
    rosterLines: data.rosterLines.map((line) => {
      const { line_id: _lineId, overrides: _overrides, ...rest } = line;
      return rest;
    }),
  };
}

/**
 * The league row gained `language` (the league content language, i18n
 * G0-SCHEMA-LOC) after the golden was captured. It is checked on its own
 * below; this strips it so the rest of the row still compares.
 */
function withoutLeagueLanguage(payload: unknown): unknown {
  const data = payload as { league?: Record<string, unknown> | null } & Record<string, unknown>;
  if (!data.league) return data;
  const { language: _language, ...league } = data.league;
  return { ...data, league };
}

/** The current payload minus every field added after the golden was captured. */
function asGoldenShape(payload: unknown): unknown {
  return withSectionIdsOnly(withoutLeagueLanguage(withoutLineFields(payload)));
}

type StandingWire = Record<string, unknown> & { player_id: string; wins: number; draws: number; points: number };

/**
 * EPB standings points and order come from the active format pack (match points, tiebreak chain;
 * the private pack's moved copy pins the captured values). This keeps every other standings
 * field, compared per player: the golden was captured under the league's own values.
 */
function withPackFreeStandings(payload: unknown): unknown {
  const data = payload as { standings?: StandingWire[] | null } & Record<string, unknown>;
  if (!data.standings) return data;
  return {
    ...data,
    standings: [...data.standings]
      .sort((a, b) => a.player_id.localeCompare(b.player_id))
      .map(({ points: _points, rank_change: _rankChange, ...rest }) => rest),
  };
}

type WorldWire = { sections: { id: string }[] } & Record<string, unknown>;

/**
 * The world manifest's section labels changed after the golden was captured
 * (i18n D11, T19): the plaza's German `navLabel`s became the English source
 * labels plus a `navKey` that `WorldNav` translates for the viewer. The
 * section ids and order are still compared; the labels are pinned by
 * `registry-nav-labels.test.ts` instead.
 */
function withSectionIdsOnly(payload: unknown): unknown {
  const data = payload as { world?: WorldWire | null } & Record<string, unknown>;
  if (!data.world) return data;
  return { ...data, world: { ...data.world, sections: data.world.sections.map(({ id }) => ({ id })) } };
}

function privateValues(): string[] {
  const values: string[] = [];
  for (const player of PLAYERS) {
    for (const key of ['discord_id', 'auth_user_id', 'ban_reason', 'ps_username', 'champions_username'] as const) {
      const value = player[key];
      if (typeof value === 'string' && value.length > 0) values.push(value);
    }
  }
  return values;
}

beforeEach(() => {
  fake.current = createFakeSupabase(buildFixtureTables());
});

describe('buildWorldRouteData — golden parity with the pre-change output', () => {
  it.each([
    ['EPB (evoliga world)', EPB_SEASON_ID, 'epb'],
    ['singles (sakura world)', SAKURA_SEASON_ID, 'sakura'],
  ] as const)('%s: deep-equal to the old payload, participants public-only', async (_label, seasonId, key) => {
    const data = await buildWorldRouteData(seasonId);
    const project = key === 'epb' ? withPackFreeStandings : (payload: unknown) => payload;

    expect(project(asGoldenShape(wire(data)))).toEqual(
      project(withSectionIdsOnly(publicProjection(golden[key] as unknown as GoldenPayload))),
    );
  });

  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])('season %s: the league carries its content language', async (seasonId) => {
    const data = wire(await buildWorldRouteData(seasonId)) as { league: { language?: unknown } };

    expect(['en', 'de']).toContain(data.league.language);
  });

  it('EPB roster lines carry their stable line id and an overrides list', async () => {
    const data = wire(await buildWorldRouteData(EPB_SEASON_ID)) as { rosterLines: RosterLineWire[] };

    expect(data.rosterLines.length).toBeGreaterThan(0);
    for (const line of data.rosterLines) {
      expect(line.line_id).toBe(toLineId(line.base_pokemon, line.stage3_pokemon ?? line.stage2_pokemon));
      expect(Array.isArray(line.overrides)).toBe(true);
    }
  });

  it('the preloaded path (what the league page uses) builds the identical payload', async () => {
    const [league, stages, participants] = await Promise.all([
      getSeasonWithDetails(EPB_SEASON_ID),
      getStagesBySeasonId(EPB_SEASON_ID),
      getPublicSeasonParticipants(EPB_SEASON_ID),
    ]);
    fake.current!.reset();

    const data = await buildWorldRouteData(EPB_SEASON_ID, { league: league!, stages, participants });

    expect(withPackFreeStandings(asGoldenShape(wire(data)))).toEqual(
      withPackFreeStandings(withSectionIdsOnly(publicProjection(golden.epb as unknown as GoldenPayload))),
    );
  });

  it('EPB standings points follow the active format pack match points', async () => {
    const data = wire(await buildWorldRouteData(EPB_SEASON_ID)) as { standings: StandingWire[] };

    expect(data.standings.length).toBeGreaterThan(0);
    for (const row of data.standings) {
      expect(row.points).toBe(row.wins * epbPack.matchPoints.win + row.draws * epbPack.matchPoints.draw);
    }
  });

  it('the golden really is the old shape (it carried the private columns)', () => {
    // Guards the comparison above: the golden was captured with full rows.
    const oldParticipant = (golden.epb as unknown as GoldenPayload).participants[0];
    for (const key of PRIVATE_PLAYER_FIELDS) {
      expect(oldParticipant).toHaveProperty(key);
    }
    for (const key of ['epb', 'sakura'] as const) {
      const oldFixtures = (golden[key] as unknown as GoldenPayload).fixtures;
      expect(oldFixtures.length).toBeGreaterThan(0);
      for (const fixture of oldFixtures) {
        for (const field of PRIVATE_MATCH_FIELDS) expect(fixture.match).toHaveProperty(field);
      }
    }
  });
});

describe('buildWorldRouteData — no private player data crosses into the client payload', () => {
  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])('season %s', async (seasonId) => {
    const data = await buildWorldRouteData(seasonId);
    const serialized = JSON.stringify(data);

    for (const participant of data!.participants) {
      expect(Object.keys(participant).sort()).toEqual([...PUBLIC_PARTICIPANT_FIELDS].sort());
    }
    for (const value of privateValues()) {
      expect(serialized).not.toContain(value);
    }
    for (const key of ['discord_id', 'auth_user_id', 'ban_reason', 'suspended_until', 'is_admin', 'is_test_account']) {
      expect(serialized).not.toContain(`"${key}"`);
    }
    for (const key of PRIVATE_MATCH_FIELDS) {
      expect(serialized).not.toContain(`"${key}"`);
    }
  });

  it.each([EPB_SEASON_ID, SAKURA_SEASON_ID])(
    'season %s: fixture matches are PublicMatch, even when the rows carry admin notes',
    async (seasonId) => {
      fake.current = createFakeSupabase(tablesWithPrivateMatchValues());

      const data = await buildWorldRouteData(seasonId);

      expect(data!.fixtures.length).toBeGreaterThan(0);
      for (const fixture of data!.fixtures) {
        expect(Object.keys(fixture.match)).toEqual([...PUBLIC_MATCH_FIELDS]);
      }
      // What crosses the RSC boundary and what the public read cache stores.
      expectNoPrivateMatchData(JSON.parse(JSON.stringify(data)));
    },
  );

  it('the participant read selects public columns only (never players ( * ))', async () => {
    await buildWorldRouteData(EPB_SEASON_ID);

    const participantReads = fake.current!.queries.filter((q) => q.table === 'season_participants');
    expect(participantReads).toHaveLength(1);
    expect(participantReads[0].select).not.toMatch(/players\s*\(\s*\*\s*\)/);
    expect(participantReads[0].select).toMatch(/players\s*\(\s*id,\s*name,\s*avatar_url\s*\)/);
  });
});

describe('buildWorldRouteData — query budget', () => {
  it('with the page preload: one wave of ≤ 7 reads, one .in() for all stage matches', async () => {
    const [league, stages, participants] = await Promise.all([
      getSeasonWithDetails(EPB_SEASON_ID),
      getStagesBySeasonId(EPB_SEASON_ID),
      getPublicSeasonParticipants(EPB_SEASON_ID),
    ]);
    fake.current!.reset();

    await buildWorldRouteData(EPB_SEASON_ID, { league: league!, stages, participants });

    const tables = fake.current!.queries.map((q) => q.table).sort();
    expect(tables).toEqual([
      'draft_pools',
      'evolution_tracker',
      'format_rules',
      'matches',
      'point_buy_list_entries',
      // League groups (group tables; none in these fixture leagues).
      'season_groups',
      // Lead species, then the spec §7 visibility facts of those leads.
      'teams',
      'teams',
    ]);
    const matchesRead = fake.current!.queries.find((q) => q.table === 'matches')!;
    expect(matchesRead.filters).toEqual([
      { op: 'in', column: 'tournament_id', value: ['e-stage-1', 'e-stage-2'] },
    ]);
    // No season, stage or participant re-read; no evolution-points re-read.
    expect(tables).not.toContain('seasons');
    expect(tables).not.toContain('season_participants');
    expect(tables).not.toContain('tournaments');
  });

  it('standalone (no preload): 11 reads for EPB (incl. the spec §7 facts and league-groups reads), down from 16', async () => {
    await buildWorldRouteData(EPB_SEASON_ID);

    expect(golden.meta.epbQueries).toBe(16);
    expect(fake.current!.queries).toHaveLength(11);
  });

  it('non-EPB without a bound list skips the list read: 10 reads (incl. the spec §7 facts and league-groups reads), down from 11', async () => {
    await buildWorldRouteData(SAKURA_SEASON_ID);

    expect(golden.meta.sakuraQueries).toBe(11);
    expect(fake.current!.queries).toHaveLength(10);
    expect(fake.current!.queries.map((q) => q.table)).not.toContain('point_buy_list_entries');
  });

  it('spec §7: a lead whose team is not linked to a completed match names no ace', async () => {
    const tables = buildFixtureTables();
    for (const row of tables.teams) row.match = null;
    fake.current = createFakeSupabase(tables);

    const data = await buildWorldRouteData(SAKURA_SEASON_ID);

    expect(data!.teamAces).toEqual({});
    expect(JSON.stringify(data)).not.toContain('Garchomp');
  });

  it('teams are read as lead species plus their spec §7 facts only (no full sets)', async () => {
    await buildWorldRouteData(SAKURA_SEASON_ID);

    // Two reads: the season's rows and its stages' rows (where a played match team lives).
    const teamsReads = fake.current!.queries.filter((q) => q.table === 'teams');
    expect(teamsReads).toHaveLength(2);
    for (const read of teamsReads) {
      expect(read.select).toBe(
        'id, player_id, updated_at, lead_species:pokemon->0->>species, match:matches!teams_match_id_fkey(status), tournament:tournaments!teams_tournament_id_fkey(team_visibility)'
      );
    }
  });

  it('spec §7: a hidden_until_match stage team of a completed match names the ace (not only season rows)', async () => {
    const tables = buildFixtureTables();
    // Move every Sakura team to the stage, as upsertTeamForMatch stores a played match's team.
    for (const row of tables.teams) {
      if (row.season_id === SAKURA_SEASON_ID) {
        row.season_id = null;
        row.tournament_id = 's-stage-1';
        row.tournament = { team_visibility: 'hidden_until_match' };
      }
    }
    fake.current = createFakeSupabase(tables);

    const moved = await buildWorldRouteData(SAKURA_SEASON_ID);
    fake.current = createFakeSupabase(buildFixtureTables());
    const original = await buildWorldRouteData(SAKURA_SEASON_ID);

    expect(Object.keys(original!.teamAces).length).toBeGreaterThan(0);
    expect(moved!.teamAces).toEqual(original!.teamAces);
  });

  it('the season row is read with count embeds, not child id arrays', async () => {
    await buildWorldRouteData(EPB_SEASON_ID);

    const seasonRead = fake.current!.queries.find((q) => q.table === 'seasons')!;
    expect(seasonRead.select).toMatch(/season_participants \( count \)/);
    expect(seasonRead.select).toMatch(/tournaments \( count \)/);
  });
});
