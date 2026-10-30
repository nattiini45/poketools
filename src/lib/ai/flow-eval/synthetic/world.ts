/**
 * The synthetic world behind the match-analysis and scouting fixtures: invented players, three
 * kinds of league (gym-leader typings, assigned core types, an open cup), hand-built teams and
 * simulated games, all in the row shapes the app's query modules return. `build-fixtures.test.ts`
 * serves a `World` through mocked query modules and lets the app's own `buildMatchAnalysisPrompt` /
 * `buildMatchPrepPrompt` render it. Everything is invented: no real player, league or format pack.
 */

import type { Aggregate, BattleStat } from '@/types/game';
import type { PokemonSet } from '@/types/team';
import { makeRuleset } from '@/test/ruleset-fixtures';
import type { Ruleset } from '@/types/ruleset';
import { simulateGame, type Side, type SimResult } from './battle-sim';
import { createRng, teamOf } from './roster';

// ─── People and teams ───────────────────────────────────────────────

export const PLAYERS = {
  ada: { id: 'player-ada', name: 'Ada' },
  bram: { id: 'player-bram', name: 'Bram' },
  cleo: { id: 'player-cleo', name: 'Cleo' },
  dara: { id: 'player-dara', name: 'Dara' },
  eli: { id: 'player-eli', name: 'Eli' },
  faye: { id: 'player-faye', name: 'Faye' },
  gus: { id: 'player-gus', name: 'Gus' },
  hana: { id: 'player-hana', name: 'Hana' },
} as const;
export type PlayerKey = keyof typeof PLAYERS;

export interface TeamDef {
  species: string[];
  /** Gym typing, for a gym-leader league. */
  gymType?: string;
  /** Assigned core types, for a core league. */
  core?: [string, string, string];
}

export const TEAMS = {
  steel: { gymType: 'Steel', species: ['Kingambit', 'Corviknight', 'Ferrothorn', 'Heatran', 'Gholdengo', 'Scizor'] },
  water: { gymType: 'Water', species: ['Toxapex', 'Rotom-Wash', 'Primarina', 'Gyarados', 'Pelipper', 'Dondozo'] },
  fire: { gymType: 'Fire', species: ['Heatran', 'Skeledirge', 'Ceruledge', 'Torkoal', 'Volcarona', 'Talonflame'] },
  ground: { gymType: 'Ground', species: ['Great Tusk', 'Garchomp', 'Landorus-Therian', 'Gliscor', 'Excadrill', 'Hippowdon'] },
  coreA: { core: ['Water', 'Grass', 'Steel'], species: ['Toxapex', 'Rotom-Wash', 'Rillaboom', 'Ferrothorn', 'Corviknight', 'Kingambit'] },
  coreB: { core: ['Ground', 'Dragon', 'Fairy'], species: ['Garchomp', 'Landorus-Therian', 'Dragonite', 'Dragapult', 'Clefable', 'Primarina'] },
  coreC: { core: ['Fire', 'Fighting', 'Dark'], species: ['Skeledirge', 'Iron Valiant', 'Great Tusk', 'Weavile', 'Kingambit', 'Ceruledge'] },
  openA: { species: ['Great Tusk', 'Gholdengo', 'Dragapult', 'Slowking-Galar', 'Landorus-Therian', 'Corviknight'] },
  openB: { species: ['Kingambit', 'Iron Valiant', 'Hatterene', 'Skeledirge', 'Garchomp', 'Rotom-Wash'] },
  openC: { species: ['Weavile', 'Annihilape', 'Clefable', 'Gliscor', 'Dragonite', 'Heatran'] },
} as const satisfies Record<string, TeamDef>;
export type TeamKey = keyof typeof TEAMS;

export type LeagueKind = 'gym' | 'core' | 'open';

const LEAGUE_TEXT: Record<LeagueKind, { season: string | null; seasonDescription: string; tournament: string; tournamentDescription: string }> = {
  gym: {
    season: 'Sample Gym League',
    seasonDescription:
      'Gym Leader format. Each player leads a gym locked to one type, and every Pokémon on a gym leader\'s team must have that type. Standard Gen 9 OU clauses apply. Standings are by points, then kill differential.',
    tournament: 'Sample Gym Cup',
    tournamentDescription: 'Round robin between the gym leaders; every match is best of three unless noted.',
  },
  core: {
    season: 'Sample Core League',
    seasonDescription:
      'Each player is assigned three core types for the season. A team must include at least two Pokémon of each assigned core type, and every Pokémon\'s Tera type must be one of the core types.',
    tournament: 'Sample Core Cup',
    tournamentDescription: 'Round robin; teams are built around the assigned core types.',
  },
  open: {
    season: null,
    seasonDescription: '',
    tournament: 'Sample Open Cup',
    tournamentDescription: 'Single elimination bracket, open to any legal Gen 9 OU team.',
  },
};

const BANNED = ['Koraidon', 'Miraidon', 'Calyrex-Shadow', 'Calyrex-Ice', 'Zacian-Crowned', 'Eternatus', 'Flutter Mane', 'Chien-Pao'];

function rulesetFor(kind: LeagueKind): Ruleset {
  return makeRuleset({
    id: `ruleset-${kind}`,
    name: kind === 'open' ? 'Gen 9 OU' : `Sample ${kind} ruleset`,
    base_format: 'gen9ou',
    clauses: ['Sleep Clause Mod', 'Species Clause', 'Evasion Items Clause'],
    bans: { pokemon: BANNED, moves: [], items: [], abilities: [] },
    team_constraints:
      kind === 'core'
        ? { type_quotas: { source: 'player_core', min_per_type: 2, allow_multi_count: true }, tera_match: 'player_core' }
        : null,
  });
}

// ─── World ──────────────────────────────────────────────────────────

export interface WorldTeamRow {
  id: string;
  player_id: string;
  name: string;
  pokemon: PokemonSet[];
  library_published_at: null;
  tournament_id: string;
  match_id: null;
}

export interface World {
  match: Record<string, unknown>;
  tournament: Record<string, unknown>;
  round: Record<string, unknown>;
  season: Record<string, unknown> | null;
  participants: Record<string, unknown>[];
  ruleset: Ruleset;
  games: Record<string, unknown>[];
  battleStats: Record<string, BattleStat[]>;
  /** Replay log by replay URL. */
  replays: Record<string, string>;
  teams: Record<string, WorldTeamRow | null>;
  prepTeam: { pokemon: PokemonSet[] } | null;
  opponentHistory: BattleStat[];
  aggregates: Aggregate[];
  totalGames: number;
  /** What the graders need to know about the data. */
  facts: {
    gameWinners: { gameNumber: number; winner: string }[];
    matchWinner: string;
    opponentSpecies: string[];
    userGymType: string | null;
  };
}

function statRows(gameId: string, playerId: string, team: PokemonSet[], sim: SimResult, side: Side, won: boolean): BattleStat[] {
  const brought = new Map(sim.stats[side].map((s) => [s.species, s]));
  return team.map((set) => {
    const s = brought.get(set.species);
    return {
      id: `bs-${gameId}-${playerId}-${set.species}`,
      game_id: gameId,
      player_id: playerId,
      pokemon_name: set.species,
      was_brought: Boolean(s),
      was_lead: s?.lead ?? false,
      kos_dealt: s?.kos ?? 0,
      was_koed: s?.koed ?? false,
      moves_used: s?.moves ?? [],
      turns_active: s?.turnsActive ?? 0,
      match_won: won,
      created_at: '2026-01-01T00:00:00Z',
    };
  });
}

/** The first `bring` Pokémon of a team rotated by `shift`, so the lead changes from game to game. */
function bringList(team: PokemonSet[], bring: number, shift: number): PokemonSet[] {
  const rotated = [...team.slice(shift % team.length), ...team.slice(0, shift % team.length)];
  return rotated.slice(0, bring);
}

function metaFor(teams: readonly TeamKey[], seed: number, scope: 'tournament' | 'league', scopeId: string): { aggregates: Aggregate[]; totalGames: number } {
  const rng = createRng(seed);
  const seen = new Map<string, PokemonSet>();
  for (const key of teams) for (const set of teamOf(TEAMS[key].species)) seen.set(set.species, set);
  const totalGames = 40 + Math.floor(rng() * 20);
  const aggregates = [...seen.values()].map((set, i): Aggregate => {
    const appearances = 4 + Math.floor(rng() * 22);
    const wins = Math.round(appearances * (0.35 + rng() * 0.35));
    return {
      id: `agg-${i}`,
      scope_type: scope,
      scope_id: scopeId,
      pokemon_name: set.species,
      total_appearances: appearances,
      total_brought: appearances,
      total_led: Math.floor(appearances * rng() * 0.5),
      total_kos_dealt: Math.floor(appearances * (0.6 + rng())),
      total_koed: Math.floor(appearances * (0.4 + rng() * 0.5)),
      total_wins: wins,
      total_games: appearances,
      move_counts: Object.fromEntries(set.moves.map((m) => [m, 1 + Math.floor(rng() * appearances)])),
      last_updated: '2026-01-01T00:00:00Z',
    };
  });
  aggregates.sort((a, b) => b.total_appearances - a.total_appearances);
  return { aggregates, totalGames };
}

function leagueRows(kind: LeagueKind, players: { key: PlayerKey; team: TeamKey }[]): { season: Record<string, unknown> | null; participants: Record<string, unknown>[] } {
  const text = LEAGUE_TEXT[kind];
  if (text.season === null) return { season: null, participants: [] };
  return {
    season: { id: `season-${kind}`, name: text.season, description: text.seasonDescription, format_type: 'round_robin' },
    participants: players.map(({ key, team }) => {
      const def = TEAMS[team] as TeamDef;
      return {
        id: PLAYERS[key].id,
        name: PLAYERS[key].name,
        gym_type: kind === 'gym' ? (def.gymType ?? null) : null,
        core_types: kind === 'core' ? (def.core ?? null) : null,
      };
    }),
  };
}

function tournamentRow(kind: LeagueKind, bestOf: number): Record<string, unknown> {
  const text = LEAGUE_TEXT[kind];
  return {
    id: `tournament-${kind}`,
    season_id: text.season === null ? null : `season-${kind}`,
    ruleset_id: `ruleset-${kind}`,
    name: text.tournament,
    description: text.tournamentDescription,
    is_doubles: false,
    best_of_default: bestOf,
    team_visibility: 'hidden_until_match',
  };
}

function teamRow(key: PlayerKey, team: TeamKey, kind: LeagueKind): WorldTeamRow {
  return {
    id: `team-${key}`,
    player_id: PLAYERS[key].id,
    name: `${PLAYERS[key].name}'s ${team}`,
    pokemon: teamOf(TEAMS[team].species),
    library_published_at: null,
    tournament_id: `tournament-${kind}`,
    match_id: null,
  };
}

// ─── Post-match world ───────────────────────────────────────────────

export interface PostMatchSpec {
  id: string;
  label: string;
  locale: 'en' | 'de';
  league: LeagueKind;
  p1: { player: PlayerKey; team: TeamKey };
  p2: { player: PlayerKey; team: TeamKey };
  /** Winner of each game, in order. */
  results: Side[];
  /** Games come with a Showdown replay (a turn-by-turn summary) or were entered by hand. */
  replays: boolean;
  /** The team sheets are known. */
  teamSheets: boolean;
  bestOf: number;
  /** Pokémon brought per game. */
  bring: number;
  seed: number;
}

export function buildPostMatchWorld(spec: PostMatchSpec): World {
  const { p1, p2 } = spec;
  const names = { p1: PLAYERS[p1.player].name, p2: PLAYERS[p2.player].name } as const;
  const ids = { p1: PLAYERS[p1.player].id, p2: PLAYERS[p2.player].id } as const;
  const teams = { p1: teamOf(TEAMS[p1.team].species), p2: teamOf(TEAMS[p2.team].species) };
  const games: Record<string, unknown>[] = [];
  const battleStats: Record<string, BattleStat[]> = {};
  const replays: Record<string, string> = {};
  const wins = { p1: 0, p2: 0 };
  for (const r of spec.results) wins[r] += 1;
  const matchWinnerSide: Side = wins.p1 > wins.p2 ? 'p1' : 'p2';

  spec.results.forEach((winner, index) => {
    const gameNumber = index + 1;
    const gameId = `game-${spec.id}-${gameNumber}`;
    const sim = simulateGame({
      names,
      teams: { p1: bringList(teams.p1, spec.bring, index), p2: bringList(teams.p2, spec.bring, index + 1) },
      winner,
      seed: spec.seed + index * 101,
    });
    const url = `https://replay.example.invalid/gen9ou-${spec.id}-${gameNumber}`;
    if (spec.replays) replays[url] = sim.log;
    games.push({
      id: gameId,
      match_id: `match-${spec.id}`,
      game_number: gameNumber,
      winner_id: ids[winner],
      replay_url: spec.replays ? url : null,
      source: spec.replays ? 'ps_replay' : 'manual',
    });
    battleStats[gameId] = [
      ...statRows(gameId, ids.p1, teams.p1, sim, 'p1', matchWinnerSide === 'p1'),
      ...statRows(gameId, ids.p2, teams.p2, sim, 'p2', matchWinnerSide === 'p2'),
    ];
  });

  const league = leagueRows(spec.league, [
    { key: p1.player, team: p1.team },
    { key: p2.player, team: p2.team },
  ]);
  const meta = metaFor([p1.team, p2.team], spec.seed, 'tournament', `tournament-${spec.league}`);
  return {
    match: {
      id: `match-${spec.id}`,
      tournament_id: `tournament-${spec.league}`,
      round_id: `round-${spec.id}`,
      player_1_id: ids.p1,
      player_2_id: ids.p2,
      player_1_name: names.p1,
      player_2_name: names.p2,
      winner_id: ids[matchWinnerSide],
      winner_name: names[matchWinnerSide],
      status: 'completed',
    },
    tournament: tournamentRow(spec.league, spec.bestOf),
    round: { id: `round-${spec.id}`, name: `Round ${(spec.seed % 5) + 1}`, round_number: (spec.seed % 5) + 1, best_of: spec.bestOf },
    season: league.season,
    participants: league.participants,
    ruleset: rulesetFor(spec.league),
    games,
    battleStats,
    replays,
    teams: {
      [ids.p1]: spec.teamSheets ? teamRow(p1.player, p1.team, spec.league) : null,
      [ids.p2]: spec.teamSheets ? teamRow(p2.player, p2.team, spec.league) : null,
    },
    prepTeam: null,
    opponentHistory: [],
    aggregates: meta.aggregates,
    totalGames: meta.totalGames,
    facts: {
      gameWinners: spec.results.map((w, i) => ({ gameNumber: i + 1, winner: names[w] })),
      matchWinner: names[matchWinnerSide],
      opponentSpecies: [],
      userGymType: null,
    },
  };
}

// ─── Pre-match (scouting) world ─────────────────────────────────────

export interface PrepSpec {
  id: string;
  label: string;
  locale: 'en' | 'de';
  league: LeagueKind;
  /** The requesting player. */
  user: { player: PlayerKey; team: TeamKey };
  opponent: { player: PlayerKey; team: TeamKey };
  /** `prep`: a saved match-prep team. `none`: no team at all. `registered`: only the tournament team on file. */
  userTeam: 'prep' | 'none' | 'registered';
  /** Games of the opponent's history in scope. */
  historyGames: number;
  seed: number;
}

export function buildPrepWorld(spec: PrepSpec): World {
  const { user, opponent } = spec;
  const userTeam = teamOf(TEAMS[user.team].species);
  const oppTeam = teamOf(TEAMS[opponent.team].species);
  const sparringTeams: TeamKey[] = ['openA', 'openB', 'openC'];
  const history: BattleStat[] = [];
  for (let g = 0; g < spec.historyGames; g += 1) {
    const sparKey = sparringTeams[g % sparringTeams.length];
    const sparring = teamOf(TEAMS[sparKey].species);
    const oppWins = g % 3 !== 2;
    const sim = simulateGame({
      names: { p1: PLAYERS[opponent.player].name, p2: 'Sparring Partner' },
      teams: { p1: bringList(oppTeam, 4 + (g % 2), g), p2: bringList(sparring, 4, g) },
      winner: oppWins ? 'p1' : 'p2',
      seed: spec.seed + g * 53,
    });
    history.push(...statRows(`hist-${spec.id}-${g + 1}`, PLAYERS[opponent.player].id, oppTeam, sim, 'p1', oppWins));
  }

  const league = leagueRows(spec.league, [
    { key: user.player, team: user.team },
    { key: opponent.player, team: opponent.team },
  ]);
  const meta = metaFor([user.team, opponent.team, ...sparringTeams], spec.seed, spec.league === 'open' ? 'tournament' : 'league', spec.league === 'open' ? 'tournament-open' : `season-${spec.league}`);
  const userDef = TEAMS[user.team] as TeamDef;
  return {
    match: {
      id: `match-${spec.id}`,
      tournament_id: `tournament-${spec.league}`,
      round_id: `round-${spec.id}`,
      player_1_id: PLAYERS[user.player].id,
      player_2_id: PLAYERS[opponent.player].id,
      player_1_name: PLAYERS[user.player].name,
      player_2_name: PLAYERS[opponent.player].name,
      winner_id: null,
      winner_name: null,
      status: 'scheduled',
    },
    tournament: tournamentRow(spec.league, 3),
    round: { id: `round-${spec.id}`, name: `Round ${(spec.seed % 5) + 2}`, round_number: (spec.seed % 5) + 2, best_of: 3 },
    season: league.season,
    participants: league.participants,
    ruleset: rulesetFor(spec.league),
    games: [],
    battleStats: {},
    replays: {},
    teams: {
      [PLAYERS[opponent.player].id]: teamRow(opponent.player, opponent.team, spec.league),
      [PLAYERS[user.player].id]: spec.userTeam === 'registered' ? teamRow(user.player, user.team, spec.league) : null,
    },
    prepTeam: spec.userTeam === 'prep' ? { pokemon: userTeam } : null,
    opponentHistory: history,
    aggregates: meta.aggregates,
    totalGames: meta.totalGames,
    facts: {
      gameWinners: [],
      matchWinner: '',
      opponentSpecies: [...new Set(history.filter((h) => h.was_brought).map((h) => h.pokemon_name))],
      userGymType: spec.league === 'gym' ? (userDef.gymType ?? null) : null,
    },
  };
}
