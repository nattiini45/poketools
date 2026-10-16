import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { aggregateTeamFromStats, computePokemonScore, computeQuickStats } from '@/lib/match/aggregation';
import { parseGenFromFormat } from '../context-builder';
import { getSpecies } from '@/lib/pkmn/dex';
import type { MatchWithPlayers } from '@/types/match';
import type { AggregatedPokemon } from '@/lib/match/aggregation';
import type { Standing } from '@/lib/tournament/types';
import type { BattleStat } from '@/types/game';
import type { RoundRecapMatchData } from '@/types/tournament-report';
import type {
  RecapFactPack,
  ForecastFactPack,
  MatchFact,
  StandingFact,
  MatchupFact,
  PokemonPerformance,
} from './types';

// ─── Recap Fact Pack ────────────────────────────────────────────────

export async function buildRecapFactPack(
  tournamentId: string,
  roundId: string
): Promise<RecapFactPack> {
  const [tournament, round, participants] = await Promise.all([
    getTournamentById(tournamentId),
    getRoundById(roundId),
    getParticipants(tournamentId),
  ]);

  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  if (!round) throw new Error(`Round ${roundId} not found`);

  const [roundMatches, allMatchRecords, ruleset, seasonData] = await Promise.all([
    getMatchesByRound(roundId),
    getCompletedMatchRecords(tournamentId),
    tournament.ruleset_id ? getRulesetById(tournament.ruleset_id) : Promise.resolve(null),
    tournament.season_id ? fetchSeasonContext(tournament.season_id) : Promise.resolve(null),
  ]);

  const gen = parseGenFromFormat(ruleset?.base_format);

  // Build participant lookups
  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name;
    participantAvatars[p.id] = p.avatar_url;
  }
  const gymTypes: Record<string, string | null> = {};
  if (seasonData?.participants) {
    for (const sp of seasonData.participants) {
      gymTypes[sp.id] = sp.gym_type;
    }
  }

  // Fetch per-match battle stats
  const matchDetails = await fetchMatchDetails(roundMatches);

  // Compute standings
  const standingsOpts = { pointsPerWin: 3, pointsPerDraw: 1 };
  const throughRoundRecords = allMatchRecords.filter(
    (m) => m.round_number <= round.round_number
  );
  const prevRoundRecords = allMatchRecords.filter(
    (m) => m.round_number < round.round_number
  );

  const currentStandings = await computeStandingsForSeason(
    tournament.season_id,
    participantIds, participantNames, throughRoundRecords,
    participantAvatars, standingsOpts, gymTypes
  );
  const previousStandings = prevRoundRecords.length > 0
    ? await computeStandingsForSeason(
        tournament.season_id,
        participantIds, participantNames, prevRoundRecords,
        participantAvatars, standingsOpts, gymTypes
      )
    : null;

  // Build fact objects
  const matchFacts = matchDetails.map((d) => buildMatchFact(d, gen));
  const currentStandingFacts = buildStandingFacts(currentStandings, previousStandings);
  const previousStandingFacts = previousStandings ? buildStandingFacts(previousStandings, null) : null;

  // Server-computed UI data (pass through to output)
  const matchData = buildMatchData(matchDetails, participantAvatars);
  const pokemonTypes = buildPokemonTypesLookup(matchDetails, gen);

  // Aggregate pokemon usage across all matches this round
  const pokemonUsage = buildPokemonUsage(matchDetails);

  // Determine best performer and unusual pick
  const bestPerformer = selectBestPerformer(matchFacts);
  const unusualPick = detectUnusualPick(matchDetails, gymTypes, participantNames);

  // Build allowlists
  const validPlayerNames = participants.map((p) => p.name);
  const validPokemonNames = [...new Set(
    matchDetails.flatMap((d) => [...d.p1Team, ...d.p2Team].map((p) => p.pokemonName))
  )];

  // Standings change descriptions
  const standingsChanges = buildStandingsChanges(currentStandingFacts, previousStandingFacts);

  return {
    leagueName: seasonData?.season.name ?? null,
    tournamentName: tournament.name,
    roundName: round.name,
    roundNumber: round.round_number,
    format: ruleset?.base_format ?? 'unknown',
    gen,
    bestOf: tournament.best_of_default,
    scoring: '3 points for a win, 1 point for a draw, 0 points for a loss',
    gymTypes,

    matches: matchFacts,
    currentStandings: currentStandingFacts,
    previousStandings: previousStandingFacts,
    standingsChanges,
    pokemonUsage,
    bestPerformer,
    unusualPick,

    validPlayerNames,
    validPokemonNames,
    matchData,
    pokemonTypes,
  };
}

// ─── Forecast Fact Pack ─────────────────────────────────────────────

export async function buildForecastFactPack(
  tournamentId: string,
  roundId: string
): Promise<ForecastFactPack> {
  const [tournament, round, participants] = await Promise.all([
    getTournamentById(tournamentId),
    getRoundById(roundId),
    getParticipants(tournamentId),
  ]);

  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  if (!round) throw new Error(`Round ${roundId} not found`);

  const [roundMatches, allMatchRecords, ruleset, seasonData] = await Promise.all([
    getMatchesByRound(roundId),
    getCompletedMatchRecords(tournamentId),
    tournament.ruleset_id ? getRulesetById(tournament.ruleset_id) : Promise.resolve(null),
    tournament.season_id ? fetchSeasonContext(tournament.season_id) : Promise.resolve(null),
  ]);

  const gen = parseGenFromFormat(ruleset?.base_format);

  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name;
    participantAvatars[p.id] = p.avatar_url;
  }
  const gymTypes: Record<string, string | null> = {};
  if (seasonData?.participants) {
    for (const sp of seasonData.participants) {
      gymTypes[sp.id] = sp.gym_type;
    }
  }

  const currentStandings = allMatchRecords.length > 0
    ? await computeStandingsForSeason(
        tournament.season_id,
        participantIds, participantNames, allMatchRecords,
        participantAvatars, { pointsPerWin: 3, pointsPerDraw: 1 }, gymTypes
      )
    : [];

  const playerTeams = await fetchMatchupTeams(roundMatches, tournamentId);

  // Build matchup facts
  const standingFacts = buildStandingFacts(currentStandings, null);
  const rankMap: Record<string, number> = {};
  const recordMap: Record<string, string> = {};
  for (const s of standingFacts) {
    rankMap[s.playerName] = s.rank;
    recordMap[s.playerName] = s.recordString;
  }

  const matchups: MatchupFact[] = roundMatches
    .filter((m) => m.status !== 'completed')
    .map((m) => {
      // Head-to-head
      const h2h = allMatchRecords.filter(
        (r) =>
          (r.player_1_id === m.player_1_id && r.player_2_id === m.player_2_id) ||
          (r.player_1_id === m.player_2_id && r.player_2_id === m.player_1_id)
      );
      const p1Wins = h2h.filter((r) => r.winner_id === m.player_1_id).length;
      const p2Wins = h2h.filter((r) => r.winner_id === m.player_2_id).length;
      const headToHead = h2h.length > 0
        ? `${m.player_1_name} leads ${p1Wins}-${p2Wins}`
        : 'First meeting';

      return {
        player1Name: m.player_1_name,
        player2Name: m.player_2_name,
        player1Rank: rankMap[m.player_1_name] ?? null,
        player2Rank: rankMap[m.player_2_name] ?? null,
        headToHead,
        player1Team: playerTeams[m.player_1_id] ?? [],
        player2Team: playerTeams[m.player_2_id] ?? [],
        player1Record: recordMap[m.player_1_name] ?? 'N/A',
        player2Record: recordMap[m.player_2_name] ?? 'N/A',
      };
    });

  const validPlayerNames = participants.map((p) => p.name);
  const validPokemonNames = [...new Set(
    Object.values(playerTeams).flat()
  )];

  return {
    leagueName: seasonData?.season.name ?? null,
    tournamentName: tournament.name,
    roundName: round.name,
    roundNumber: round.round_number,
    format: ruleset?.base_format ?? 'unknown',
    gen,
    bestOf: tournament.best_of_default,
    scoring: '3 points for a win, 1 point for a draw, 0 points for a loss',
    gymTypes,
    matchups,
    currentStandings: standingFacts,
    validPlayerNames,
    validPokemonNames,
  };
}

// ─── Match Fact Builder ─────────────────────────────────────────────

interface MatchDetail {
  match: MatchWithPlayers;
  p1Team: AggregatedPokemon[];
  p2Team: AggregatedPokemon[];
  p1Score: number;
  p2Score: number;
  p1TotalKos: number;
  p2TotalKos: number;
  gamesPlayed: number;
}

function buildMatchFact(detail: MatchDetail, _gen: number): MatchFact {
  const { match, p1Team, p2Team, p1Score, p2Score, p1TotalKos, p2TotalKos, gamesPlayed } = detail;
  const isP1Winner = match.winner_id === match.player_1_id;

  const winnerName = isP1Winner ? match.player_1_name : match.player_2_name;
  const loserName = isP1Winner ? match.player_2_name : match.player_1_name;
  const winnerScore = isP1Winner ? p1Score : p2Score;
  const loserScore = isP1Winner ? p2Score : p1Score;
  const winnerTeam = isP1Winner ? p1Team : p2Team;
  const loserTeam = isP1Winner ? p2Team : p1Team;

  const mvp = winnerTeam.find((p) => p.isMvp);
  const marginDescription = computeMarginDescription(winnerScore, loserScore);
  const scoreString = `${winnerScore}-${loserScore}`;

  const winnerPerformances = buildTeamPerformances(winnerTeam);
  const loserPerformances = buildTeamPerformances(loserTeam);

  // Build key performance bullet points
  const keyPerformances: string[] = [];
  if (mvp) {
    keyPerformances.push(`${mvp.pokemonName} earned MVP for ${winnerName} with ${mvp.totalKos} KO${mvp.totalKos !== 1 ? 's' : ''}`);
  }
  for (const p of [...winnerTeam, ...loserTeam]) {
    if (p.totalKos >= 2 && !p.isMvp) {
      const owner = winnerTeam.includes(p) ? winnerName : loserName;
      keyPerformances.push(`${p.pokemonName} scored ${p.totalKos} KOs for ${owner}`);
    }
  }

  const preWrittenOneLiner = buildPreWrittenOneLiner(
    winnerName, loserName, scoreString, marginDescription, mvp
  );

  return {
    matchId: match.id,
    player1Name: match.player_1_name,
    player2Name: match.player_2_name,
    winnerName,
    loserName,
    winnerScore,
    loserScore,
    marginDescription,
    scoreString,
    player1TotalKos: p1TotalKos,
    player2TotalKos: p2TotalKos,
    gamesPlayed,
    mvpPokemon: mvp?.pokemonName ?? '',
    mvpPlayerName: winnerName,
    mvpKos: mvp?.totalKos ?? 0,
    winnerTeam: winnerPerformances,
    loserTeam: loserPerformances,
    preWrittenOneLiner,
    keyPerformances,
  };
}

function buildTeamPerformances(team: AggregatedPokemon[]): PokemonPerformance[] {
  return team
    .filter((p) => p.timesBrought > 0)
    .map((p) => ({
      pokemonName: p.pokemonName,
      totalKos: p.totalKos,
      wasKoed: p.wasKoed,
      wasLead: p.wasLead,
      isMvp: p.isMvp,
      movesUsed: p.movesUsed,
    }));
}

// ─── Margin Description ─────────────────────────────────────────────

/**
 * Deterministic description of a match score margin.
 * This is the #1 anti-hallucination measure — the server tells the LLM
 * exactly how to characterize the margin instead of letting it guess.
 */
export function computeMarginDescription(winnerScore: number, loserScore: number): string {
  const diff = winnerScore - loserScore;

  if (loserScore === 0 && winnerScore === 1) return 'the closest possible margin (1-0)';
  if (loserScore === 0 && winnerScore === 2) return 'a comfortable win (2-0)';
  if (loserScore === 0 && winnerScore >= 3) return `a dominant sweep (${winnerScore}-0)`;

  if (diff === 1) return `a close match (${winnerScore}-${loserScore})`;
  if (diff === 2) return `a comfortable margin (${winnerScore}-${loserScore})`;
  if (diff >= 3) return `a commanding victory (${winnerScore}-${loserScore})`;

  return `a ${winnerScore}-${loserScore} result`;
}

// ─── Pre-Written One-Liner ──────────────────────────────────────────

function buildPreWrittenOneLiner(
  winnerName: string,
  loserName: string,
  scoreString: string,
  marginDescription: string,
  mvp: AggregatedPokemon | undefined
): string {
  const base = `${winnerName} defeated ${loserName} ${scoreString} in ${marginDescription}`;
  if (mvp && mvp.totalKos > 0) {
    return `${base}, with ${mvp.pokemonName} earning MVP honors (${mvp.totalKos} KO${mvp.totalKos !== 1 ? 's' : ''}).`;
  }
  return `${base}.`;
}

// ─── Standing Facts ─────────────────────────────────────────────────

function buildStandingFacts(
  current: Standing[],
  previous: Standing[] | null
): StandingFact[] {
  const prevRankMap: Record<string, number> = {};
  if (previous) {
    previous.forEach((s, i) => { prevRankMap[s.player_id] = i + 1; });
  }

  return current.map((s, i) => {
    const rank = i + 1;
    const prevRank = prevRankMap[s.player_id];

    let rankChange: string;
    if (!previous) {
      rankChange = `#${rank}`;
    } else if (prevRank === undefined) {
      rankChange = `new entry at #${rank}`;
    } else if (prevRank === rank) {
      rankChange = `unchanged at #${rank}`;
    } else if (prevRank > rank) {
      rankChange = `up ${prevRank - rank} from #${prevRank} to #${rank}`;
    } else {
      rankChange = `down ${rank - prevRank} from #${prevRank} to #${rank}`;
    }

    const recordString = `${s.wins}W-${s.losses}L${s.draws > 0 ? `-${s.draws}D` : ''}`;
    const kdString = s.kill_differential > 0
      ? `+${s.kill_differential}`
      : `${s.kill_differential}`;

    return {
      rank,
      playerName: s.player_name,
      playerId: s.player_id,
      gymType: s.gym_type,
      points: s.points,
      recordString,
      kdString,
      rankChange,
      wins: s.wins,
      losses: s.losses,
      draws: s.draws,
      killDifferential: s.kill_differential,
    };
  });
}

function buildStandingsChanges(
  current: StandingFact[],
  previous: StandingFact[] | null
): string[] {
  if (!previous) return [];
  const changes: string[] = [];

  for (const s of current) {
    if (s.rankChange.startsWith('up') || s.rankChange.startsWith('down')) {
      changes.push(`${s.playerName} moved ${s.rankChange}`);
    }
  }

  return changes;
}

// ─── Pokemon Usage ──────────────────────────────────────────────────

function buildPokemonUsage(
  details: MatchDetail[]
): { pokemonName: string; timesBrought: number; totalKos: number }[] {
  const usage: Record<string, { timesBrought: number; totalKos: number }> = {};

  for (const d of details) {
    for (const p of [...d.p1Team, ...d.p2Team]) {
      if (p.timesBrought === 0) continue;
      if (!usage[p.pokemonName]) {
        usage[p.pokemonName] = { timesBrought: 0, totalKos: 0 };
      }
      usage[p.pokemonName].timesBrought += p.timesBrought;
      usage[p.pokemonName].totalKos += p.totalKos;
    }
  }

  return Object.entries(usage)
    .map(([pokemonName, stats]) => ({ pokemonName, ...stats }))
    .sort((a, b) => b.timesBrought - a.timesBrought || b.totalKos - a.totalKos);
}

// ─── Best Performer ─────────────────────────────────────────────────

function selectBestPerformer(
  matchFacts: MatchFact[]
): { playerName: string; reason: string } | null {
  if (matchFacts.length === 0) return null;

  // Find the winner with the largest score margin
  let best: MatchFact | null = null;
  let bestDiff = -1;

  for (const mf of matchFacts) {
    const diff = mf.winnerScore - mf.loserScore;
    if (diff > bestDiff || (diff === bestDiff && mf.player1TotalKos + mf.player2TotalKos > 0)) {
      best = mf;
      bestDiff = diff;
    }
  }

  if (!best) return null;

  const parts: string[] = [`won ${best.scoreString}`];
  if (best.mvpPokemon) {
    parts.push(`${best.mvpPokemon} as MVP with ${best.mvpKos} KOs`);
  }

  return {
    playerName: best.winnerName,
    reason: parts.join(', '),
  };
}

// ─── Unusual Pick Detection ─────────────────────────────────────────

function detectUnusualPick(
  details: MatchDetail[],
  gymTypes: Record<string, string | null>,
  participantNames: Record<string, string>
): { pokemonName: string; playerName: string; reason: string } | null {
  // Look for Pokemon that don't match a player's gym type
  for (const d of details) {
    const checkTeam = (team: AggregatedPokemon[], playerId: string) => {
      const playerGymType = gymTypes[playerId];
      if (!playerGymType) return null;
      const playerName = participantNames[playerId] ?? 'Unknown';

      for (const p of team) {
        if (p.timesBrought === 0) continue;
        const species = getSpecies(p.pokemonName, 9);
        if (species && !species.types.some((t) => t === playerGymType)) {
          // Non-gym-type pick that performed well
          if (p.totalKos >= 2 || p.isMvp) {
            return {
              pokemonName: p.pokemonName,
              playerName,
              reason: `${playerGymType}-type Gym Leader brought off-type ${p.pokemonName} to strong effect (${p.totalKos} KOs)`,
            };
          }
        }
      }
      return null;
    };

    const result = checkTeam(d.p1Team, d.match.player_1_id) ?? checkTeam(d.p2Team, d.match.player_2_id);
    if (result) return result;
  }

  return null;
}

// ─── Match Data Builders (for UI pass-through) ──────────────────────

function buildMatchData(
  details: MatchDetail[],
  avatars: Record<string, string | null>
): RoundRecapMatchData[] {
  return details.map((d) => {
    const { match, p1Team, p2Team, p1Score, p2Score, p1TotalKos, p2TotalKos } = d;
    const isP1Winner = match.winner_id === match.player_1_id;
    const winnerTeam = isP1Winner ? p1Team : p2Team;
    const mvp = winnerTeam.find((p) => p.isMvp);

    return {
      match_id: match.id,
      player_1_id: match.player_1_id,
      player_1_name: match.player_1_name,
      player_1_avatar_url: avatars[match.player_1_id] ?? null,
      player_2_id: match.player_2_id,
      player_2_name: match.player_2_name,
      player_2_avatar_url: avatars[match.player_2_id] ?? null,
      winner_id: match.winner_id ?? match.player_1_id,
      winner_name: isP1Winner ? match.player_1_name : match.player_2_name,
      p1_score: p1Score,
      p2_score: p2Score,
      p1_total_kos: p1TotalKos,
      p2_total_kos: p2TotalKos,
      mvp_pokemon: mvp?.pokemonName ?? '',
      mvp_player_id: isP1Winner ? match.player_1_id : match.player_2_id,
      mvp_kos: mvp?.totalKos ?? 0,
    };
  });
}

function buildPokemonTypesLookup(
  details: MatchDetail[],
  gen: number
): Record<string, string[]> {
  const typeMap: Record<string, string[]> = {};
  const allTeams = details.flatMap((d) => [...d.p1Team, ...d.p2Team]);

  for (const mon of allTeams) {
    if (typeMap[mon.pokemonName]) continue;
    const species = getSpecies(mon.pokemonName, gen);
    typeMap[mon.pokemonName] = species ? [...species.types] : [];
  }

  return typeMap;
}

// ─── Data Fetchers (reused from tournament-report-context.ts) ───────

interface SeasonContext {
  season: { id: string; name: string; description: string | null; format_type: string };
  participants: { id: string; gym_type: string | null; player_name: string }[];
}

async function fetchSeasonContext(seasonId: string): Promise<SeasonContext | null> {
  const [season, participants] = await Promise.all([
    getSeasonById(seasonId),
    getSeasonParticipants(seasonId),
  ]);
  if (!season) return null;
  return {
    season: {
      id: season.id,
      name: season.name,
      description: season.description ?? null,
      format_type: season.format_type,
    },
    participants: participants.map((p) => ({
      id: p.id,
      gym_type: p.gym_type,
      player_name: p.name ?? 'Unknown',
    })),
  };
}

async function fetchMatchDetails(matches: MatchWithPlayers[]): Promise<MatchDetail[]> {
  const completed = matches.filter((m) => m.status === 'completed' && m.winner_id);
  const details: MatchDetail[] = [];

  const statResults = await Promise.all(
    completed.map((m) =>
      getBattleStatsByMatch(m.id).catch(() => ({} as Record<string, BattleStat[]>))
    )
  );

  for (let i = 0; i < completed.length; i++) {
    const match = completed[i];
    const battleStatsByGame = statResults[i];
    const hasStats = Object.keys(battleStatsByGame).length > 0;

    const p1Team = hasStats
      ? aggregateTeamFromStats(battleStatsByGame, match.player_1_id, match.winner_id === match.player_1_id)
      : [];
    const p2Team = hasStats
      ? aggregateTeamFromStats(battleStatsByGame, match.player_2_id, match.winner_id === match.player_2_id)
      : [];

    const { p1Score, p2Score } = hasStats
      ? computePokemonScore(battleStatsByGame, match.player_1_id, match.player_2_id)
      : { p1Score: 0, p2Score: 0 };

    const quickStats = hasStats
      ? computeQuickStats(battleStatsByGame, match.player_1_id, match.player_2_id)
      : { p1TotalKos: 0, p2TotalKos: 0, gamesPlayed: 0 };

    details.push({
      match,
      p1Team,
      p2Team,
      p1Score,
      p2Score,
      p1TotalKos: quickStats.p1TotalKos,
      p2TotalKos: quickStats.p2TotalKos,
      gamesPlayed: quickStats.gamesPlayed,
    });
  }

  return details;
}

async function fetchMatchupTeams(
  matches: MatchWithPlayers[],
  tournamentId: string
): Promise<Record<string, string[]>> {
  const playerIds = new Set<string>();
  for (const m of matches) {
    playerIds.add(m.player_1_id);
    playerIds.add(m.player_2_id);
  }

  const teamMap: Record<string, string[]> = {};
  await Promise.all(
    [...playerIds].map(async (pid) => {
      const team = await getPlayerTeamForTournament(pid, tournamentId);
      if (team?.pokemon) {
        const pokemon = team.pokemon as { species: string }[];
        teamMap[pid] = pokemon.map((p) => p.species).filter(Boolean);
      }
    })
  );

  return teamMap;
}
