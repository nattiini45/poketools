import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { expectNoPrivatePlayerData } from '@/lib/players/__tests__/private-player-fields';
import { insertLocalRuleset, deleteLocalRuleset } from '@/test/local-rulesets';

// LIVE-LOCAL test: it seeds rows into a LOCAL Supabase stack and runs the real
// query functions against real PostgREST, to prove the select shapes the unit
// tests mock (count embeds, JSON-path columns, related-column ordering,
// PGRST103) behave as the code assumes. Opt-in only, never in CI, and it never
// loads `.env`: every value comes from the command line.
//
//   LOCAL_SUPABASE_SHAPES=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon> SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/supabase/queries/__tests__/postgrest-shapes.local.test.ts
const optIn = process.env.LOCAL_SUPABASE_SHAPES === '1' && process.env.CI !== 'true';

const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless the Supabase URL points at a local stack. */
function assertLocalSupabaseUrl(raw: string | undefined): void {
  let host = '';
  try {
    host = new URL(raw ?? '').hostname;
  } catch {
    throw new Error('[postgrest-shapes.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL is not a valid URL');
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `[postgrest-shapes.local] refusing to run: NEXT_PUBLIC_SUPABASE_URL host "${host}" is not 127.0.0.1 or localhost`,
    );
  }
}

if (optIn) {
  // Before anything else runs, and before the client module (which builds the
  // client at import time) is loaded.
  assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') {
    throw new Error(
      '[postgrest-shapes.local] refusing to run: pass the LOCAL service_role key as SUPABASE_SERVICE_ROLE_KEY on the command line',
    );
  }
}

type ClientMod = typeof import('@/lib/supabase/client');
type PlayersMod = typeof import('@/lib/supabase/queries/players');
type SeasonsMod = typeof import('@/lib/supabase/queries/seasons');
type TeamsMod = typeof import('@/lib/supabase/queries/teams');
type TournamentsMod = typeof import('@/lib/supabase/queries/tournaments');
type ReplayMod = typeof import('@/lib/supabase/queries/replay-library');

let client: ClientMod['supabase'];
let players: PlayersMod;
let seasons: SeasonsMod;
let teams: TeamsMod;
let tournaments: TournamentsMod;
let replay: ReplayMod;

/** Evidence for the report: the raw PostgREST shape of each probed select. */
function logShape(label: string, value: unknown): void {
  console.info(`[shape] ${label}: ${JSON.stringify(value)}`);
}

// ── Fixture ids (pre-generated so cleanup knows them even after a failed insert)
const RUN = randomUUID().slice(0, 8);
const ids = {
  ruleset: randomUUID(),
  p1: randomUUID(),
  p2: randomUUID(),
  p3: randomUUID(),
  seasonA: randomUUID(),
  seasonB: randomUUID(),
  t1: randomUUID(),
  t2: randomUUID(),
  t3: randomUUID(),
  t4: randomUUID(),
  teamA: randomUUID(),
  teamB: randomUUID(),
  teamC: randomUUID(),
  round: randomUUID(),
  m1: randomUUID(),
  m2: randomUUID(),
  g1: randomUUID(),
  g2: randomUUID(),
  g3: randomUUID(),
  g4: randomUUID(),
};
// Every discord id carries "SECRET", so a leaked identity column fails the PII check by value too.
const discord = {
  p1: `shapes-${RUN}-SECRET-d1`,
  p2: `shapes-${RUN}-SECRET-d2`,
  p3: `shapes-${RUN}-SECRET-d3`,
};
const p3AuthUserId = randomUUID();
const rulesetName = `Shapes ${RUN} Ruleset`;
const seasonAName = `Shapes ${RUN} League`;
const replayUrl = (n: number) => `https://replay.pokemonshowdown.com/shapes-${RUN}-g${n}`;

/** Library replays (parsed Showdown games with a URL) before this run seeded any. */
let baselineReplayCount = 0;

describe.skipIf(!optIn)('PostgREST select shapes (local stack)', () => {
  beforeAll(async () => {
    assertLocalSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

    ({ supabase: client } = await import('@/lib/supabase/client'));
    players = await import('@/lib/supabase/queries/players');
    seasons = await import('@/lib/supabase/queries/seasons');
    teams = await import('@/lib/supabase/queries/teams');
    tournaments = await import('@/lib/supabase/queries/tournaments');
    replay = await import('@/lib/supabase/queries/replay-library');

    const baseline = await client
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('parsed', true)
      .eq('source', 'ps_replay')
      .neq('replay_url', '');
    if (baseline.error) throw baseline.error;
    baselineReplayCount = baseline.count ?? 0;

    const run = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) throw new Error(`[seed ${label}] ${JSON.stringify(error)}`);
    };

    await run('rulesets', insertLocalRuleset(client, { id: ids.ruleset, name: rulesetName }));
    await run(
      'players',
      client.from('players').insert([
        { id: ids.p1, name: `Shapes ${RUN} Ada`, discord_id: discord.p1, ps_username: `shapes_${RUN}_ada`, is_creator: true },
        { id: ids.p2, name: `Shapes ${RUN} Bram`, discord_id: discord.p2, ps_username: `shapes_${RUN}_bram` },
        {
          // Carries every private column's sentinel for the PII check.
          id: ids.p3,
          name: `Shapes ${RUN} Cyd`,
          discord_id: discord.p3,
          auth_user_id: p3AuthUserId,
          is_admin: true,
          is_test_account: true,
          status: 'suspended',
          suspended_until: '2099-12-31T00:00:00.000Z',
          ban_reason: 'SECRET moderation note',
          avatar_config: { marker: 'SECRET-avatar-config' },
        },
      ], { defaultToNull: false }),
    );
    await run(
      'seasons',
      client.from('seasons').insert([
        { id: ids.seasonA, name: seasonAName, format_type: 'singles', ruleset_id: ids.ruleset },
        { id: ids.seasonB, name: `Shapes ${RUN} Archived`, format_type: 'doubles', archived: true },
      ], { defaultToNull: false }),
    );
    await run(
      'season_participants',
      client.from('season_participants').insert([
        { season_id: ids.seasonA, player_id: ids.p1, gym_type: 'Fire' },
        { season_id: ids.seasonA, player_id: ids.p2 },
        { season_id: ids.seasonA, player_id: ids.p3 },
      ], { defaultToNull: false }),
    );
    await run(
      'tournaments',
      client.from('tournaments').insert([
        { id: ids.t1, name: `Shapes ${RUN} Stage 1`, season_id: ids.seasonA, stage_order: 0, bracket_type: 'round_robin', ruleset_id: ids.ruleset },
        { id: ids.t2, name: `Shapes ${RUN} Stage 2`, season_id: ids.seasonA, stage_order: 1, bracket_type: 'single_elim', ruleset_id: ids.ruleset },
        { id: ids.t3, name: `Shapes ${RUN} Open`, bracket_type: 'swiss', ruleset_id: ids.ruleset },
        { id: ids.t4, name: `Shapes ${RUN} Old Open`, bracket_type: 'double_elim', ruleset_id: ids.ruleset, archived: true },
      ], { defaultToNull: false }),
    );
    await run(
      'tournament_participants',
      client.from('tournament_participants').insert([
        { tournament_id: ids.t1, player_id: ids.p1 },
        { tournament_id: ids.t1, player_id: ids.p2 },
        { tournament_id: ids.t1, player_id: ids.p3 },
        { tournament_id: ids.t3, player_id: ids.p1 },
        { tournament_id: ids.t3, player_id: ids.p2 },
        { tournament_id: ids.t4, player_id: ids.p3 },
      ], { defaultToNull: false }),
    );
    await run(
      'resource_admins',
      client.from('resource_admins').insert([
        { player_id: ids.p1, resource_type: 'season', resource_id: ids.seasonA },
        { player_id: ids.p1, resource_type: 'tournament', resource_id: ids.t1 },
      ], { defaultToNull: false }),
    );
    await run(
      'teams',
      client.from('teams').insert([
        {
          id: ids.teamA,
          player_id: ids.p1,
          season_id: ids.seasonA,
          tournament_id: ids.t1,
          pokemon: [
            { species: 'Garchomp', item: 'Choice Scarf', moves: ['Earthquake', 'Outrage'] },
            { species: 'Rotom-Wash', item: 'Leftovers', moves: ['Hydro Pump'] },
          ],
        },
        { id: ids.teamB, player_id: ids.p2, season_id: ids.seasonA, pokemon: [] },
        { id: ids.teamC, player_id: ids.p3, season_id: ids.seasonA, pokemon: [{ species: '' }] },
      ], { defaultToNull: false }),
    );
    await run(
      'rounds',
      client.from('rounds').insert({ id: ids.round, tournament_id: ids.t1, name: 'Round 1', round_number: 1, best_of: 3 }),
    );
    await run(
      'matches',
      client.from('matches').insert([
        // Still being played: no date. The replay library treats it as the newest.
        { id: ids.m1, round_id: ids.round, tournament_id: ids.t1, player_1_id: ids.p1, player_2_id: ids.p2, status: 'in_progress', date_played: null },
        { id: ids.m2, round_id: ids.round, tournament_id: ids.t1, player_1_id: ids.p2, player_2_id: ids.p3, status: 'completed', winner_id: ids.p2, date_played: '2026-09-01T12:00:00.000Z' },
      ], { defaultToNull: false }),
    );
    await run(
      'games',
      client.from('games').insert([
        { id: ids.g1, match_id: ids.m1, game_number: 1, replay_url: replayUrl(1), source: 'ps_replay', parsed: true },
        { id: ids.g2, match_id: ids.m2, game_number: 1, replay_url: replayUrl(2), source: 'ps_replay', parsed: true },
        { id: ids.g3, match_id: ids.m2, game_number: 2, replay_url: replayUrl(3), source: 'ps_replay', parsed: true },
        // Not a library replay (manual source): must not count.
        { id: ids.g4, match_id: ids.m2, game_number: 3, replay_url: replayUrl(4), source: 'manual', parsed: true },
      ], { defaultToNull: false }),
    );
  }, 60000);

  afterAll(async () => {
    if (!client) return;
    const failures: string[] = [];
    const del = async (label: string, op: PromiseLike<{ error: unknown }>) => {
      const { error } = await op;
      if (error) failures.push(`${label}: ${JSON.stringify(error)}`);
    };
    const tournamentIds = [ids.t1, ids.t2, ids.t3, ids.t4];
    const seasonIds = [ids.seasonA, ids.seasonB];
    const playerIds = [ids.p1, ids.p2, ids.p3];

    await del('games', client.from('games').delete().in('id', [ids.g1, ids.g2, ids.g3, ids.g4]));
    await del('matches', client.from('matches').delete().in('id', [ids.m1, ids.m2]));
    await del('rounds', client.from('rounds').delete().eq('id', ids.round));
    await del('teams', client.from('teams').delete().in('id', [ids.teamA, ids.teamB, ids.teamC]));
    await del('tournament_participants', client.from('tournament_participants').delete().in('tournament_id', tournamentIds));
    await del('season_participants', client.from('season_participants').delete().in('season_id', seasonIds));
    await del('resource_admins', client.from('resource_admins').delete().in('player_id', playerIds));
    await del('tournaments', client.from('tournaments').delete().in('id', tournamentIds));
    await del('seasons', client.from('seasons').delete().in('id', seasonIds));
    await del('rulesets', deleteLocalRuleset(client, ids.ruleset));
    await del('players', client.from('players').delete().in('id', playerIds));

    // Prove nothing seeded survived.
    const leftovers = await Promise.all([
      client.from('players').select('id', { count: 'exact', head: true }).in('id', playerIds),
      client.from('seasons').select('id', { count: 'exact', head: true }).in('id', seasonIds),
      client.from('tournaments').select('id', { count: 'exact', head: true }).in('id', tournamentIds),
      client.from('ruleset_definition_versions').select('id', { count: 'exact', head: true }).eq('id', ids.ruleset),
      client.from('games').select('id', { count: 'exact', head: true }).in('id', [ids.g1, ids.g2, ids.g3, ids.g4]),
      client.from('teams').select('id', { count: 'exact', head: true }).in('id', [ids.teamA, ids.teamB, ids.teamC]),
    ]);
    const remaining = leftovers.reduce((sum, r) => sum + (r.count ?? 0), 0);
    console.info(`[cleanup] seeded rows remaining after afterAll: ${remaining}`);
    if (failures.length > 0) throw new Error(`[cleanup] ${failures.join('; ')}`);
    expect(remaining).toBe(0);
  }, 60000);

  // ── 1. Session read: resource_admins(count) embed ───────────────────────
  describe('1. session read (SESSION_PLAYER_COLUMNS)', () => {
    it('embeds resource_admins as [{ count: N }] and maps it to isResourceAdmin', async () => {
      const raw = await client.from('players').select(players.SESSION_PLAYER_COLUMNS).in('id', [ids.p1, ids.p2]);
      expect(raw.error).toBeNull();
      logShape('players.select(SESSION_PLAYER_COLUMNS)', raw.data);
      const byId = new Map((raw.data ?? []).map((row) => [row.id, row]));
      expect(byId.get(ids.p1)?.resource_admins).toEqual([{ count: 2 }]);
      expect(byId.get(ids.p2)?.resource_admins).toEqual([{ count: 0 }]);

      const row1 = await players.getSessionPlayerRowByIdentity('discord', discord.p1);
      logShape('getSessionPlayerRowByIdentity(discord, p1)', row1);
      expect(row1).not.toBeNull();
      expect(row1!.resource_admin_count).toBe(2);
      expect(Object.keys(row1!).sort()).toEqual(
        ['avatar_url', 'champions_username', 'id', 'is_admin', 'is_creator', 'name', 'ps_username', 'resource_admin_count', 'status'],
      );
      const session1 = players.toSessionPlayer(row1!);
      logShape('toSessionPlayer(p1)', session1);
      expect(session1.isResourceAdmin).toBe(true);
      expect(session1.isCreator).toBe(true);
      expect(session1.status).toBe('active');
    }, 30000);

    it('reports 0 and isResourceAdmin false for a player with no resource_admins rows', async () => {
      const row2 = await players.getSessionPlayerRowByIdentity('discord', discord.p2);
      logShape('getSessionPlayerRowByIdentity(discord, p2)', row2);
      expect(row2).not.toBeNull();
      expect(row2!.resource_admin_count).toBe(0);
      expect(players.toSessionPlayer(row2!).isResourceAdmin).toBe(false);
    }, 30000);

    it('reads the credentials identity column and a non-active status', async () => {
      const row3 = await players.getSessionPlayerRowByIdentity('credentials', p3AuthUserId);
      logShape('getSessionPlayerRowByIdentity(credentials, p3)', row3);
      expect(row3).not.toBeNull();
      expect(row3!.id).toBe(ids.p3);
      expect(row3!.status).toBe('suspended');
      expect(row3!.is_admin).toBe(true);
      expect(row3!.resource_admin_count).toBe(0);
      expect(await players.getSessionPlayerRowByIdentity('discord', `shapes-${RUN}-nobody`)).toBeNull();
    }, 30000);
  });

  // ── 2. Seasons: SEASON_DETAILS_SELECT count embeds ──────────────────────
  describe('2. seasons (SEASON_DETAILS_SELECT)', () => {
    it('returns [{ count }] embeds on the wire', async () => {
      // Mirror of SEASON_DETAILS_SELECT's embeds (the constant is module-private).
      const raw = await client
        .from('seasons')
        .select('id, rulesets:ruleset_definition_versions ( name:name_text ), season_participants ( count ), tournaments ( count )')
        .in('id', [ids.seasonA, ids.seasonB]);
      expect(raw.error).toBeNull();
      logShape('seasons.select(rulesets(name), season_participants(count), tournaments(count))', raw.data);
      const byId = new Map((raw.data ?? []).map((row) => [row.id, row]));
      expect(byId.get(ids.seasonA)).toMatchObject({
        rulesets: { name: rulesetName },
        season_participants: [{ count: 3 }],
        tournaments: [{ count: 2 }],
      });
      expect(byId.get(ids.seasonB)).toMatchObject({
        rulesets: null,
        season_participants: [{ count: 0 }],
        tournaments: [{ count: 0 }],
      });
    }, 30000);

    it('list and detail getters report participant and stage counts', async () => {
      const active = await seasons.listSeasons();
      const a = active.find((s) => s.id === ids.seasonA);
      logShape('listSeasons() seasonA details', a && pickDetails(a));
      expect(a).toMatchObject({ ruleset_name: rulesetName, participant_count: 3, tournament_count: 2 });
      expect(active.some((s) => s.id === ids.seasonB)).toBe(false);

      const archived = await seasons.listArchivedSeasons();
      const b = archived.find((s) => s.id === ids.seasonB);
      logShape('listArchivedSeasons() seasonB details', b && pickDetails(b));
      expect(b).toMatchObject({ ruleset_name: null, participant_count: 0, tournament_count: 0 });

      const byIds = await seasons.listSeasonsByIds([ids.seasonA, ids.seasonB]);
      expect(byIds.map(pickDetails).sort((x, y) => x.id.localeCompare(y.id))).toEqual(
        [
          { id: ids.seasonA, ruleset_name: rulesetName, participant_count: 3, tournament_count: 2 },
          { id: ids.seasonB, ruleset_name: null, participant_count: 0, tournament_count: 0 },
        ].sort((x, y) => x.id.localeCompare(y.id)),
      );

      const detail = await seasons.getSeasonWithDetails(ids.seasonA);
      logShape('getSeasonWithDetails(seasonA) details', detail && pickDetails(detail));
      expect(detail).toMatchObject({ name: seasonAName, ruleset_name: rulesetName, participant_count: 3, tournament_count: 2 });
    }, 30000);
  });

  // ── 3. Teams: lead_species JSON path ────────────────────────────────────
  describe('3. teams (lead_species:pokemon->0->>species)', () => {
    it('returns the lead species, null for an empty team, "" for a blank species', async () => {
      const raw = await client
        .from('teams')
        .select('id, lead_species:pokemon->0->>species')
        .in('id', [ids.teamA, ids.teamB, ids.teamC]);
      expect(raw.error).toBeNull();
      logShape('teams.select(lead_species:pokemon->0->>species)', raw.data);

      const leads = await teams.listSeasonTeamLeadsWithFacts(ids.seasonA, []);
      logShape('listSeasonTeamLeadsWithFacts(seasonA, [])', leads);
      const byId = new Map(leads.map((lead) => [lead.id, lead]));
      expect(byId.get(ids.teamA)).toMatchObject({ player_id: ids.p1, lead_species: 'Garchomp' });
      expect(byId.get(ids.teamB)).toMatchObject({ player_id: ids.p2, lead_species: null });
      expect(byId.get(ids.teamC)).toMatchObject({ player_id: ids.p3, lead_species: '' });
      for (const lead of leads) {
        expect(Object.keys(lead).sort()).toEqual(['facts', 'id', 'lead_species', 'player_id', 'updated_at']);
        expect(Object.keys(lead.facts).sort()).toEqual(['match_status', 'tournament_visibility']);
      }

      // Same rows as the full read.
      const full = await teams.listTeamsBySeason(ids.seasonA);
      expect(leads.map((l) => l.id).sort()).toEqual(full.map((t) => t.id).sort());
    }, 30000);
  });

  // ── 4. Tournaments: tournament_participants(count) embeds ───────────────
  describe('4. tournaments (tournament_participants ( count ))', () => {
    const expected: Record<string, number> = {};
    beforeAll(() => {
      expected[ids.t1] = 3;
      expected[ids.t2] = 0;
      expected[ids.t3] = 2;
      expected[ids.t4] = 1;
    });

    it('returns [{ count }] embeds on the wire', async () => {
      const raw = await client
        .from('tournaments')
        .select('id, rulesets:ruleset_definition_versions ( name:name_text ), seasons ( name ), tournament_participants ( count )')
        .in('id', [ids.t1, ids.t2, ids.t3, ids.t4]);
      expect(raw.error).toBeNull();
      logShape('tournaments.select(rulesets(name), seasons(name), tournament_participants(count))', raw.data);
      for (const row of raw.data ?? []) {
        expect(row.tournament_participants).toEqual([{ count: expected[row.id] }]);
      }
    }, 30000);

    it('list getters report the participant counts', async () => {
      const all = await tournaments.listAllTournaments();
      const ours = all.filter((t) => t.id in expected);
      logShape('listAllTournaments() ours', ours.map(pickTournament));
      expect(ours).toHaveLength(4);
      for (const t of ours) expect(t.participant_count).toBe(expected[t.id]);

      const standalone = (await tournaments.listTournaments()).filter((t) => t.id in expected);
      logShape('listTournaments() ours', standalone.map(pickTournament));
      expect(standalone.map(pickTournament)).toEqual([
        { id: ids.t3, participant_count: 2, season_name: null, ruleset_name: rulesetName },
      ]);

      const archived = (await tournaments.listArchivedTournaments()).filter((t) => t.id in expected);
      logShape('listArchivedTournaments() ours', archived.map(pickTournament));
      expect(archived.map(pickTournament)).toEqual([
        { id: ids.t4, participant_count: 1, season_name: null, ruleset_name: rulesetName },
      ]);

      const byIds = await tournaments.listTournamentsByIds([ids.t1, ids.t2, ids.t3, ids.t4]);
      expect(byIds).toHaveLength(4);
      for (const t of byIds) expect(t.participant_count).toBe(expected[t.id]);

      const stages = await tournaments.getStagesBySeasonId(ids.seasonA);
      logShape('getStagesBySeasonId(seasonA)', stages.map(pickTournament));
      expect(stages.map(pickTournament)).toEqual([
        { id: ids.t1, participant_count: 3, season_name: seasonAName, ruleset_name: rulesetName },
        { id: ids.t2, participant_count: 0, season_name: seasonAName, ruleset_name: rulesetName },
      ]);

      const detail = await tournaments.getTournamentWithDetails(ids.t1);
      logShape('getTournamentWithDetails(t1)', detail && { ...pickTournament(detail), season_format_type: detail.season_format_type });
      expect(detail).toMatchObject({ participant_count: 3, season_name: seasonAName, season_format_type: 'singles', ruleset_name: rulesetName });
    }, 30000);
  });

  // ── 5. Replay library: matches(date_played) ordering + exact count ──────
  describe('5. replay library page (order by matches(date_played))', () => {
    const seeded = () => [replayUrl(1), replayUrl(2), replayUrl(3)];

    it('sorts the null-date match first when descending, last when ascending, with an exact count', async () => {
      const expectedTotal = baselineReplayCount + 3;
      const perPage = expectedTotal + 10;

      const desc = await replay.listReplayLibraryPage({ page: 1, perPage, ascending: false });
      logShape('listReplayLibraryPage(desc) summary', {
        total: desc.total,
        page: desc.page,
        baselineReplayCount,
        order: desc.rows.filter((r) => seeded().includes(r.replayUrl)).map((r) => ({ url: r.replayUrl.slice(-3), date: r.date, round: r.round, league: r.league })),
      });
      expect(desc.total).toBe(expectedTotal);
      expect(desc.page).toBe(1);
      const di = (n: number) => desc.rows.findIndex((r) => r.replayUrl === replayUrl(n));
      expect(di(1)).toBeGreaterThanOrEqual(0);
      expect(di(2)).toBeGreaterThanOrEqual(0);
      expect(di(3)).toBeGreaterThanOrEqual(0);
      expect(di(1)).toBeLessThan(di(2));
      expect(di(1)).toBeLessThan(di(3));
      expect(desc.rows.some((r) => r.replayUrl === replayUrl(4))).toBe(false);
      const g1Row = desc.rows[di(1)];
      expect(g1Row).toMatchObject({
        league: seasonAName,
        round: 'Round 1',
        matchNumber: 1,
        player1Name: `Shapes ${RUN} Ada`,
        player2Name: `Shapes ${RUN} Bram`,
        matchUrl: `/tournaments/${ids.t1}/matches/${ids.m1}`,
      });
      expect(desc.rows[di(2)].date).toBe('2026-09-01T12:00:00+00:00');

      const asc = await replay.listReplayLibraryPage({ page: 1, perPage, ascending: true });
      expect(asc.total).toBe(expectedTotal);
      const ai = (n: number) => asc.rows.findIndex((r) => r.replayUrl === replayUrl(n));
      logShape('listReplayLibraryPage(asc) seeded order', asc.rows.filter((r) => seeded().includes(r.replayUrl)).map((r) => r.replayUrl.slice(-3)));
      expect(ai(1)).toBeGreaterThan(ai(2));
      expect(ai(1)).toBeGreaterThan(ai(3));

      // The chunked full read agrees on the count.
      const all = await replay.listReplayLibraryRows();
      expect(all).toHaveLength(expectedTotal);
    }, 30000);
  });

  // ── 6. PGRST103: page past the end ──────────────────────────────────────
  describe('6. replay page past the end (PGRST103)', () => {
    it('PostgREST answers PGRST103 for an offset past a counted result', async () => {
      const total = baselineReplayCount + 3;
      const raw = await client
        .from('games')
        .select('id', { count: 'exact' })
        .eq('parsed', true)
        .eq('source', 'ps_replay')
        .neq('replay_url', '')
        .range(total + 100, total + 101);
      logShape('games range past end', { status: raw.status, code: raw.error?.code ?? null, count: raw.count, data: raw.data });
      expect(raw.error?.code).toBe('PGRST103');
    }, 30000);

    it('listReplayLibraryPage does not throw and serves the last page instead', async () => {
      const total = baselineReplayCount + 3;
      const perPage = 2;
      const lastPage = Math.max(1, Math.ceil(total / perPage));
      const result = await replay.listReplayLibraryPage({ page: 999, perPage, ascending: false });
      logShape('listReplayLibraryPage(page 999, perPage 2)', { page: result.page, total: result.total, rows: result.rows.length });
      expect(result.page).toBe(lastPage);
      expect(result.total).toBe(total);
      expect(result.rows).toHaveLength(total - (lastPage - 1) * perPage);
    }, 30000);
  });

  // ── PII: public season participants ─────────────────────────────────────
  describe('PII: getPublicSeasonParticipants', () => {
    it('carries no private player column', async () => {
      const raw = await client
        .from('season_participants')
        .select('player_id, gym_type, core_types, players ( id, name, avatar_url )')
        .eq('season_id', ids.seasonA);
      expect(raw.error).toBeNull();
      logShape('season_participants.select(players(id, name, avatar_url))', raw.data);
      expectNoPrivatePlayerData(raw.data);

      const rows = await seasons.getPublicSeasonParticipants(ids.seasonA);
      logShape('getPublicSeasonParticipants(seasonA)', rows);
      expect(rows).toHaveLength(3);
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(['avatar_url', 'core_types', 'gym_type', 'id', 'name']);
      expect(rows.find((r) => r.id === ids.p1)?.gym_type).toBe('Fire');
      expectNoPrivatePlayerData(rows);

      // Control: the full admin read does carry the sentinels, so the check above is not vacuous.
      const full = await seasons.getSeasonParticipants(ids.seasonA);
      expect(JSON.stringify(full)).toContain('SECRET');
    }, 30000);
  });
});

function pickDetails(s: { id: string; ruleset_name: string | null; participant_count: number; tournament_count: number }) {
  return { id: s.id, ruleset_name: s.ruleset_name, participant_count: s.participant_count, tournament_count: s.tournament_count };
}

function pickTournament(t: { id: string; participant_count: number; season_name: string | null; ruleset_name: string }) {
  return { id: t.id, participant_count: t.participant_count, season_name: t.season_name, ruleset_name: t.ruleset_name };
}
