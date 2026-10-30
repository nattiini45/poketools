/**
 * Synthetic inputs of the flows whose prompt builders are pure: the Kale fact packs, the coaches'
 * teams and the recap narrative's round results. A fixture stores these inputs, not rendered prompts,
 * so the eval always renders them with the current builders (`kale/prompts.ts`, `coach-prompts.ts`,
 * `recap-prompt.ts`). The fact packs follow the shape and the wording rules of `kale/fact-pack.ts`
 * (margin descriptions, pre-written one-liners, rank-change phrases, record strings), but every
 * player, league and result is invented, generated from a fixed seed.
 */

import type { CoachPokemonSet } from '@/lib/validation';
import type { RoundRecapMatchData } from '@/types/tournament-report';
import type {
  ForecastFactPack,
  MatchFact,
  MatchupFact,
  PokemonPerformance,
  RecapFactPack,
  StandingFact,
} from '../../kale/types';
import type { NarrativeInput } from '../../recap-prompt';
import type { KaleForecastCase, KaleRecapCase, RecapCase, SlotCoachCase, TeamCoachCase } from '../types';
import { createRng, teamOf } from './roster';
import { PLAYERS, TEAMS, type PlayerKey, type TeamKey } from './world';

const SCORING = '3 points for a win, 1 point for a draw, 0 points for a loss';

// Same wording as `computeMarginDescription` in kale/fact-pack.ts (that module reaches the database
// layer, which a fixture builder does not need).
function marginDescription(winnerScore: number, loserScore: number): string {
  const diff = winnerScore - loserScore;
  if (loserScore === 0 && winnerScore === 1) return 'the closest possible margin (1-0)';
  if (loserScore === 0 && winnerScore === 2) return 'a comfortable win (2-0)';
  if (loserScore === 0 && winnerScore >= 3) return `a dominant sweep (${winnerScore}-0)`;
  if (diff === 1) return `a close match (${winnerScore}-${loserScore})`;
  if (diff === 2) return `a comfortable margin (${winnerScore}-${loserScore})`;
  if (diff >= 3) return `a commanding victory (${winnerScore}-${loserScore})`;
  return `a ${winnerScore}-${loserScore} result`;
}

type League = 'gym' | 'core' | 'open';

interface RoundSpec {
  id: string;
  label: string;
  league: League;
  /** Players in the league, as keys of PLAYERS (the first ones play this round). */
  players: PlayerKey[];
  /** Round number (1 has no previous standings). */
  round: number;
  matches: number;
  seed: number;
  bestOf: number;
  /** No best performer / no unusual pick, to cover the optional tasks. */
  withUnusualPick?: boolean;
}

const TEAM_BY_LEAGUE: Record<League, TeamKey[]> = {
  gym: ['steel', 'water', 'fire', 'ground', 'steel', 'water', 'fire', 'ground'],
  core: ['coreA', 'coreB', 'coreC', 'coreA', 'coreB', 'coreC', 'coreA', 'coreB'],
  open: ['openA', 'openB', 'openC', 'openA', 'openB', 'openC', 'openA', 'openB'],
};

const LEAGUE_NAME: Record<League, string | null> = { gym: 'Sample Gym League', core: 'Sample Core League', open: null };
const TOURNAMENT_NAME: Record<League, string> = { gym: 'Sample Gym Cup', core: 'Sample Core Cup', open: 'Sample Open Cup' };

interface Participant {
  key: PlayerKey;
  id: string;
  name: string;
  team: TeamKey;
  gym: string | null;
}

function participantsOf(spec: RoundSpec): Participant[] {
  return spec.players.map((key, i) => {
    const team = TEAM_BY_LEAGUE[spec.league][i];
    const def = TEAMS[team] as { gymType?: string };
    return { key, id: PLAYERS[key].id, name: PLAYERS[key].name, team, gym: spec.league === 'gym' ? (def.gymType ?? null) : null };
  });
}

function recordString(wins: number, losses: number, draws: number): string {
  return `${wins}W-${losses}L${draws > 0 ? `-${draws}D` : ''}`;
}

/** Standings after `rounds` rounds for `people`, random but consistent (points = 3 x wins + draws). */
function standingsFor(people: Participant[], rounds: number, rng: () => number): StandingFact[] {
  const rows = people.map((p) => {
    let wins = 0;
    let losses = 0;
    let draws = 0;
    for (let r = 0; r < rounds; r += 1) {
      const roll = rng();
      if (roll < 0.08) draws += 1;
      else if (roll < 0.52) wins += 1;
      else losses += 1;
    }
    return { p, wins, losses, draws, kd: Math.round((rng() - 0.45) * 12) };
  });
  rows.sort((a, b) => 3 * b.wins + b.draws - (3 * a.wins + a.draws) || b.kd - a.kd);
  return rows.map((row, i) => ({
    rank: i + 1,
    playerName: row.p.name,
    playerId: row.p.id,
    gymType: row.p.gym,
    points: 3 * row.wins + row.draws,
    recordString: recordString(row.wins, row.losses, row.draws),
    kdString: row.kd > 0 ? `+${row.kd}` : `${row.kd}`,
    rankChange: `#${i + 1}`,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    killDifferential: row.kd,
  }));
}

function withRankChanges(current: StandingFact[], previous: StandingFact[] | null): StandingFact[] {
  const prevRank = new Map((previous ?? []).map((s) => [s.playerId, s.rank]));
  return current.map((s) => {
    const before = prevRank.get(s.playerId);
    let rankChange: string;
    if (!previous) rankChange = `#${s.rank}`;
    else if (before === undefined) rankChange = `new entry at #${s.rank}`;
    else if (before === s.rank) rankChange = `unchanged at #${s.rank}`;
    else if (before > s.rank) rankChange = `up ${before - s.rank} from #${before} to #${s.rank}`;
    else rankChange = `down ${s.rank - before} from #${before} to #${s.rank}`;
    return { ...s, rankChange };
  });
}

/** A previous ranking that differs from `current` by a few swaps. */
function previousOf(current: StandingFact[], rng: () => number): StandingFact[] {
  const order = [...current];
  for (let i = 0; i < Math.max(1, Math.floor(order.length / 2)); i += 1) {
    const a = Math.floor(rng() * order.length);
    const b = Math.min(order.length - 1, a + 1);
    [order[a], order[b]] = [order[b], order[a]];
  }
  return order.map((s, i) => ({ ...s, rank: i + 1, rankChange: `#${i + 1}` }));
}

function performance(species: string, rng: () => number, mvp: boolean): PokemonPerformance {
  const set = teamOf([species])[0];
  return {
    pokemonName: species,
    totalKos: mvp ? 2 + Math.floor(rng() * 3) : Math.floor(rng() * 2),
    wasKoed: rng() < 0.6,
    wasLead: false,
    isMvp: mvp,
    movesUsed: set.moves.slice(0, 2 + Math.floor(rng() * 2)),
  };
}

export function buildRecapCase(spec: RoundSpec): KaleRecapCase {
  const rng = createRng(spec.seed);
  const people = participantsOf(spec);
  const current0 = standingsFor(people, spec.round, rng);
  const previous = spec.round > 1 ? previousOf(current0, rng) : null;
  const currentStandings = withRankChanges(current0, previous);
  const previousStandings = previous;
  const standingsChanges = previous
    ? currentStandings.filter((s) => s.rankChange.startsWith('up') || s.rankChange.startsWith('down')).map((s) => `${s.playerName} moved ${s.rankChange}`)
    : [];

  const matches: MatchFact[] = [];
  const matchData: RoundRecapMatchData[] = [];
  const usage = new Map<string, { timesBrought: number; totalKos: number }>();
  for (let m = 0; m < spec.matches; m += 1) {
    const a = people[m * 2];
    const b = people[m * 2 + 1];
    const aWins = rng() < 0.5;
    const winner = aWins ? a : b;
    const loser = aWins ? b : a;
    const winnerScore = 1 + Math.floor(rng() * 4);
    const loserScore = rng() < 0.6 ? 0 : Math.min(winnerScore - 1, 1 + Math.floor(rng() * 2));
    const winnerSpecies = TEAMS[winner.team].species.slice(0, 4);
    const loserSpecies = TEAMS[loser.team].species.slice(0, 4);
    const mvpIndex = Math.floor(rng() * winnerSpecies.length);
    const winnerTeam = winnerSpecies.map((s, i) => performance(s, rng, i === mvpIndex));
    const loserTeam = loserSpecies.map((s) => performance(s, rng, false));
    for (const p of [...winnerTeam, ...loserTeam]) {
      const u = usage.get(p.pokemonName) ?? { timesBrought: 0, totalKos: 0 };
      u.timesBrought += 1;
      u.totalKos += p.totalKos;
      usage.set(p.pokemonName, u);
    }
    const mvp = winnerTeam[mvpIndex];
    const margin = marginDescription(winnerScore, loserScore);
    const scoreString = `${winnerScore}-${loserScore}`;
    const winnerKos = winnerTeam.reduce((s, p) => s + p.totalKos, 0);
    const loserKos = loserTeam.reduce((s, p) => s + p.totalKos, 0);
    const keyPerformances = [`${mvp.pokemonName} earned MVP for ${winner.name} with ${mvp.totalKos} KO${mvp.totalKos !== 1 ? 's' : ''}`];
    for (const p of [...winnerTeam, ...loserTeam]) {
      if (p.totalKos >= 2 && !p.isMvp) keyPerformances.push(`${p.pokemonName} scored ${p.totalKos} KOs for ${winnerTeam.includes(p) ? winner.name : loser.name}`);
    }
    const base = `${winner.name} defeated ${loser.name} ${scoreString} in ${margin}`;
    matches.push({
      matchId: `match-${spec.id}-${m + 1}`,
      player1Name: a.name,
      player2Name: b.name,
      winnerName: winner.name,
      loserName: loser.name,
      winnerScore,
      loserScore,
      marginDescription: margin,
      scoreString,
      player1TotalKos: aWins ? winnerKos : loserKos,
      player2TotalKos: aWins ? loserKos : winnerKos,
      gamesPlayed: 2 + (loserScore > 0 ? 1 : 0),
      mvpPokemon: mvp.pokemonName,
      mvpPlayerName: winner.name,
      mvpKos: mvp.totalKos,
      winnerTeam,
      loserTeam,
      preWrittenOneLiner: mvp.totalKos > 0 ? `${base}, with ${mvp.pokemonName} earning MVP honors (${mvp.totalKos} KO${mvp.totalKos !== 1 ? 's' : ''}).` : `${base}.`,
      keyPerformances,
    });
    matchData.push({
      match_id: `match-${spec.id}-${m + 1}`,
      player_1_id: a.id,
      player_1_name: a.name,
      player_1_avatar_url: null,
      player_2_id: b.id,
      player_2_name: b.name,
      player_2_avatar_url: null,
      winner_id: winner.id,
      winner_name: winner.name,
      p1_score: aWins ? winnerScore : loserScore,
      p2_score: aWins ? loserScore : winnerScore,
      p1_total_kos: aWins ? winnerKos : loserKos,
      p2_total_kos: aWins ? loserKos : winnerKos,
      mvp_pokemon: mvp.pokemonName,
      mvp_player_id: winner.id,
      mvp_kos: mvp.totalKos,
    });
  }

  const best = matches.reduce((acc, m) => (m.winnerScore - m.loserScore > acc.winnerScore - acc.loserScore ? m : acc), matches[0]);
  const unusual = spec.withUnusualPick && spec.league === 'gym' ? matches[0] : null;
  const gymTypes = Object.fromEntries(people.map((p) => [p.id, p.gym]));
  const factPack: RecapFactPack = {
    leagueName: LEAGUE_NAME[spec.league],
    tournamentName: TOURNAMENT_NAME[spec.league],
    roundName: `Round ${spec.round}`,
    roundNumber: spec.round,
    format: 'gen9ou',
    gen: 9,
    bestOf: spec.bestOf,
    scoring: SCORING,
    gymTypes,
    matches,
    currentStandings,
    previousStandings,
    standingsChanges,
    pokemonUsage: [...usage.entries()]
      .map(([pokemonName, u]) => ({ pokemonName, ...u }))
      .sort((x, y) => y.timesBrought - x.timesBrought || y.totalKos - x.totalKos),
    bestPerformer: { playerName: best.winnerName, reason: `won ${best.scoreString}, ${best.mvpPokemon} as MVP with ${best.mvpKos} KOs` },
    unusualPick: unusual
      ? { pokemonName: unusual.mvpPokemon, playerName: unusual.winnerName, reason: `${gymTypes[people.find((p) => p.name === unusual.winnerName)!.id]}-type Gym Leader brought off-type ${unusual.mvpPokemon} to strong effect (${unusual.mvpKos} KOs)` }
      : null,
    validPlayerNames: people.map((p) => p.name),
    validPokemonNames: [...usage.keys()],
    matchData,
    pokemonTypes: {},
  };
  return { id: spec.id, label: spec.label, locale: 'en', factPack };
}

export const RECAP_SPECS: RoundSpec[] = [
  { id: 'recap-gym-r3', label: 'gym league, round 3, 4 players, one unusual pick', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara'], round: 3, matches: 2, seed: 1101, bestOf: 3, withUnusualPick: true },
  { id: 'recap-gym-r1', label: 'gym league, round 1 (no previous standings), 6 players', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye'], round: 1, matches: 3, seed: 1102, bestOf: 3 },
  { id: 'recap-core-r4', label: 'core league, round 4, 6 players', league: 'core', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye'], round: 4, matches: 3, seed: 1103, bestOf: 3 },
  { id: 'recap-open-r2', label: 'open cup, round 2, 8 players, four matches', league: 'open', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 2, matches: 4, seed: 1104, bestOf: 3 },
  { id: 'recap-gym-r6', label: 'gym league, late round 6, 8 players', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 6, matches: 4, seed: 1105, bestOf: 3, withUnusualPick: true },
  { id: 'recap-core-r2', label: 'core league, round 2, 4 players', league: 'core', players: ['gus', 'hana', 'ada', 'bram'], round: 2, matches: 2, seed: 1106, bestOf: 3 },
  { id: 'recap-open-r5', label: 'open cup, round 5, best of one, 6 players', league: 'open', players: ['cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 5, matches: 3, seed: 1107, bestOf: 1 },
  { id: 'recap-gym-r2', label: 'gym league, round 2, 6 players', league: 'gym', players: ['eli', 'faye', 'gus', 'hana', 'ada', 'bram'], round: 2, matches: 3, seed: 1108, bestOf: 3 },
];

export function buildForecastCase(spec: RoundSpec & { teamsVisible: boolean }): KaleForecastCase {
  const rng = createRng(spec.seed);
  const people = participantsOf(spec);
  const rounds = spec.round - 1;
  const standings = rounds > 0 ? withRankChanges(standingsFor(people, rounds, rng), null) : [];
  const rank = new Map(standings.map((s) => [s.playerName, s]));
  const matchups: MatchupFact[] = [];
  for (let m = 0; m < spec.matches; m += 1) {
    const a = people[m * 2];
    const b = people[m * 2 + 1];
    const met = rounds > 1 && rng() < 0.4;
    const aLeads = rng() < 0.5;
    matchups.push({
      player1Name: a.name,
      player2Name: b.name,
      player1Rank: rank.get(a.name)?.rank ?? null,
      player2Rank: rank.get(b.name)?.rank ?? null,
      headToHead: met ? `${aLeads ? a.name : b.name} leads 1-0` : 'First meeting',
      player1Team: spec.teamsVisible ? [...TEAMS[a.team].species] : [],
      player2Team: spec.teamsVisible ? [...TEAMS[b.team].species] : [],
      player1Record: rank.get(a.name)?.recordString ?? 'N/A',
      player2Record: rank.get(b.name)?.recordString ?? 'N/A',
    });
  }
  const factPack: ForecastFactPack = {
    leagueName: LEAGUE_NAME[spec.league],
    tournamentName: TOURNAMENT_NAME[spec.league],
    roundName: `Round ${spec.round}`,
    roundNumber: spec.round,
    format: 'gen9ou',
    gen: 9,
    bestOf: spec.bestOf,
    scoring: SCORING,
    gymTypes: Object.fromEntries(people.map((p) => [p.id, p.gym])),
    matchups,
    currentStandings: standings,
    validPlayerNames: people.map((p) => p.name),
    validPokemonNames: spec.teamsVisible ? [...new Set(matchups.flatMap((m) => [...m.player1Team, ...m.player2Team]))] : [],
  };
  return { id: spec.id.replace('recap-', 'forecast-'), label: spec.label.replace(/^(.*)$/, '$1 (preview)'), locale: 'en', factPack };
}

export const FORECAST_SPECS: (RoundSpec & { teamsVisible: boolean })[] = [
  { id: 'recap-gym-r4', label: 'gym league, round 4, teams hidden', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara'], round: 4, matches: 2, seed: 2101, bestOf: 3, teamsVisible: false },
  { id: 'recap-gym-r1', label: 'gym league, round 1 (no standings yet), 6 players', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye'], round: 1, matches: 3, seed: 2102, bestOf: 3, teamsVisible: false },
  { id: 'recap-core-r3', label: 'core league, round 3, teams visible', league: 'core', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye'], round: 3, matches: 3, seed: 2103, bestOf: 3, teamsVisible: true },
  { id: 'recap-open-r3', label: 'open cup, round 3, 8 players, four matchups', league: 'open', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 3, matches: 4, seed: 2104, bestOf: 3, teamsVisible: false },
  { id: 'recap-gym-r7', label: 'gym league, final round 7, 8 players, teams visible', league: 'gym', players: ['ada', 'bram', 'cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 7, matches: 4, seed: 2105, bestOf: 3, teamsVisible: true },
  { id: 'recap-core-r2', label: 'core league, round 2, 4 players', league: 'core', players: ['gus', 'hana', 'ada', 'bram'], round: 2, matches: 2, seed: 2106, bestOf: 3, teamsVisible: false },
  { id: 'recap-open-r4', label: 'open cup, round 4, best of one', league: 'open', players: ['cleo', 'dara', 'eli', 'faye', 'gus', 'hana'], round: 4, matches: 3, seed: 2107, bestOf: 1, teamsVisible: true },
  { id: 'recap-gym-r5', label: 'gym league, round 5, 6 players', league: 'gym', players: ['eli', 'faye', 'gus', 'hana', 'ada', 'bram'], round: 5, matches: 3, seed: 2108, bestOf: 3, teamsVisible: false },
];

// ─── Coaches ────────────────────────────────────────────────────────

function coachSet(species: string): CoachPokemonSet {
  const s = teamOf([species])[0];
  return { name: s.name, species: s.species, item: s.item, ability: s.ability, nature: s.nature, tera_type: s.tera_type ?? '', moves: s.moves, evs: s.evs };
}

const coachTeam = (key: TeamKey): CoachPokemonSet[] => TEAMS[key].species.map(coachSet);

const TEAM_COACH: Omit<TeamCoachCase, 'id' | 'label'>[] = [
  { locale: 'en', team: coachTeam('openA'), format: 'gen9ou', generation: 9 },
  { locale: 'en', team: coachTeam('openB'), format: 'gen9ou', generation: 9 },
  { locale: 'en', team: coachTeam('openC'), format: 'gen9ou', generation: 9 },
  { locale: 'en', team: coachTeam('water'), format: 'gen9monotype', generation: 9 },
  { locale: 'en', team: coachTeam('ground').slice(0, 3), format: 'gen9ou', generation: 9 },
  { locale: 'de', team: coachTeam('coreB'), format: 'gen9ou', generation: 9 },
  { locale: 'en', team: coachTeam('steel').map((s, i) => (i === 2 ? { ...s, item: '', ability: '', moves: [], evs: null } : s)), format: 'gen9ou', generation: 9 },
  { locale: 'en', team: coachTeam('fire'), format: 'gen9nationaldex', generation: 9 },
];

export function teamCoachCases(): TeamCoachCase[] {
  const labels = ['balanced offence, six filled sets', 'bulky offence', 'hyper offence mix', 'mono-type water', 'half a team (3 of 6)', 'German output, core types', 'one slot left empty', 'national dex fire team'];
  return TEAM_COACH.map((c, i) => ({ id: `team-coach-${i + 1}`, label: labels[i], ...c }));
}

export function slotCoachCases(): SlotCoachCase[] {
  const picks: { team: TeamKey; slot: number; locale: 'en' | 'de'; format: string; label: string }[] = [
    { team: 'openA', slot: 1, locale: 'en', format: 'gen9ou', label: 'special attacker on an offensive team' },
    { team: 'openB', slot: 4, locale: 'en', format: 'gen9ou', label: 'bulky pivot' },
    { team: 'openC', slot: 5, locale: 'en', format: 'gen9ou', label: 'setup sweeper' },
    { team: 'water', slot: 0, locale: 'en', format: 'gen9monotype', label: 'mono-type lead' },
    { team: 'ground', slot: 2, locale: 'de', format: 'gen9ou', label: 'German output, hazard setter' },
    { team: 'coreA', slot: 3, locale: 'en', format: 'gen9ou', label: 'defensive core piece' },
    { team: 'steel', slot: 5, locale: 'en', format: 'gen9ou', label: 'last slot of a gym team' },
    { team: 'fire', slot: 1, locale: 'en', format: 'gen9nationaldex', label: 'national dex' },
  ];
  return picks.map((p, i) => {
    const team = coachTeam(p.team);
    return { id: `slot-coach-${i + 1}`, label: p.label, locale: p.locale, set: team[p.slot], team, format: p.format, generation: 9 };
  });
}

// ─── Recap narrative ────────────────────────────────────────────────

export function recapCases(): RecapCase[] {
  const defs: { league: League; round: number; seed: number; locale: 'en' | 'de'; matches: number; label: string }[] = [
    { league: 'gym', round: 3, seed: 3101, locale: 'en', matches: 3, label: 'gym league, three results' },
    { league: 'core', round: 4, seed: 3102, locale: 'en', matches: 2, label: 'core league, two results' },
    { league: 'open', round: 2, seed: 3103, locale: 'en', matches: 4, label: 'open cup, four results' },
    { league: 'gym', round: 5, seed: 3104, locale: 'de', matches: 3, label: 'German output' },
    { league: 'core', round: 1, seed: 3105, locale: 'en', matches: 3, label: 'opening round' },
    { league: 'open', round: 6, seed: 3106, locale: 'de', matches: 2, label: 'German output, late round' },
    { league: 'gym', round: 7, seed: 3107, locale: 'en', matches: 4, label: 'final round' },
    { league: 'open', round: 3, seed: 3108, locale: 'en', matches: 1, label: 'a single result' },
  ];
  return defs.map((d, i) => {
    const rng = createRng(d.seed);
    const names = (['ada', 'bram', 'cleo', 'dara', 'eli', 'faye', 'gus', 'hana'] as PlayerKey[]).map((k) => PLAYERS[k].name);
    const results = Array.from({ length: d.matches }, (_, m) => {
      const [a, b] = [names[m * 2], names[m * 2 + 1]];
      const aWins = rng() < 0.5;
      const winnerScore = 1 + Math.floor(rng() * 4);
      const loserScore = rng() < 0.55 ? 0 : Math.min(winnerScore - 1, 1);
      return { match_id: `m-${i + 1}-${m + 1}`, player1_name: a, player2_name: b, winner_name: aWins ? a : b, score: `${winnerScore}-${loserScore}` };
    });
    const input: NarrativeInput = {
      leagueName: LEAGUE_NAME[d.league] ?? 'Sample Open Cup',
      tournamentName: TOURNAMENT_NAME[d.league],
      roundName: `Round ${d.round}`,
      roundNumber: d.round,
      results,
      headlineMatch: results[0] ?? null,
    };
    return { id: `recap-${i + 1}`, label: d.label, locale: d.locale, input };
  });
}
