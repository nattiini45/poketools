import { getSeasonById, getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getAggregates, getTotalGamesInScope } from '@/lib/supabase/queries/aggregates';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import { loadScoringByes } from '@/lib/tournament/scoring-byes';
import { countByesByPlayer, formatRecord } from '@/lib/tournament/byes';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import type { ReportDefinition } from '../registry';
import type { PromptTask, PipelineMode, ValidationResult, ReportParams } from '../types';
import type { SeasonSummaryContent } from '@/types/tournament-report';

// ─── Fact Pack ──────────────────────────────────────────────────────

interface SeasonSummaryFactPack {
  seasonName: string;
  format: string;
  totalGames: number;
  finalStandings: {
    rank: number;
    player_name: string;
    player_id: string;
    points: number;
    record: string;
    kd: string;
    gymType: string | null;
  }[];
  topPokemon: { pokemonName: string; appearances: number; kos: number; winRate: number }[];
  seasonMvp: { player_name: string; player_id: string; reason: string };
  validPlayerNames: string[];
  validPokemonNames: string[];
}

async function buildFactPack(params: ReportParams): Promise<SeasonSummaryFactPack> {
  const tournament = await getTournamentById(params.tournamentId);
  if (!tournament?.season_id) throw new Error('Tournament has no season');
  const seasonId = tournament.season_id;

  const [season, participants, allMatchRecords, aggregates, totalGames] = await Promise.all([
    getSeasonById(seasonId),
    getSeasonParticipants(seasonId),
    getCompletedMatchRecords(params.tournamentId),
    getAggregates('league', seasonId),
    getTotalGamesInScope('league', seasonId),
  ]);

  if (!season) throw new Error(`Season ${seasonId} not found`);

  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  const gymTypes: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name ?? 'Unknown';
    participantAvatars[p.id] = null;
    gymTypes[p.id] = p.gym_type;
  }

  // A Swiss tournament's standings score its stored byes as wins; each record says how many of its wins are byes.
  const byes = await loadScoringByes(tournament);
  const byeCounts = countByesByPlayer(byes);
  const standings = await computeStandingsForSeason(
    seasonId,
    participantIds, participantNames, allMatchRecords,
    participantAvatars,
    { pointsPerWin: 3, pointsPerDraw: 1, byes },
    gymTypes
  );

  const finalStandings = standings.map((s, i) => ({
    rank: i + 1,
    player_name: s.player_name,
    player_id: s.player_id,
    points: s.points,
    record: formatRecord(s.wins, s.losses, s.draws, byeCounts[s.player_id] ?? 0),
    kd: `${s.kill_differential > 0 ? '+' : ''}${s.kill_differential}`,
    gymType: s.gym_type,
  }));

  const topPokemon = aggregates.slice(0, 15).map((a) => ({
    pokemonName: a.pokemon_name,
    appearances: a.total_brought,
    kos: a.total_kos_dealt,
    winRate: a.total_games > 0 ? Math.round((a.total_wins / a.total_games) * 100) : 0,
  }));

  // Season MVP: top standings player
  const mvpStanding = standings[0];
  const seasonMvp = mvpStanding
    ? {
        player_name: mvpStanding.player_name,
        player_id: mvpStanding.player_id,
        reason: `Finished #1 with ${mvpStanding.points}pts (${formatRecord(mvpStanding.wins, mvpStanding.losses, mvpStanding.draws, byeCounts[mvpStanding.player_id] ?? 0)}), KD: ${mvpStanding.kill_differential > 0 ? '+' : ''}${mvpStanding.kill_differential}`,
      }
    : { player_name: '', player_id: '', reason: '' };

  return {
    seasonName: season.name,
    format: season.format_type,
    totalGames,
    finalStandings,
    topPokemon,
    seasonMvp,
    validPlayerNames: participants.map((p) => p.name ?? 'Unknown'),
    validPokemonNames: aggregates.map((a) => a.pokemon_name),
  };
}

// ─── Prompts ────────────────────────────────────────────────────────

const PERSONA = `You are Kale Cabbage, competitive Pokémon sports journalist. Write a season wrap-up — authoritative, reflective, celebrating the competition. No emojis.`;
const RULES = `CRITICAL: Use ONLY the facts provided. Do not invent stats, records, or claims.`;

function getPromptTasks(factPack: unknown, mode: PipelineMode): PromptTask[] {
  const fp = factPack as SeasonSummaryFactPack;

  if (mode === 'single') {
    return [buildSingleTask(fp)];
  }

  const standings = fp.finalStandings
    .map((s) => `${s.rank}. ${s.player_name}${s.gymType ? ` [${s.gymType}]` : ''}: ${s.points}pts (${s.record}) KD: ${s.kd}`)
    .join('\n');

  const usage = fp.topPokemon.slice(0, 8)
    .map((p) => `${p.pokemonName}: ${p.appearances} appearances, ${p.kos} KOs, ${p.winRate}% win rate`)
    .join('\n');

  return [
    {
      id: 'season_headline',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a single headline sentence crowning the season champion.`,
      userPrompt: `Season: ${fp.seasonName}\nChampion: ${fp.seasonMvp.player_name}\nRecord: ${fp.seasonMvp.reason}`,
      maxTokens: 100,
    },
    {
      id: 'notable_moments',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nList 3-5 notable moments or storylines from this season. Each should be 1 sentence. Return as a JSON array of strings.`,
      userPrompt: `Season: ${fp.seasonName}\n${fp.totalGames} games played\n\nFinal standings:\n${standings}\n\nTop Pokémon:\n${usage}`,
      maxTokens: 400,
    },
    {
      id: 'meta_evolution',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite 2-3 sentences about how the metagame evolved over this season based on the usage data.`,
      userPrompt: `Top Pokémon usage:\n${usage}`,
      maxTokens: 200,
    },
    {
      id: 'season_narrative',
      stage: 2,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a 3-5 paragraph season wrap-up narrative. Celebrate the champion, highlight key storylines, and reflect on the meta. Use paragraph breaks.`,
      userPrompt: `Season: ${fp.seasonName} | ${fp.totalGames} games\nChampion: ${fp.seasonMvp.player_name} — ${fp.seasonMvp.reason}\n\nFinal standings:\n${standings}\n\nTop Pokémon:\n${usage}`,
      maxTokens: 800,
    },
  ];
}

function buildSingleTask(fp: SeasonSummaryFactPack): PromptTask {
  const standings = fp.finalStandings
    .map((s) => `${s.rank}. ${s.player_name}${s.gymType ? ` [${s.gymType}]` : ''}: ${s.points}pts (${s.record}) KD: ${s.kd}`)
    .join('\n');
  const usage = fp.topPokemon.slice(0, 10)
    .map((p) => `${p.pokemonName}: ${p.appearances} apps, ${p.kos} KOs, ${p.winRate}% WR`)
    .join('\n');

  return {
    id: 'single_season_summary',
    stage: 1,
    systemPrompt: `${PERSONA}\n\n${RULES}\n\nRespond with JSON:\n{"headline":"","narrative":"","notable_moments":[""],"meta_evolution":""}`,
    userPrompt: `Season: ${fp.seasonName} | ${fp.totalGames} games\nChampion: ${fp.seasonMvp.player_name} — ${fp.seasonMvp.reason}\n\nStandings:\n${standings}\n\nUsage:\n${usage}`,
    maxTokens: 2048,
  };
}

// ─── Assembly ─��─────────────────────────────────────────────────────

function assemble(outputs: Map<string, string>, factPack: unknown): SeasonSummaryContent {
  const fp = factPack as SeasonSummaryFactPack;

  // Try parsing notable_moments as JSON array
  let notableMoments: string[] = [];
  const momentsRaw = outputs.get('notable_moments') ?? outputs.get('single_season_summary') ?? '';
  try {
    const parsed = JSON.parse(momentsRaw.includes('[') ? momentsRaw.slice(momentsRaw.indexOf('['), momentsRaw.lastIndexOf(']') + 1) : '[]');
    if (Array.isArray(parsed)) notableMoments = parsed.map(String);
  } catch {
    notableMoments = momentsRaw.split('\n').filter((l) => l.trim().length > 0).slice(0, 5);
  }

  // Handle single mode
  if (outputs.has('single_season_summary')) {
    try {
      const raw = outputs.get('single_season_summary') ?? '';
      let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const p = JSON.parse(cleaned.slice(start, end + 1));
        const str = (v: unknown, f = ''): string => typeof v === 'string' ? v : f;
        return {
          headline: str(p.headline, `${fp.seasonName} Season Wrap-Up`),
          narrative: str(p.narrative),
          final_standings: fp.finalStandings,
          season_mvp: fp.seasonMvp,
          notable_moments: Array.isArray(p.notable_moments) ? p.notable_moments.map(String) : notableMoments,
          meta_evolution: str(p.meta_evolution),
        };
      }
    } catch { /* fall through to decomposed assembly */ }
  }

  return {
    headline: outputs.get('season_headline')?.trim() || `${fp.seasonName} Season Wrap-Up`,
    narrative: outputs.get('season_narrative')?.trim() || '',
    final_standings: fp.finalStandings,
    season_mvp: fp.seasonMvp,
    notable_moments: notableMoments,
    meta_evolution: outputs.get('meta_evolution')?.trim() || '',
  };
}

// ─── Validation ─────────────────────────────────────────────────────

function validate(_taskId: string, text: string, factPack: unknown): ValidationResult {
  const fp = factPack as SeasonSummaryFactPack;
  const errors: { type: 'wrong_player' | 'wrong_pokemon' | 'wrong_score' | 'wrong_number' | 'structural'; detail: string; severity: 'error' | 'warning' }[] = [];

  // Check point values
  const pointPattern = /(\d+)\s*(?:pts?|points?)/gi;
  let match;
  while ((match = pointPattern.exec(text)) !== null) {
    const pts = parseInt(match[1], 10);
    if (!fp.finalStandings.some((s) => s.points === pts)) {
      errors.push({ type: 'wrong_number', detail: `${pts} points doesn't match any standings`, severity: 'warning' });
    }
  }

  return { valid: errors.filter((e) => e.severity === 'error').length === 0, errors };
}

export const seasonSummaryDefinition: ReportDefinition = {
  type: 'season_summary',
  buildFactPack: buildFactPack,
  getPromptTasks,
  validate,
  assemble,
};
