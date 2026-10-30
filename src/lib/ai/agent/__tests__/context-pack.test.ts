import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MatchWithPlayers } from '@/types/match';
import type { Team } from '@/types/team';

// ─── Mocks (hoisted so the vi.mock factories can reference them) ─────

const h = vi.hoisted(() => ({
  profileResult: { data: null as Record<string, unknown> | null, error: null as unknown },
  getUpcomingMatches: vi.fn(),
  getMatchesByPlayer: vi.fn(),
  getMatchById: vi.fn(),
  getH2HBetweenPlayers: vi.fn(),
  getTeamById: vi.fn(),
  getTournamentById: vi.fn(),
  getStagesBySeasonId: vi.fn(),
  getSeasonById: vi.fn(),
  getParticipantCore: vi.fn(),
  getRulesetById: vi.fn(),
  readExposedRuleset: vi.fn(),
  getOpponentBattleStatsInTournament: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(h.profileResult),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/supabase/queries/matches', () => ({
  getUpcomingMatches: h.getUpcomingMatches,
  getMatchesByPlayer: h.getMatchesByPlayer,
  getMatchById: h.getMatchById,
  getH2HBetweenPlayers: h.getH2HBetweenPlayers,
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getTeamById: h.getTeamById,
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: h.getTournamentById,
  getStagesBySeasonId: h.getStagesBySeasonId,
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: h.getSeasonById,
  getParticipantCore: h.getParticipantCore,
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: h.getRulesetById,
}));

vi.mock('@/lib/ruleset-studio/exposure', () => ({
  readExposedRuleset: h.readExposedRuleset,
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getOpponentBattleStatsInTournament: h.getOpponentBattleStatsInTournament,
}));

import { buildContextPack, renderContextPack } from '../context-pack';

// ─── Fixtures ────────────────────────────────────────────────────────

const PLAYER = 'P1';

function match(partial: Record<string, unknown>): MatchWithPlayers {
  return {
    id: 'M0',
    tournament_id: 'T1',
    player_1_id: 'P1',
    player_2_id: 'P2',
    player_1_name: 'Me',
    player_2_name: 'Rival',
    winner_id: null,
    status: 'scheduled',
    scheduled_at: null,
    date_played: null,
    games: [],
    ...partial,
  } as unknown as MatchWithPlayers;
}

function team(partial: Record<string, unknown>): Team {
  return {
    id: 'TEAM1',
    player_id: PLAYER,
    name: 'My Team',
    tournament_id: 'T1',
    season_id: null,
    match_id: null,
    pokemon: [{ species: 'Garchomp' }, { species: 'Rotom-Wash' }],
    ...partial,
  } as unknown as Team;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.profileResult = {
    data: {
      favorite_pokemon: ['Garchomp'],
      preferred_formats: ['gen9ou'],
      play_style_tags: ['hyper offense'],
      default_persona: 'linden_teambuilding',
    },
    error: null,
  };
  h.getUpcomingMatches.mockResolvedValue([
    match({ id: 'M1', player_2_id: 'P2', player_2_name: 'Rival', status: 'scheduled', scheduled_at: '2026-07-01' }),
  ]);
  h.getMatchesByPlayer.mockResolvedValue([
    match({
      id: 'M9',
      status: 'completed',
      player_2_id: 'P3',
      player_2_name: 'Old Foe',
      winner_id: 'P1',
      date_played: '2026-06-01',
      games: [{ winner_id: 'P1' }, { winner_id: 'P3' }, { winner_id: 'P1' }],
    }),
  ]);
  h.getH2HBetweenPlayers.mockResolvedValue([
    match({ id: 'H1', winner_id: 'P1', status: 'completed' }),
    match({ id: 'H2', winner_id: 'P2', status: 'completed' }),
  ]);
  h.getTeamById.mockResolvedValue(team({}));

  // Plan-mode scope defaults (only exercised when ruleset_id / upcoming_match_id
  // are forwarded — the no-context tests never reach these).
  h.getTournamentById.mockResolvedValue({
    id: 'T1',
    season_id: 'S1',
    ruleset_id: 'CUSTOM',
    bracket_type: 'round_robin',
    description: null,
  });
  h.getSeasonById.mockResolvedValue({
    id: 'S1',
    name: 'Sample Custom League',
    description: 'Mostly NFE; only 1 fully-evolved from ZU.',
    ruleset_id: 'BASE',
  });
  // The phase's pin (an immutable ruleset version) is what the pack reads.
  h.getRulesetById.mockResolvedValue({
    id: 'CUSTOM',
    name: 'Sample Custom League',
    base_format: 'gen9ru',
    clauses: [],
    bans: { pokemon: [], moves: [], items: [], abilities: [] },
    additions: { pokemon: [] },
    custom_rules_string: '',
    team_constraints: {
      type_quotas: { source: 'player_core', min_per_type: 2, allow_multi_count: true },
    },
  });
  h.getParticipantCore.mockResolvedValue(['Grass', 'Ground', 'Poison']);
  h.getStagesBySeasonId.mockResolvedValue([{ id: 'T1' }, { id: 'T2' }]);
  h.readExposedRuleset.mockResolvedValue(null);
  h.getOpponentBattleStatsInTournament.mockResolvedValue([]);
});

describe('buildContextPack', () => {
  it('assembles every section into a JSON-serialisable pack', async () => {
    const pack = await buildContextPack(PLAYER, { team_id: 'TEAM1', format: 'gen9ou' });

    expect(pack.player_id).toBe(PLAYER);
    expect(pack.format).toBe('gen9ou');

    expect(pack.profile).toEqual({
      favorite_pokemon: ['Garchomp'],
      preferred_formats: ['gen9ou'],
      play_style_tags: ['hyper offense'],
      default_persona: 'linden_teambuilding',
    });

    expect(pack.upcoming_matches).toHaveLength(1);
    expect(pack.upcoming_matches?.[0]).toMatchObject({
      match_id: 'M1',
      opponent_name: 'Rival',
      status: 'scheduled',
    });

    expect(pack.recent_results).toHaveLength(1);
    expect(pack.recent_results?.[0]).toMatchObject({
      opponent_name: 'Old Foe',
      result: 'win',
      score: '2-1',
    });

    expect(pack.head_to_head).toEqual({
      opponent_name: 'Rival',
      wins: 1,
      losses: 1,
      matches: 2,
    });

    expect(pack.active_team).toMatchObject({
      team_id: 'TEAM1',
      name: 'My Team',
      pokemon: ['Garchomp', 'Rotom-Wash'],
    });

    // Must be JSON-serialisable (no class instances / cycles).
    expect(() => JSON.stringify(pack)).not.toThrow();
  });

  it('skips the active team when no team_id is supplied', async () => {
    const pack = await buildContextPack(PLAYER, {});
    expect(pack.active_team).toBeNull();
    expect(h.getTeamById).not.toHaveBeenCalled();
  });

  it('drops a team owned by another player: no active team and no species in the prompt', async () => {
    h.getTeamById.mockResolvedValueOnce(
      team({ id: 'FOREIGN', player_id: 'P2', name: 'Rival Plan', pokemon: [{ species: 'Kingambit' }] }),
    );

    const pack = await buildContextPack(PLAYER, { team_id: 'FOREIGN' });

    expect(pack.active_team).toBeNull();
    const md = renderContextPack(pack);
    expect(md).not.toContain('Kingambit');
    expect(md).not.toContain('Rival Plan');
    expect(md).not.toContain('Active team');
  });

  it('logs a failed active-team read and degrades it to an explicit null', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('teams read failed');
    h.getTeamById.mockRejectedValueOnce(failure);

    const pack = await buildContextPack(PLAYER, { team_id: 'TEAM1' });

    expect(pack.active_team).toBeNull();
    expect(consoleError).toHaveBeenCalledWith('[ai/agent/context-pack] active team read failed:', failure);
    expect(renderContextPack(pack)).not.toContain('Active team');
    // The other sections still resolved.
    expect(pack.profile).not.toBeNull();
    consoleError.mockRestore();
  });

  it('soft-fails a throwing section to null without sinking the pack', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('db down');
    h.getMatchesByPlayer.mockRejectedValueOnce(failure);

    const pack = await buildContextPack(PLAYER, { team_id: 'TEAM1' });

    // The original error is logged with its section, never swallowed silently.
    expect(consoleError).toHaveBeenCalledWith('[ai/agent/context-pack] recent matches read failed:', failure);
    consoleError.mockRestore();

    // The failing section is null...
    expect(pack.recent_results).toBeNull();
    // ...but the rest of the pack still resolved.
    expect(pack.profile).not.toBeNull();
    expect(pack.upcoming_matches).toHaveLength(1);
    expect(pack.head_to_head).not.toBeNull();
  });
});

describe('renderContextPack', () => {
  it('renders a terse markdown block with present sections only', async () => {
    const pack = await buildContextPack(PLAYER, { team_id: 'TEAM1', format: 'gen9ou' });
    const md = renderContextPack(pack);

    expect(md).toContain('## Player context');
    expect(md).toContain('Garchomp');
    expect(md).toContain('Active format: gen9ou');
    expect(md).toContain('vs Rival');
    expect(md).toContain('H2H vs Rival: 1-1');
    expect(md).toContain('Recent results');
  });

  it('shows a fallback line when nothing is available', () => {
    const md = renderContextPack({
      player_id: PLAYER,
      profile: null,
      upcoming_matches: null,
      recent_results: null,
      head_to_head: null,
      active_team: null,
      league: null,
      player_recent_pokemon: null,
      opponent_scout: null,
    });
    expect(md).toContain('no context available');
  });

  it('renders the league section generically from whatever ruleset is supplied', () => {
    const md = renderContextPack({
      player_id: PLAYER,
      profile: null,
      upcoming_matches: null,
      recent_results: null,
      head_to_head: null,
      active_team: null,
      player_recent_pokemon: null,
      opponent_scout: null,
      league: {
        league_name: 'Summer Monotype Cup',
        season_id: null,
        description: 'All Pokémon on a team must share a single type.',
        ruleset_name: 'Summer Monotype Cup',
        ruleset_version: 2,
        ruleset_id: 'rs-monotype',
        base_format: 'gen9ou',
        clauses: ['Species Clause'],
        bans: { pokemon: ['Kingambit'], moves: [], items: [], abilities: ['Moody'] },
        allow: { pokemon: null, moves: ['Surf', 'Ice Beam'], items: null, abilities: null },
        additions: [],
        custom_rules: null,
        team_constraints: {
          type_quotas: { source: 'fixed', fixed_types: ['Water'], min_per_type: 6, allow_multi_count: true },
        },
        player_core: null,
      },
    });
    expect(md).toContain('Summer Monotype Cup');
    expect(md).toContain('All Pokémon on a team must share a single type');
    expect(md).toContain('Banned Pokémon: Kingambit');
    // The ruleset is a pinned version: the version, the banned abilities and an allowlist are part of the binding rules.
    expect(md).toContain('- Ruleset: Summer Monotype Cup, version 2');
    expect(md).toContain('Banned abilities: Moody');
    expect(md).toContain('- Allowlist: ONLY these moves are legal (2): Surf, Ice Beam');
    expect(md).not.toContain('ONLY these Pokémon');
    expect(md).toContain('Type quota');
    // The effective ruleset id is surfaced so the assistant can pass it to buildTeam.
    expect(md).toContain('Ruleset id (pass this exact id as ruleset_id to buildTeam): rs-monotype');
    // The rendering is data-driven — never pinned to a specific league name.
    expect(md).not.toContain('Sample Custom League');
  });
});

describe('buildContextPack — league-scoped (plan mode)', () => {
  beforeEach(() => {
    // Recent matches span the CURRENT league (T1) and a FOREIGN league (T_OLD).
    h.getMatchesByPlayer.mockResolvedValue([
      match({
        id: 'M_CUR',
        status: 'completed',
        tournament_id: 'T1',
        player_2_id: 'P2',
        player_2_name: 'League Foe',
        winner_id: 'P1',
        games: [{ winner_id: 'P1' }, { winner_id: 'P1' }],
      }),
      match({
        id: 'M_OLD',
        status: 'completed',
        tournament_id: 'T_OLD',
        player_2_id: 'P9',
        player_2_name: 'Old League Foe',
        winner_id: 'P9',
        games: [{ winner_id: 'P9' }],
      }),
    ]);
    // Opponent (P2) brings Clodsire; the player (P1) brings Vileplume.
    h.getOpponentBattleStatsInTournament.mockImplementation(async (subjectId: string) =>
      subjectId === 'P2'
        ? [{ game_id: 'g1', pokemon_name: 'Clodsire', was_brought: true, was_lead: true, kos_dealt: 2 }]
        : [{ game_id: 'g2', pokemon_name: 'Vileplume', was_brought: true, was_lead: false, kos_dealt: 1 }],
    );
  });

  const planContext = { upcoming_match_id: 'M1', ruleset_id: 'BASE', format: 'gen9ru' };

  it('scopes recent results to the season and excludes other leagues', async () => {
    const pack = await buildContextPack(PLAYER, planContext);
    expect(pack.recent_results).toHaveLength(1);
    expect(pack.recent_results?.[0]).toMatchObject({ opponent_name: 'League Foe', result: 'win', score: '2-0' });
  });

  it("surfaces the phase's pinned ruleset id and the assigned core", async () => {
    const pack = await buildContextPack(PLAYER, planContext);
    expect(pack.league?.ruleset_id).toBe('CUSTOM');
    expect(pack.league?.player_core).toEqual(['Grass', 'Ground', 'Poison']);
    // The league id scopes the roster and Evolution Point Buy checks of validateTeam.
    expect(pack.league?.season_id).toBe('S1');
    const md = renderContextPack(pack);
    expect(md).toContain('Ruleset id (pass this exact id as ruleset_id to buildTeam): CUSTOM');
  });

  it('includes the opponent and the player recent Pokémon, with the opponent id for getMatchHistory', async () => {
    const pack = await buildContextPack(PLAYER, planContext);
    expect(pack.opponent_scout?.pokemon?.[0]?.pokemon).toBe('Clodsire');
    expect(pack.player_recent_pokemon?.pokemon?.[0]?.pokemon).toBe('Vileplume');

    const md = renderContextPack(pack);
    expect(md).toContain("Rival's recent Pokémon in this league");
    expect(md).toContain('Clodsire');
    expect(md).toContain('Your recent Pokémon in this league');
    expect(md).toContain('Vileplume');
    expect(md).toContain('getMatchHistory with playerId "P2"');
  });
});
