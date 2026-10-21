import { getMatchById, getH2HBetweenPlayers, getMatchesByPlayer, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getPlayerTeamForMatch } from '@/lib/supabase/queries/teams';
import { decideMatchRosterVisibility, type TeamViewer } from '@/lib/team/visibility';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { resolveActualTeam } from '@/lib/match/aggregation';
import { getPlayerRatingsBatch } from '@/lib/supabase/queries/ratings';
import { getPlayerSignaturesBatch } from '@/lib/supabase/queries/signatures';
import { getPlayerStreaks } from '@/lib/supabase/queries/streaks';
import { getAggregates, getTotalGamesInScope, getPlayerAggregatesForPokemon } from '@/lib/supabase/queries/aggregates';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { getBaseStats } from '@/lib/pkmn/dex';
import { getItemSpriteUrl } from '@/lib/pkmn/sprites';
import { siteSpriteUrl } from '@/lib/pkmn/sprite-styles';
import { calcSpeed } from '@/lib/pkmn/speed-calc';
import { classifyTeam } from '@/lib/pkmn/archetype';
import type { PokemonSet } from '@/types/team';
import type { Aggregate, PlayerAggregate } from '@/types/game';
import type { CasterData, CasterPokemonInfo, CasterH2H } from '@/types/caster';
import type { MatchRecord } from '@/lib/tournament/types';

// ─── Helpers ────────────────────────────────────────────────────────

function enrichPokemon(
  set: PokemonSet,
  gen: number,
  aggregateMap: Map<string, Aggregate>,
  totalGames: number,
  playerAggMap: Map<string, PlayerAggregate>
): CasterPokemonInfo {
  const stats = getBaseStats(set.species, gen);
  const baseSpe = stats?.baseStats.spe ?? 0;
  const level = set.level || 100;

  const agg = aggregateMap.get(set.species.toLowerCase());
  const playerAgg = playerAggMap.get(set.species.toLowerCase());

  return {
    species: set.species,
    types: stats?.types ?? [],
    baseStats: stats?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ability: set.ability,
    item: set.item,
    moves: set.moves,
    spriteUrl: siteSpriteUrl(set.species),
    itemSpriteUrl: set.item ? getItemSpriteUrl(set.item) : null,
    usagePct: agg && totalGames > 0 ? Math.round((agg.total_appearances / totalGames) * 1000) / 10 : null,
    leadPct: agg && agg.total_appearances > 0 ? Math.round((agg.total_led / agg.total_appearances) * 1000) / 10 : null,
    bringPct: agg && agg.total_appearances > 0 ? Math.round((agg.total_brought / agg.total_appearances) * 1000) / 10 : null,
    koDealt: playerAgg?.total_kos_dealt ?? 0,
    koReceived: playerAgg?.total_koed ?? 0,
    speedTiers: {
      min: calcSpeed({ baseSpe, level, ev: 0, iv: 31, nature: 'negative' }),
      neutral: calcSpeed({ baseSpe, level, ev: 0, iv: 31, nature: 'neutral' }),
      max: calcSpeed({ baseSpe, level, ev: 252, iv: 31, nature: 'positive' }),
      scarf: calcSpeed({ baseSpe, level, ev: 252, iv: 31, nature: 'positive', item: 'Choice Scarf' }),
    },
  };
}

// ─── Main data fetcher (server-side only) ───────────────────────────

/**
 * Everything the caster tools show for one match. The rosters follow spec §7
 * for `viewer`, decided against this match: before the match is completed
 * (and unless the tournament is `always_public`) only an admin or the team's
 * owner gets a roster; a creator gets an empty one.
 */
export async function fetchCasterData(
  matchId: string,
  viewer: TeamViewer
): Promise<CasterData | null> {
  const match = await getMatchById(matchId);
  if (!match) return null;

  const p1Id = match.player_1_id;
  const p2Id = match.player_2_id;
  const tournamentId = match.tournament_id;

  // ── Parallel fetch all context ──────────────────────────────────
  const [
    round,
    tournament,
    ratingMap,
    sigMap,
    p1Streaks,
    p2Streaks,
    p1Team,
    p2Team,
    h2hMatches,
    aggregates,
    totalGames,
    matchRecords,
    p1AllMatches,
    p2AllMatches,
    battleStatsByGame,
  ] = await Promise.all([
    getRoundById(match.round_id),
    tournamentId ? getTournamentById(tournamentId) : null,
    getPlayerRatingsBatch([p1Id, p2Id]),
    getPlayerSignaturesBatch([p1Id, p2Id]),
    getPlayerStreaks(p1Id),
    getPlayerStreaks(p2Id),
    tournamentId ? getPlayerTeamForMatch(p1Id, match) : null,
    tournamentId ? getPlayerTeamForMatch(p2Id, match) : null,
    tournamentId ? getH2HBetweenPlayers(p1Id, p2Id, tournamentId) : [],
    tournamentId ? getAggregates('tournament', tournamentId) : [],
    tournamentId ? getTotalGamesInScope('tournament', tournamentId) : 0,
    tournamentId ? getCompletedMatchRecords(tournamentId) : [],
    tournamentId ? getMatchesByPlayer(p1Id, tournamentId) : [],
    tournamentId ? getMatchesByPlayer(p2Id, tournamentId) : [],
    // A failed read fails the request (the caller's safeErrorResponse): an
    // empty map would silently fall back to the planned rosters.
    getBattleStatsByMatch(matchId),
  ]);

  // Extract generation from ruleset base_format
  const ruleset = tournament ? await getRulesetById(tournament.ruleset_id) : null;
  const formatStr = ruleset?.base_format ?? 'gen9ou';
  const genMatch = formatStr.match(/gen(\d+)/);
  const gen = genMatch ? parseInt(genMatch[1], 10) : 9;
  const bestOf = round?.best_of ?? tournament?.best_of_default ?? 3;

  // ── Build aggregate lookup ──────────────────────────────────────
  const aggMap = new Map<string, Aggregate>();
  for (const a of aggregates) {
    aggMap.set(a.pokemon_name.toLowerCase(), a);
  }

  // ── Spec §7 per match: which rosters this viewer may see ─────────
  const tournamentVisibility = tournament?.team_visibility ?? null;
  const p1Visible = p1Team
    ? decideMatchRosterVisibility(p1Team, viewer, match, tournamentVisibility)
    : false;
  const p2Visible = p2Team
    ? decideMatchRosterVisibility(p2Team, viewer, match, tournamentVisibility)
    : false;

  // ── Resolve actual teams: prefer battle_stats over planned teams ──
  const hasGameStats = Object.keys(battleStatsByGame).length > 0;
  const p1Sets = p1Visible
    ? ((hasGameStats
        ? resolveActualTeam(battleStatsByGame, p1Id, p1Team?.pokemon ?? [])
        : null) ?? p1Team?.pokemon ?? [])
    : [];
  const p2Sets = p2Visible
    ? ((hasGameStats
        ? resolveActualTeam(battleStatsByGame, p2Id, p2Team?.pokemon ?? [])
        : null) ?? p2Team?.pokemon ?? [])
    : [];

  // ── Player aggregate lookup ───────────────────────────────────
  const allSpecies = [...p1Sets, ...p2Sets].map((s) => s.species);

  const playerAggResults = await Promise.all(
    allSpecies.map((species) =>
      tournamentId
        ? getPlayerAggregatesForPokemon(species, 'tournament', tournamentId)
        : Promise.resolve([])
    )
  );

  const p1AggMap = new Map<string, PlayerAggregate>();
  const p2AggMap = new Map<string, PlayerAggregate>();
  for (let i = 0; i < allSpecies.length; i++) {
    const rows = playerAggResults[i] ?? [];
    const species = allSpecies[i].toLowerCase();
    for (const row of rows) {
      if (row.player_id === p1Id) p1AggMap.set(species, row);
      if (row.player_id === p2Id) p2AggMap.set(species, row);
    }
  }

  // ── Player records ──────────────────────────────────────────────
  function buildRecord(playerId: string) {
    let wins = 0, losses = 0, draws = 0;
    for (const m of matchRecords as MatchRecord[]) {
      if (m.player_1_id !== playerId && m.player_2_id !== playerId) continue;
      if (m.winner_id === playerId) wins++;
      else if (m.winner_id === null) draws++;
      else losses++;
    }
    return { wins, losses, draws };
  }

  // ── Streak info ─────────────────────────────────────────────────
  function buildStreak(streaks: typeof p1Streaks) {
    if (!streaks) return { type: null as null, count: 0 };
    if (streaks.current_win_streak > 0) return { type: 'win' as const, count: streaks.current_win_streak };
    if (streaks.current_loss_streak > 0) return { type: 'loss' as const, count: streaks.current_loss_streak };
    return { type: null as null, count: 0 };
  }

  // ── Next match ────────────────────────────────────────────────
  function findNextMatch(playerId: string, allMatches: typeof p1AllMatches) {
    const upcoming = allMatches.find(
      (m) => m.id !== matchId && m.status !== 'completed'
    );
    if (!upcoming) return null;
    const oppName = upcoming.player_1_id === playerId
      ? upcoming.player_2_name
      : upcoming.player_1_name;
    return { opponentName: oppName, roundName: null };
  }

  // ── Enrich pokemon ──────────────────────────────────────────────
  const p1Pokemon = p1Sets.map((s) => enrichPokemon(s, gen, aggMap, totalGames, p1AggMap));
  const p2Pokemon = p2Sets.map((s) => enrichPokemon(s, gen, aggMap, totalGames, p2AggMap));

  // ── H2H ─────────────────────────────────────────────────────────
  const h2h: CasterH2H = {
    player1Wins: h2hMatches.filter((m) => m.winner_id === p1Id).length,
    player2Wins: h2hMatches.filter((m) => m.winner_id === p2Id).length,
    draws: h2hMatches.filter((m) => m.winner_id === null).length,
    pastMatches: h2hMatches.map((m) => ({
      matchId: m.id,
      roundName: null,
      winnerId: m.winner_id,
      date: m.date_played ?? m.created_at,
    })),
  };

  // ── Standings ───────────────────────────────────────────────────
  let standings = null;
  if (matchRecords.length > 0) {
    // Derive participant info from match records
    const participantIds = new Set<string>();
    const participantNames: Record<string, string> = {};
    for (const m of p1AllMatches) {
      participantIds.add(m.player_1_id);
      participantIds.add(m.player_2_id);
      participantNames[m.player_1_id] = m.player_1_name;
      participantNames[m.player_2_id] = m.player_2_name;
    }
    for (const m of p2AllMatches) {
      participantIds.add(m.player_1_id);
      participantIds.add(m.player_2_id);
      participantNames[m.player_1_id] = m.player_1_name;
      participantNames[m.player_2_id] = m.player_2_name;
    }
    const ids = Array.from(participantIds);
    if (ids.length > 0) {
      // Format-aware: EPB seasons use the evolution-points tiebreaker chain
      const computed = await computeStandingsForSeason(
        tournament?.season_id ?? null, ids, participantNames, matchRecords
      );
      standings = computed.slice(0, 12).map((s, i) => ({
        playerId: s.player_id,
        playerName: s.player_name,
        rank: i + 1,
        points: s.points,
        wins: s.wins,
        losses: s.losses,
      }));
    }
  }

  // ── Assemble ──────────────────────────────────────────────────
  const p1Rating = ratingMap.get(p1Id);
  const p2Rating = ratingMap.get(p2Id);
  const p1Sigs = sigMap.get(p1Id);
  const p2Sigs = sigMap.get(p2Id);

  return {
    matchId,
    tournamentId,
    seasonId: tournament?.season_id ?? null,
    roundName: round?.name ?? null,
    bestOf,
    format: formatStr,
    generation: gen,
    player1: {
      id: p1Id,
      name: match.player_1_name,
      avatarUrl: match.player_1_avatar_url,
      rating: p1Rating?.rating ?? null,
      rd: p1Rating?.rd ?? null,
      record: buildRecord(p1Id),
      signaturePokemon: p1Sigs?.[0]?.pokemon_name ?? null,
      streak: buildStreak(p1Streaks),
      team: p1Sets,
      pokemon: p1Pokemon,
      archetype: p1Sets.length > 0 ? classifyTeam(p1Sets, gen) : null,
      nextMatch: findNextMatch(p1Id, p1AllMatches),
    },
    player2: {
      id: p2Id,
      name: match.player_2_name,
      avatarUrl: match.player_2_avatar_url,
      rating: p2Rating?.rating ?? null,
      rd: p2Rating?.rd ?? null,
      record: buildRecord(p2Id),
      signaturePokemon: p2Sigs?.[0]?.pokemon_name ?? null,
      streak: buildStreak(p2Streaks),
      team: p2Sets,
      pokemon: p2Pokemon,
      archetype: p2Sets.length > 0 ? classifyTeam(p2Sets, gen) : null,
      nextMatch: findNextMatch(p2Id, p2AllMatches),
    },
    h2h,
    standings,
  };
}
