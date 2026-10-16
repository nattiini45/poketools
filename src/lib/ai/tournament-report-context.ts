import { getTournamentById, getParticipants } from '@/lib/supabase/queries/tournaments';
import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { getRoundById } from '@/lib/supabase/queries/rounds';
import { getMatchesByRound, getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getBattleStatsByMatch } from '@/lib/supabase/queries/games';
import { getPlayerTeamForTournament } from '@/lib/supabase/queries/teams';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { aggregateTeamFromStats, computePokemonScore, computeQuickStats } from '@/lib/match/aggregation';
import { buildRulesetSection, parseGenFromFormat } from './context-builder';
import { renderCoreAssignments } from './league-context';
import { getSpecies } from '@/lib/pkmn/dex';
import type { CoreTriple } from '@/types/season';
import type { MatchWithPlayers } from '@/types/match';
import type { AggregatedPokemon } from '@/lib/match/aggregation';
import type { Standing } from '@/lib/tournament/types';
import type { BattleStat } from '@/types/game';
import type { RoundRecapMatchData } from '@/types/tournament-report';

// ─── Types ──────────────────────────────────────────────────────────

export interface TournamentReportPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface RecapPromptResult extends TournamentReportPrompt {
  /** Server-computed match data — the UI source of truth */
  matchData: RoundRecapMatchData[];
  /** Pokémon species → types lookup for all Pokémon mentioned */
  pokemonTypes: Record<string, string[]>;
}

interface SeasonContext {
  season: { id: string; name: string; description: string | null; format_type: string };
  participants: { id: string; gym_type: string | null; core_types: CoreTriple | null; player_name: string }[];
}

/** Per-match detail assembled from battle_stats — same data as MatchHighlightCard */
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

// ─── System Prompts ─────────────────────────────────────────────────

function buildRecapSystemPrompt(gen: number): string {
  return `You are Kale Cabbage, a competitive Pokémon sports journalist. You write sharp, analytical round recaps for a tournament league. Your tone is authoritative and engaging — like a beat reporter who knows the scene.

VOICE:
- Lead with the most dramatic or consequential result
- Reference specific data: KO counts, scores, key Pokémon performances
- Frame everything through competitive stakes and standings implications
- Use Pokémon world flavor naturally, never at the expense of clarity
- Write like a sports column — narratives and takeaways, not play-by-play
- Measured, authoritative tone. No emojis. No exclamation marks
- Always use species names, never nicknames
- When Gym Leader Typings are present, note how gym types shaped team choices. When Assigned Core Types are present instead, note how each player's assigned types shaped their picks — do not call these gym types.

DATA RULES — CRITICAL (violating these rules makes the report unusable):
- ONLY use information from the DATA sections below. Every claim must trace to a specific data point.
- Each match section lists EXACTLY which Pokémon each player used, with KO counts and moves. Use ONLY these attributions.
- Do NOT guess or infer which player used a Pokémon. If it's in "PlayerA's team", it belongs to PlayerA. Period.
- SCORE FORMAT: "X-Y" means the winner had X Pokémon remaining, the loser had Y. A 1-0 result is the CLOSEST possible margin (barely won). A 3-0 result is a dominant sweep. Do NOT describe 1-0 as "worse" than 2-0 — it's closer/tighter.
- STANDINGS: When discussing points, records, or KD values, COPY exact values from the STANDINGS section verbatim. Do NOT calculate, estimate, or restate differently. If standings say "3pts (1W-0L) | KD: +2", write exactly that.
- HEADLINE: Base on actual score margins and data. Do not generalize (e.g. don't say "all matches ended in sweeps" unless every single score is 3-0 or higher).
- POINTS SYSTEM: The tournament scoring is defined in the TOURNAMENT section. Use those exact point values.
- Generation ${gen} rules. ONLY reference Pokémon, moves, abilities, and items from Gen ${gen}.

OUTPUT FORMAT:
Respond with a valid JSON object (no markdown fences, no extra text):
{
  "headline": "1-sentence round summary — the most newsworthy takeaway",
  "narrative": "3-5 paragraph analytical recap. Reference specific Pokémon performances, scores, and standings shifts. Use paragraph breaks (\\n\\n).",
  "match_summaries": [
    {
      "player_1_name": "Name",
      "player_2_name": "Name",
      "winner_name": "Name",
      "score": "e.g. 2-0 (remaining mons)",
      "one_liner": "1-sentence match recap referencing specific Pokémon from the data",
      "mvp_pokemon": "The MVP Pokémon from the match data (marked with ★ MVP)"
    }
  ],
  "standings_story": "2-3 sentences on standings shifts this round",
  "meta_trends": "2-3 sentences on Pokémon usage patterns from THIS round's matches only",
  "player_spotlight": {
    "player_name": "Best performer this round based on the data",
    "reason": "1-2 sentences with specific stats from the data"
  },
  "spicy_pick": {
    "pokemon_name": "Most unusual or notable pick from the match data",
    "player_name": "Who used it (from the match data)",
    "context": "Why it's notable"
  }
}

CONDITIONAL: Set spicy_pick to null if nothing stands out.`;
}

function buildForecastSystemPrompt(gen: number): string {
  return `You are Kale Cabbage, a competitive Pokémon sports journalist previewing the upcoming round. You make bold predictions backed by data.

VOICE:
- Frame each matchup as a story: rivalries, must-win situations, dark horses
- Reference specific stats from the data: records, team compositions, signature Pokémon
- Make clear predictions with reasoning — take a stand
- Build drama around standings implications
- Authoritative, measured tone. No emojis. No exclamation marks
- Always use species names, never nicknames

DATA RULES — CRITICAL:
- ONLY reference information from the DATA sections below
- When team sheets are provided, reference specific Pokémon from those teams
- Do NOT hallucinate stats, records, or team compositions
- When discussing standings, points, or records, ONLY use exact values from the STANDINGS section.
- Generation ${gen} rules. ONLY reference Gen ${gen} Pokémon, moves, abilities, items

OUTPUT FORMAT:
Respond with a valid JSON object (no markdown fences, no extra text):
{
  "headline": "1-sentence preview — the most compelling storyline",
  "narrative": "2-3 paragraph preview covering key matchups and stakes. Use paragraph breaks (\\n\\n).",
  "matchup_previews": [
    {
      "player_1_name": "Name",
      "player_2_name": "Name",
      "storyline": "2-3 sentences on why this matchup matters",
      "edge": "Who has the edge and why",
      "key_pokemon": "The Pokémon to watch"
    }
  ],
  "standings_context": "2-3 sentences on what's at stake — advancement, elimination",
  "players_to_watch": [
    { "player_name": "Name", "reason": "1-2 sentences why" }
  ],
  "bold_prediction": "A specific, bold prediction — be concrete"
}`;
}

// ─── Recap Prompt Builder ───────────────────────────────────────────

export async function buildRoundRecapPrompt(
  tournamentId: string,
  roundId: string
): Promise<RecapPromptResult> {
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

  // Fetch per-match battle stats for all completed matches in this round
  const matchDetails = await fetchMatchDetails(roundMatches);

  // Build standings scoped to through this round (not future)
  const throughRoundRecords = allMatchRecords.filter(
    (m) => m.round_number <= round.round_number
  );
  const prevRoundRecords = allMatchRecords.filter(
    (m) => m.round_number < round.round_number
  );

  const { participantIds, participantNames, participantAvatars, gymTypes } =
    buildParticipantLookups(participants, seasonData);

  const standingsOpts = { pointsPerWin: 3, pointsPerDraw: 1 };
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

  // ── Build server-computed match data (UI source of truth) ──────
  const matchData = buildMatchData(matchDetails, participantAvatars);
  const pokemonTypes = buildPokemonTypesLookup(matchDetails, gen);

  // ── Assemble user prompt ────────────────────────────────────────
  const sections: string[] = [];

  if (seasonData?.season) {
    sections.push(formatLeagueSection(seasonData));
  }
  sections.push(formatTournamentSection(tournament, round));
  sections.push(buildRulesetSection(ruleset, tournament.is_doubles ?? false, gen));
  sections.push(formatMatchDetailsSection(matchDetails, round.name, currentStandings, previousStandings));
  sections.push(formatStandingsSection(currentStandings, previousStandings, round.name));

  return {
    systemPrompt: buildRecapSystemPrompt(gen),
    userPrompt: sections.join('\n\n'),
    matchData,
    pokemonTypes,
  };
}

// ─── Forecast Prompt Builder ────────────────────────────────────────

export async function buildRoundForecastPrompt(
  tournamentId: string,
  roundId: string
): Promise<TournamentReportPrompt> {
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

  const { participantIds, participantNames, participantAvatars, gymTypes } =
    buildParticipantLookups(participants, seasonData);

  const currentStandings = allMatchRecords.length > 0
    ? await computeStandingsForSeason(
        tournament.season_id,
        participantIds, participantNames, allMatchRecords,
        participantAvatars, { pointsPerWin: 3, pointsPerDraw: 1 }, gymTypes
      )
    : [];

  const playerTeams = await fetchMatchupTeams(roundMatches, tournamentId);

  const sections: string[] = [];

  if (seasonData?.season) {
    sections.push(formatLeagueSection(seasonData));
  }
  sections.push(formatTournamentSection(tournament, round));
  sections.push(buildRulesetSection(ruleset, tournament.is_doubles ?? false, gen));

  if (currentStandings.length > 0) {
    sections.push(formatStandingsSection(currentStandings, null, 'Current'));
  }

  sections.push(formatPairingsSection(roundMatches, currentStandings, allMatchRecords, playerTeams));

  return {
    systemPrompt: buildForecastSystemPrompt(gen),
    userPrompt: sections.join('\n\n'),
  };
}

// ─── Data Fetchers ──────────────────────────────────────────────────

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
      core_types: p.core_types,
      player_name: p.name ?? 'Unknown',
    })),
  };
}

/**
 * Fetch full battle stats for each completed match — the same data
 * that populates MatchHighlightCard. This gives us per-player rosters
 * with KOs, moves, lead status, and MVP attribution.
 */
async function fetchMatchDetails(matches: MatchWithPlayers[]): Promise<MatchDetail[]> {
  const completed = matches.filter((m) => m.status === 'completed' && m.winner_id);
  const details: MatchDetail[] = [];

  // Fetch battle stats in parallel for all completed matches
  const statResults = await Promise.all(
    completed.map((m) => getBattleStatsByMatch(m.id).catch(() => ({} as Record<string, BattleStat[]>)))
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

// ─── Match Data Builders ────────────────────────────────────────────

/** Build server-computed match data array from match details — the UI source of truth */
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

/** Build a species → types lookup for all Pokémon mentioned in match details */
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

// ─── Participant Helpers ────────────────────────────────────────────

function buildParticipantLookups(
  participants: { id: string; name: string; avatar_url: string | null }[],
  seasonData: SeasonContext | null
) {
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

  return { participantIds, participantNames, participantAvatars, gymTypes };
}

// ─── Section Formatters ─────────────────────────────────────────────

function formatLeagueSection(seasonData: SeasonContext): string {
  const { season, participants } = seasonData;
  const lines = [
    '## LEAGUE CONTEXT',
    `League: ${season.name}`,
    `Format: ${season.format_type}`,
  ];

  if (season.description) {
    lines.push(`Description: ${season.description}`);
  }

  const gymParticipants = participants.filter((p) => p.gym_type);
  if (gymParticipants.length > 0) {
    lines.push('', 'Gym Leader Typings:');
    for (const p of gymParticipants) {
      lines.push(`- ${p.player_name}: ${p.gym_type}-type Gym`);
    }
  }

  const coreLines = renderCoreAssignments(
    participants.map((p) => ({ name: p.player_name, core: p.core_types })),
  );
  if (coreLines.length > 0) {
    lines.push('', ...coreLines);
  }

  return lines.join('\n') + '\n';
}

function formatTournamentSection(
  tournament: { name: string; bracket_type: string; best_of_default: number; description?: string | null },
  round: { name: string; round_number: number }
): string {
  const lines = [
    '## TOURNAMENT',
    `Name: ${tournament.name}`,
    `Format: ${tournament.bracket_type.replace('_', ' ')}`,
    `Best of: ${tournament.best_of_default}`,
    'Scoring: 3 points for a win, 1 point for a draw, 0 points for a loss',
    `Reporting on: ${round.name} (Round ${round.round_number})`,
  ];
  if (tournament.description) {
    lines.push(`Description: ${tournament.description}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The core improvement: per-match detail blocks with full roster data.
 * Each match gets its own section showing both players' Pokémon with
 * KOs, moves used, lead/KO'd/MVP status — exactly what MatchHighlightCard shows.
 */
function formatMatchDetailsSection(
  details: MatchDetail[],
  roundName: string,
  currentStandings: Standing[],
  previousStandings: Standing[] | null
): string {
  if (details.length === 0) {
    return `## ${roundName} MATCH RESULTS\nNo completed matches.\n`;
  }

  // Build rank lookups for before/after this round
  const afterRankMap: Record<string, number> = {};
  currentStandings.forEach((s, i) => { afterRankMap[s.player_id] = i + 1; });
  const beforeRankMap: Record<string, number> = {};
  if (previousStandings) {
    previousStandings.forEach((s, i) => { beforeRankMap[s.player_id] = i + 1; });
  }

  function playerRankLabel(playerId: string): string {
    const after = afterRankMap[playerId];
    const before = beforeRankMap[playerId];
    if (!after) return '';
    if (before && before !== after) {
      const dir = before > after ? 'up' : 'down';
      return ` — Rank: #${before} → #${after} (${dir} ${Math.abs(before - after)})`;
    }
    if (before) return ` — Rank: #${after} (unchanged)`;
    return ` — Rank: #${after} (new)`;
  }

  const sections: string[] = [`## ${roundName} MATCH RESULTS`];

  for (const d of details) {
    const { match, p1Team, p2Team, p1Score, p2Score, p1TotalKos, p2TotalKos } = d;
    const isP1Winner = match.winner_id === match.player_1_id;
    const winnerName = isP1Winner ? match.player_1_name : match.player_2_name;
    const winScore = isP1Winner ? p1Score : p2Score;
    const loseScore = isP1Winner ? p2Score : p1Score;

    const lines: string[] = [];
    lines.push(`### ${match.player_1_name} vs ${match.player_2_name}`);
    lines.push(`Result: ${winnerName} wins ${winScore}-${loseScore} (remaining Pokémon)`);
    lines.push(`Total KOs: ${match.player_1_name} ${p1TotalKos} — ${match.player_2_name} ${p2TotalKos}`);

    // Player 1 roster + rank
    lines.push('');
    lines.push(`${match.player_1_name}${isP1Winner ? ' (WINNER)' : ' (LOSER)'}${playerRankLabel(match.player_1_id)}:`);
    lines.push(formatTeamRoster(p1Team));

    // Player 2 roster + rank
    lines.push('');
    lines.push(`${match.player_2_name}${!isP1Winner ? ' (WINNER)' : ' (LOSER)'}${playerRankLabel(match.player_2_id)}:`);
    lines.push(formatTeamRoster(p2Team));

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n') + '\n';
}

function formatTeamRoster(team: AggregatedPokemon[]): string {
  if (team.length === 0) return '  (no team data available)';

  const lines: string[] = [];
  for (const p of team) {
    const tags: string[] = [];
    if (p.isMvp) tags.push('★ MVP');
    if (p.wasLead) tags.push('LEAD');
    if (p.totalKos > 0) tags.push(`${p.totalKos} KO${p.totalKos !== 1 ? 's' : ''}`);
    if (p.wasKoed) tags.push('KO\'d');
    if (p.timesBrought === 0) tags.push('NOT BROUGHT');

    const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
    const movesStr = p.movesUsed.length > 0 ? ` — Moves: ${p.movesUsed.join(', ')}` : '';

    lines.push(`  - ${p.pokemonName}${tagStr}${movesStr}`);
  }
  return lines.join('\n');
}

function formatStandingsSection(
  current: Standing[],
  previous: Standing[] | null,
  label: string
): string {
  if (current.length === 0) return '## STANDINGS\nNo standings data.\n';

  const lines = [`## STANDINGS AFTER ${label.toUpperCase()}`];

  const prevPositionMap: Record<string, number> = {};
  if (previous) {
    previous.forEach((s, i) => { prevPositionMap[s.player_id] = i + 1; });
  }

  for (let i = 0; i < current.length; i++) {
    const s = current[i];
    const pos = i + 1;
    let delta = '';
    if (previous && prevPositionMap[s.player_id] !== undefined) {
      const change = prevPositionMap[s.player_id] - pos;
      if (change > 0) delta = ` (up ${change})`;
      else if (change < 0) delta = ` (down ${Math.abs(change)})`;
    }
    const record = `${s.wins}W-${s.losses}L${s.draws > 0 ? `-${s.draws}D` : ''}`;
    const kd = s.kill_differential !== 0
      ? ` | KD: ${s.kill_differential > 0 ? '+' : ''}${s.kill_differential}`
      : '';
    const gym = s.gym_type ? ` [${s.gym_type}]` : '';
    lines.push(`${pos}. ${s.player_name}${gym}: ${s.points}pts (${record})${kd}${delta}`);
  }

  return lines.join('\n') + '\n';
}

function formatPairingsSection(
  matches: MatchWithPlayers[],
  standings: Standing[],
  allRecords: { player_1_id: string; player_2_id: string; winner_id: string | null }[],
  playerTeams: Record<string, string[]>
): string {
  const pending = matches.filter((m) => m.status !== 'completed');
  if (pending.length === 0) {
    return '## UPCOMING MATCHUPS\nNo pending matches.\n';
  }

  const positionMap: Record<string, number> = {};
  standings.forEach((s, i) => { positionMap[s.player_id] = i + 1; });

  const lines = ['## UPCOMING MATCHUPS'];

  for (const match of pending) {
    const p1Pos = positionMap[match.player_1_id];
    const p2Pos = positionMap[match.player_2_id];
    const p1Rank = p1Pos ? ` (#${p1Pos})` : '';
    const p2Rank = p2Pos ? ` (#${p2Pos})` : '';

    lines.push(`\n### ${match.player_1_name}${p1Rank} vs ${match.player_2_name}${p2Rank}`);

    // Head-to-head
    const h2h = allRecords.filter(
      (r) =>
        (r.player_1_id === match.player_1_id && r.player_2_id === match.player_2_id) ||
        (r.player_1_id === match.player_2_id && r.player_2_id === match.player_1_id)
    );
    if (h2h.length > 0) {
      const p1Wins = h2h.filter((r) => r.winner_id === match.player_1_id).length;
      const p2Wins = h2h.filter((r) => r.winner_id === match.player_2_id).length;
      lines.push(`Head-to-head: ${match.player_1_name} ${p1Wins}-${p2Wins} ${match.player_2_name}`);
    } else {
      lines.push('Head-to-head: First meeting');
    }

    // Team sheets
    const p1Team = playerTeams[match.player_1_id];
    const p2Team = playerTeams[match.player_2_id];
    if (p1Team?.length) lines.push(`${match.player_1_name}'s team: ${p1Team.join(', ')}`);
    if (p2Team?.length) lines.push(`${match.player_2_name}'s team: ${p2Team.join(', ')}`);
  }

  return lines.join('\n') + '\n';
}
