import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all query imports ─────────────────────────────────────────

vi.mock('@/lib/supabase/queries/matches', () => ({
  getMatchById: vi.fn(async () => ({
    id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
    player_1_id: 'p1', player_2_id: 'p2',
    player_1_name: 'Alice', player_2_name: 'Bob',
    winner_id: 'p1', winner_name: 'Alice',
    status: 'completed',
  })),
}));

vi.mock('@/lib/supabase/queries/tournaments', () => ({
  getTournamentById: vi.fn(async () => ({
    id: 'tourney-1', season_id: null, ruleset_id: null,
    name: 'Test Cup', best_of_default: 3,
    description: null, is_doubles: false,
  })),
}));

vi.mock('@/lib/supabase/queries/seasons', () => ({
  getSeasonById: vi.fn(async () => null),
  getSeasonParticipants: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/rulesets', () => ({
  getRulesetById: vi.fn(async () => null),
}));

vi.mock('@/lib/supabase/queries/rounds', () => ({
  getRoundById: vi.fn(async () => ({
    id: 'round-1', name: 'Round 1', round_number: 1, best_of: 3,
  })),
}));

vi.mock('@/lib/supabase/queries/games', () => ({
  getGamesByMatch: vi.fn(async () => []),
  getBattleStatsByMatch: vi.fn(async () => ({})),
  getOpponentBattleStatsInTournament: vi.fn(async () => []),
}));

vi.mock('@/lib/supabase/queries/aggregates', () => ({
  getAggregates: vi.fn(async () => []),
  getTotalGamesInScope: vi.fn(async () => 0),
}));

vi.mock('@/lib/supabase/queries/teams', () => ({
  getPlayerTeamForMatch: vi.fn(async () => null),
  getTeamByShareToken: vi.fn(),
  getTeamVisibilityFacts: vi.fn(),
}));

vi.mock('@/lib/supabase/queries/match-prep-teams', () => ({
  getMatchPrepTeam: vi.fn(async () => null),
}));

vi.mock('@/lib/pkmn/dex', () => ({
  getTeamTypeAnalysis: vi.fn(() => ({
    pokemon: [],
    teamWeaknesses: [{ type: 'Ground', count: 2 }],
    teamResistances: [{ type: 'Flying', count: 3 }],
  })),
  getSpecies: vi.fn(() => null),
}));

vi.mock('@/lib/pkmn/replay', () => ({
  fetchReplay: vi.fn(async () => ({
    id: 'replay-1', format: 'gen9ou', players: ['Alice', 'Bob'],
    winner: 'Alice', log: '|win|Alice',
  })),
}));

vi.mock('@/lib/pkmn/replay-frames', () => ({
  extractBattleFrames: vi.fn(() => []),
}));

import {
  buildMatchAnalysisPrompt,
  buildMatchPrepPrompt,
  buildRulesetSection,
  buildMetaSection,
  buildCondensedFrameSection,
  parseGenFromFormat,
} from '../context-builder';
import type { BattleFrame } from '@/types/replay-viewer';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getGamesByMatch, getOpponentBattleStatsInTournament } from '@/lib/supabase/queries/games';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { getMatchPrepTeam } from '@/lib/supabase/queries/match-prep-teams';
import { fetchReplay } from '@/lib/pkmn/replay';
import { extractBattleFrames } from '@/lib/pkmn/replay-frames';
import type { Ruleset } from '@/types/ruleset';

describe('parseGenFromFormat', () => {
  it('extracts generation from gen9ou', () => {
    expect(parseGenFromFormat('gen9ou')).toBe(9);
  });

  it('extracts generation from gen3uu', () => {
    expect(parseGenFromFormat('gen3uu')).toBe(3);
  });

  it('defaults to 9 for undefined', () => {
    expect(parseGenFromFormat(undefined)).toBe(9);
  });

  it('defaults to 9 for unrecognized format', () => {
    expect(parseGenFromFormat('custom_format')).toBe(9);
  });

  it('extracts gen from gen1ou', () => {
    expect(parseGenFromFormat('gen1ou')).toBe(1);
  });
});

describe('buildRulesetSection', () => {
  it('returns custom format section when ruleset is null', () => {
    const result = buildRulesetSection(null, false, 9);
    expect(result).toContain('Custom / Unknown');
    expect(result).toContain('Generation: 9');
  });

  it('includes base format, generation, and singles/doubles', () => {
    const ruleset: Ruleset = {
      id: 'rs-1', name: 'Gen 9 OU', base_format: 'gen9ou', is_doubles: false,
      clauses: ['Sleep Clause', 'Species Clause'],
      bans: { pokemon: ['Koraidon'], moves: ['Baton Pass'], items: ['King\'s Rock'], abilities: [] },
      additions: { pokemon: ['Wobbuffet'] },
      custom_rules_string: 'No Dynamax',
      min_shared_type_pct: 0,
      team_constraints: null,
      created_by: null, created_at: '', updated_at: '',
    };

    const result = buildRulesetSection(ruleset, false, 9);
    expect(result).toContain('gen9ou');
    expect(result).toContain('Singles');
    expect(result).toContain('Generation: 9');
    expect(result).toContain('Sleep Clause');
    expect(result).toContain('Koraidon');
    expect(result).toContain('Baton Pass');
    expect(result).toContain("King's Rock");
    expect(result).toContain('Wobbuffet');
    expect(result).toContain('No Dynamax');
  });

  it('shows Doubles when isDoubles is true', () => {
    const ruleset: Ruleset = {
      id: 'rs-1', name: 'VGC', base_format: 'gen9vgc', is_doubles: true,
      clauses: [], bans: { pokemon: [], moves: [], items: [], abilities: [] },
      additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
      team_constraints: null,
      created_by: null, created_at: '', updated_at: '',
    };

    const result = buildRulesetSection(ruleset, true, 9);
    expect(result).toContain('Doubles');
  });

  it('includes min_shared_type_pct when > 0', () => {
    const ruleset: Ruleset = {
      id: 'rs-1', name: 'Mono', base_format: 'gen9ou', is_doubles: false,
      clauses: [], bans: { pokemon: [], moves: [], items: [], abilities: [] },
      additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 50,
      team_constraints: null,
      created_by: null, created_at: '', updated_at: '',
    };

    const result = buildRulesetSection(ruleset, false, 9);
    expect(result).toContain('Minimum shared type: 50%');
  });

  it('truncates banned pokemon list over 30', () => {
    const pokemon = Array.from({ length: 35 }, (_, i) => `Mon${i}`);
    const ruleset: Ruleset = {
      id: 'rs-1', name: 'Big Bans', base_format: 'gen9ou', is_doubles: false,
      clauses: [], bans: { pokemon, moves: [], items: [], abilities: [] },
      additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
      team_constraints: null,
      created_by: null, created_at: '', updated_at: '',
    };

    const result = buildRulesetSection(ruleset, false, 9);
    expect(result).toContain('(+5 more)');
  });

  it('renders team composition constraints (type quota + tera)', () => {
    const ruleset: Ruleset = {
      id: 'rs-1', name: 'Sample Custom League', base_format: 'gen9ou', is_doubles: false,
      clauses: [], bans: { pokemon: [], moves: [], items: [], abilities: [] },
      additions: { pokemon: [] }, custom_rules_string: '', min_shared_type_pct: 0,
      team_constraints: {
        type_quotas: { source: 'player_core', min_per_type: 2, allow_multi_count: true },
        tera_match: 'player_core',
      },
      created_by: null, created_at: '', updated_at: '',
    };

    const result = buildRulesetSection(ruleset, false, 9);
    expect(result).toContain('Team composition constraints');
    expect(result).toContain('Type quota');
    expect(result).toContain('core types');
    expect(result).toContain('Tera');
  });
});

describe('buildMetaSection', () => {
  it('returns empty message when no aggregates', () => {
    const result = buildMetaSection([], 0);
    expect(result).toContain('No usage data');
  });

  it('formats top 10 aggregates', () => {
    const aggregates = [
      {
        id: '1', scope_type: 'tournament' as const, scope_id: 't1',
        pokemon_name: 'Pikachu', total_appearances: 10, total_brought: 10,
        total_led: 3, total_kos_dealt: 8, total_koed: 2, total_wins: 7,
        total_games: 10, move_counts: { Thunderbolt: 8, 'Volt Switch': 5, 'Iron Tail': 2 },
        last_updated: '',
      },
    ];

    const result = buildMetaSection(aggregates, 20);
    expect(result).toContain('Pikachu');
    expect(result).toContain('50.0% usage'); // 10/20
    expect(result).toContain('70.0% win rate'); // 7/10
    expect(result).toContain('Thunderbolt');
  });

  it('uses LEAGUE scope label when isLeagueScope is true', () => {
    const result = buildMetaSection([], 0, true);
    expect(result).toContain('LEAGUE META');
  });

  it('uses TOURNAMENT scope label by default', () => {
    const result = buildMetaSection([], 0);
    expect(result).toContain('TOURNAMENT META');
  });
});

describe('buildCondensedFrameSection', () => {
  // buildCondensedFrameSection only reads `turn` and `events`, so a minimal
  // cast keeps the fixtures focused on the field-condition rendering.
  const frame = (events: unknown[]): BattleFrame =>
    ({ turn: 1, events } as unknown as BattleFrame);

  it('renders the setter for ability-set weather', () => {
    const out = buildCondensedFrameSection([
      frame([{ type: 'weather', weather: 'SunnyDay', from: 'ability: Drought', of: 'Vulpix' }]),
    ]);
    expect(out).toContain("Weather: SunnyDay (set by Vulpix's Drought)");
  });

  it('renders bare weather when there is no setter attribution', () => {
    const out = buildCondensedFrameSection([
      frame([{ type: 'weather', weather: 'RainDance' }]),
    ]);
    expect(out).toContain('Weather: RainDance');
    expect(out).not.toContain('set by');
  });

  it('renders cleared weather', () => {
    const out = buildCondensedFrameSection([frame([{ type: 'weather', weather: null }])]);
    expect(out).toContain('Weather cleared');
  });

  it('renders the setter for surge-ability terrain', () => {
    const out = buildCondensedFrameSection([
      frame([
        { type: 'terrain', terrain: 'Grassy', from: 'ability: Grassy Surge', of: 'Rillaboom' },
      ]),
    ]);
    expect(out).toContain("Terrain: Grassy (set by Rillaboom's Grassy Surge)");
  });
});

describe('buildMatchAnalysisPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns system and user prompt', async () => {
    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.systemPrompt).toContain('Professor Linden');
    expect(result.userPrompt).toContain('Alice');
    expect(result.userPrompt).toContain('Bob');
  });

  it('throws when match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(null);
    await expect(buildMatchAnalysisPrompt('bad')).rejects.toThrow('not found');
  });

  it('throws when tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);
    await expect(buildMatchAnalysisPrompt('match-1')).rejects.toThrow('not found');
  });

  it('includes season context when available', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, description: null, is_doubles: false,
    } as never);

    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'Season 1', description: 'Gym Leader League',
      format_type: 'swiss',
    } as never);

    vi.mocked(getSeasonParticipants).mockResolvedValueOnce([
      { id: 'p1', name: 'Alice', gym_type: 'Fire' },
      { id: 'p2', name: 'Bob', gym_type: 'Water' },
    ] as Awaited<ReturnType<typeof getSeasonParticipants>> as never);

    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.userPrompt).toContain('LEAGUE CONTEXT');
    expect(result.userPrompt).toContain('Season 1');
    expect(result.userPrompt).toContain('Gym Leader Typings');
    expect(result.userPrompt).toContain('Fire-type Gym Leader');
  });

  it('includes assigned core types and omits gym framing for a Core Liga league', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, description: null, is_doubles: false,
    } as never);
    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'Sample Custom League', description: 'Core Liga',
      format_type: 'round_robin',
    } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValueOnce([
      { id: 'p1', name: 'Alice', gym_type: null, core_types: ['Fire', 'Grass', 'Water'] },
      { id: 'p2', name: 'Bob', gym_type: null, core_types: ['Bug', 'Electric', 'Steel'] },
    ] as Awaited<ReturnType<typeof getSeasonParticipants>> as never);

    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.userPrompt).toContain('Assigned Core Types');
    expect(result.userPrompt).toContain('Fire / Grass / Water');
    expect(result.userPrompt).toContain('Bug / Electric / Steel');
    // A core league must NOT emit gym-leader framing.
    expect(result.userPrompt).not.toContain('Gym Leader Typings');
  });

  it('system prompt uses the generalized league_constraint_analysis output field', async () => {
    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.systemPrompt).toContain('league_constraint_analysis');
    expect(result.systemPrompt).not.toContain('"gym_type_analysis"');
  });

  it('includes tournament description when available', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: null, ruleset_id: null,
      name: 'Special Cup', best_of_default: 1, description: 'Only NFE allowed',
      is_doubles: false,
    } as never);

    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.userPrompt).toContain('TOURNAMENT CONTEXT');
    expect(result.userPrompt).toContain('Only NFE allowed');
  });

  it('includes type analysis sections', async () => {
    // Force a team so type analysis is generated
    vi.mocked(getPlayerTeamForMatch).mockResolvedValue({
      id: 'team-1', name: '', player_id: 'p1', tournament_id: 'tourney-1',
      pokemon: [{ species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] }],
      import_source: 'manual', locked: false, is_draft_team: false, draft_pool_id: null,
      share_token: null, share_enabled_at: null, library_published_at: null,
      library_title: null, library_description: null, library_tags: null, forked_from_team_id: null,
      created_at: '', updated_at: '', season_id: null, match_id: null,
    } as Awaited<ReturnType<typeof getPlayerTeamForMatch>> as never);

    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.userPrompt).toContain('Type Coverage');
  });

  it('fetches replay frames for ps_replay games', async () => {
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([
      { id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'p1', replay_url: 'https://replay.pokemonshowdown.com/gen9ou-1', source: 'ps_replay', parsed: true, created_at: '', updated_at: '' },
    ] as Awaited<ReturnType<typeof getGamesByMatch>> as never);

    await buildMatchAnalysisPrompt('match-1');
    expect(fetchReplay).toHaveBeenCalledTimes(1);
    expect(extractBattleFrames).toHaveBeenCalledTimes(1);
  });

  it('continues without frames when replay fetch fails', async () => {
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([
      { id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'p1', replay_url: 'https://example.com/replay', source: 'ps_replay', parsed: true, created_at: '', updated_at: '' },
    ] as Awaited<ReturnType<typeof getGamesByMatch>> as never);
    vi.mocked(fetchReplay).mockRejectedValueOnce(new Error('fetch fail'));

    const result = await buildMatchAnalysisPrompt('match-1');
    expect(result.systemPrompt).toContain('Professor Linden');
  });

  it('skips replay fetch for non-ps_replay games', async () => {
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([
      { id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'p1', replay_url: '', source: 'manual', parsed: true, created_at: '', updated_at: '' },
    ] as Awaited<ReturnType<typeof getGamesByMatch>> as never);

    await buildMatchAnalysisPrompt('match-1');
    expect(fetchReplay).not.toHaveBeenCalled();
  });
});

describe('buildMatchPrepPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns system prompt, user prompt, and hasUserTeam flag', async () => {
    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.systemPrompt).toContain('Professor Linden');
    expect(result.userPrompt).toContain('Alice');
    expect(result.userPrompt).toContain('Bob');
    expect(result.hasUserTeam).toBe(false);
  });

  it('throws when match not found', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce(null);
    await expect(buildMatchPrepPrompt('bad', 'p1')).rejects.toThrow('not found');
  });

  it('throws when tournament not found', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce(null);
    await expect(buildMatchPrepPrompt('match-1', 'p1')).rejects.toThrow('not found');
  });

  it('sets hasUserTeam true when prep team has pokemon', async () => {
    vi.mocked(getMatchPrepTeam).mockResolvedValueOnce({
      pokemon: [{ species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] }],
    } as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.hasUserTeam).toBe(true);
    expect(result.userPrompt).toContain('YOUR PLANNED TEAM');
  });

  it('fails when the prep-team read fails (never mistaken for "no prep team")', async () => {
    const dbError = new Error('connection reset');
    vi.mocked(getMatchPrepTeam).mockRejectedValueOnce(dbError);
    await expect(buildMatchPrepPrompt('match-1', 'p1')).rejects.toBe(dbError);
  });

  it('falls back to tournament team when no prep team', async () => {
    vi.mocked(getMatchPrepTeam).mockResolvedValueOnce(null);
    vi.mocked(getPlayerTeamForMatch)
      .mockResolvedValueOnce(null) // opponent team
      .mockResolvedValueOnce({
        id: 't1', name: '', player_id: 'p1', tournament_id: 'tourney-1',
        pokemon: [{ species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] }],
        import_source: 'manual', locked: false, is_draft_team: false, draft_pool_id: null,
        share_token: null, share_enabled_at: null, library_published_at: null,
        library_title: null, library_description: null, library_tags: null, forked_from_team_id: null,
        created_at: '', updated_at: '', season_id: null, match_id: null,
      } as Awaited<ReturnType<typeof getPlayerTeamForMatch>> as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.hasUserTeam).toBe(false);
    expect(result.userPrompt).toContain('REGISTERED TOURNAMENT TEAM');
  });

  it('identifies player correctly as p2', async () => {
    const result = await buildMatchPrepPrompt('match-1', 'p2');
    // p2 is Bob, opponent is Alice
    expect(result.userPrompt).toContain('Bob (you) vs Alice');
  });

  it('includes opponent battle history section', async () => {
    vi.mocked(getOpponentBattleStatsInTournament).mockResolvedValueOnce([
      {
        id: 's1', game_id: 'g1', player_id: 'p2', pokemon_name: 'Charizard',
        was_brought: true, was_lead: true, kos_dealt: 3, was_koed: false,
        moves_used: ['Flamethrower', 'Dragon Pulse'], turns_active: 5,
        match_won: true, created_at: '',
      },
    ] as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.userPrompt).toContain('BATTLE HISTORY');
    expect(result.userPrompt).toContain('Charizard');
    expect(result.userPrompt).toContain('Flamethrower');
  });

  it('includes league context with gym types', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, description: null, is_doubles: false,
    } as never);

    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'Season 1', description: 'Gym League',
      format_type: 'swiss',
    } as never);

    vi.mocked(getSeasonParticipants).mockResolvedValueOnce([
      { id: 'p1', name: 'Alice', gym_type: 'Electric' },
      { id: 'p2', name: 'Bob', gym_type: 'Water' },
    ] as Awaited<ReturnType<typeof getSeasonParticipants>> as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.userPrompt).toContain('LEAGUE CONTEXT');
    expect(result.userPrompt).toContain('Electric-type Gym Leader');
    expect(result.userPrompt).toContain('Water-type Gym Leader');
  });

  it('includes assigned core types for the player (you) and opponent', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, description: null, is_doubles: false,
    } as never);
    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'Sample Custom League', description: null, format_type: 'round_robin',
    } as never);
    vi.mocked(getSeasonParticipants).mockResolvedValueOnce([
      { id: 'p1', name: 'Alice', gym_type: null, core_types: ['Fire', 'Grass', 'Water'] },
      { id: 'p2', name: 'Bob', gym_type: null, core_types: ['Bug', 'Electric', 'Steel'] },
    ] as Awaited<ReturnType<typeof getSeasonParticipants>> as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.userPrompt).toContain('Assigned Core Types');
    expect(result.userPrompt).toContain('Alice (you): Fire / Grass / Water');
    expect(result.userPrompt).not.toContain('Gym Leader Typings');
  });

  it('shows empty history for opponent with no stats', async () => {
    vi.mocked(getOpponentBattleStatsInTournament).mockResolvedValueOnce([] as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');
    expect(result.userPrompt).toContain('No battle data available');
  });

  it('uses league scope for meta when season exists', async () => {
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: 'season-1', ruleset_id: null,
      name: 'Test Cup', best_of_default: 3, description: null, is_doubles: false,
    } as never);

    vi.mocked(getSeasonById).mockResolvedValueOnce({
      id: 'season-1', name: 'Season 1', description: null, format_type: 'swiss',
    } as never);

    await buildMatchPrepPrompt('match-1', 'p1');
    expect(getAggregates).toHaveBeenCalledWith('league', 'season-1');
    expect(getTotalGamesInScope).toHaveBeenCalledWith('league', 'season-1');
  });
});

// ── H3: team sheets follow spec §7 per match ────────────────────────

describe('roster visibility in AI context (spec §7, per match)', () => {
  const SECRET_SET = {
    species: 'Garchomp', name: '', gender: '', item: 'Choice Scarf', ability: 'Rough Skin',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Jolly', level: 100, moves: ['Earthquake'],
  };
  const teamOf = (playerId: string) => ({
    id: `team-${playerId}`, name: '', player_id: playerId, tournament_id: 'tourney-1',
    pokemon: [SECRET_SET], import_source: 'manual', locked: false, is_draft_team: false,
    draft_pool_id: null, library_published_at: null, library_title: null, library_description: null,
    library_tags: null, forked_from_team_id: null, created_at: '', updated_at: '', season_id: null,
    match_id: null,
  });
  const MATCH = {
    id: 'match-1', tournament_id: 'tourney-1', round_id: 'round-1',
    player_1_id: 'p1', player_2_id: 'p2', player_1_name: 'Alice', player_2_name: 'Bob',
    winner_id: null, winner_name: null,
  };
  const GAME = {
    id: 'game-1', match_id: 'match-1', game_number: 1, winner_id: 'p1', replay_url: '',
    source: 'manual', parsed: true, created_at: '', updated_at: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPlayerTeamForMatch).mockImplementation(async (playerId: string) => teamOf(playerId) as never);
  });

  it('match analysis reads each team for this match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...MATCH, status: 'completed' } as never);
    await buildMatchAnalysisPrompt('match-1');
    expect(getPlayerTeamForMatch).toHaveBeenCalledWith('p1', expect.objectContaining({ id: 'match-1', tournament_id: 'tourney-1' }));
  });

  it('match analysis leaves out team sheets of an in-progress match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...MATCH, status: 'in_progress' } as never);
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([GAME] as never);

    const result = await buildMatchAnalysisPrompt('match-1');

    expect(result.userPrompt).not.toContain('Team Sheet');
    expect(result.userPrompt).not.toContain('Choice Scarf');
  });

  it('match analysis includes team sheets once the match is completed', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...MATCH, status: 'completed' } as never);
    vi.mocked(getGamesByMatch).mockResolvedValueOnce([GAME] as never);

    const result = await buildMatchAnalysisPrompt('match-1');

    expect(result.userPrompt).toContain("Alice's Team Sheet");
    expect(result.userPrompt).toContain('Garchomp @ Choice Scarf');
  });

  it('scouting leaves out the opponent team before the match', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...MATCH, status: 'scheduled' } as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');

    expect(result.userPrompt).not.toContain("Bob's Team Sheet");
    // The requester's own team (owner) is still there.
    expect(result.userPrompt).toContain("Alice's Team Sheet");
  });

  it('scouting includes the opponent team of an always_public tournament', async () => {
    vi.mocked(getMatchById).mockResolvedValueOnce({ ...MATCH, status: 'scheduled' } as never);
    vi.mocked(getTournamentById).mockResolvedValueOnce({
      id: 'tourney-1', season_id: null, ruleset_id: null, name: 'Test Cup', best_of_default: 3,
      description: null, is_doubles: false, team_visibility: 'always_public',
    } as never);

    const result = await buildMatchPrepPrompt('match-1', 'p1');

    expect(result.userPrompt).toContain("Bob's Team Sheet");
  });
});
