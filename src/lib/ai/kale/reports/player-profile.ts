import { getPlayerById } from '@/lib/supabase/queries/players';
import { getPlayerBattleStats } from '@/lib/supabase/queries/games';
import { getAllTimePlayerAggregates } from '@/lib/supabase/queries/aggregates';
import { getCompletedMatchRecords } from '@/lib/supabase/queries/matches';
import { getParticipants, getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getSeasonParticipants } from '@/lib/supabase/queries/seasons';
import { computeStandingsForSeason } from '@/lib/tournament/season-standings';
import type { ReportDefinition } from '../registry';
import type { PromptTask, PipelineMode, ValidationResult, ReportParams } from '../types';
import type { PlayerProfileContent } from '@/types/tournament-report';

// ─── Fact Pack ──────────────────────────────────────────────────────

interface PlayerProfileFactPack {
  playerName: string;
  playerId: string;
  gymType: string | null;
  tournamentName: string;
  seasonRecord: {
    wins: number;
    losses: number;
    draws: number;
    points: number;
    final_rank: number;
    kd: number;
  };
  signaturePokemon: {
    pokemonName: string;
    timesUsed: number;
    totalKos: number;
  }[];
  notableWins: {
    opponentName: string;
    score: string;
  }[];
  totalMatches: number;
  validPlayerNames: string[];
  validPokemonNames: string[];
}

async function buildFactPack(params: ReportParams): Promise<PlayerProfileFactPack> {
  if (!params.playerId) throw new Error('playerId is required for player profile');

  const [player, tournament] = await Promise.all([
    getPlayerById(params.playerId),
    getTournamentById(params.tournamentId),
  ]);

  if (!player) throw new Error(`Player ${params.playerId} not found`);
  if (!tournament) throw new Error(`Tournament ${params.tournamentId} not found`);

  const [allMatchRecords, _battleStats, playerAggs, participants] = await Promise.all([
    getCompletedMatchRecords(params.tournamentId),
    getPlayerBattleStats(params.playerId),
    getAllTimePlayerAggregates(params.playerId),
    getParticipants(params.tournamentId),
  ]);

  // Get gym type from season if available
  let gymType: string | null = null;
  if (tournament.season_id) {
    const seasonParticipants = await getSeasonParticipants(tournament.season_id);
    const sp = seasonParticipants.find((p) => p.id === params.playerId);
    gymType = sp?.gym_type ?? null;
  }

  // Compute standings to get this player's rank
  const participantIds = participants.map((p) => p.id);
  const participantNames: Record<string, string> = {};
  const participantAvatars: Record<string, string | null> = {};
  const gymTypes: Record<string, string | null> = {};
  for (const p of participants) {
    participantNames[p.id] = p.name;
    participantAvatars[p.id] = p.avatar_url;
  }

  const standings = await computeStandingsForSeason(
    tournament.season_id,
    participantIds, participantNames, allMatchRecords,
    participantAvatars, { pointsPerWin: 3, pointsPerDraw: 1 }, gymTypes
  );

  const playerStanding = standings.find((s) => s.player_id === params.playerId);
  const final_rank = playerStanding ? standings.indexOf(playerStanding) + 1 : 0;

  // Notable wins (matches this player won)
  const notableWins = allMatchRecords
    .filter((m) => m.winner_id === params.playerId)
    .map((m) => {
      const opponentId = m.player_1_id === params.playerId ? m.player_2_id : m.player_1_id;
      return {
        opponentName: participantNames[opponentId] ?? 'Unknown',
        score: `${m.winner_id === m.player_1_id ? 'W' : 'W'}`,
      };
    })
    .slice(0, 5);

  // Signature pokemon (most used)
  const signaturePokemon = playerAggs
    .sort((a, b) => b.total_brought - a.total_brought)
    .slice(0, 6)
    .map((a) => ({
      pokemonName: a.pokemon_name,
      timesUsed: a.total_brought,
      totalKos: a.total_kos_dealt,
    }));

  return {
    playerName: player.name,
    playerId: params.playerId,
    gymType,
    tournamentName: tournament.name,
    seasonRecord: {
      wins: playerStanding?.wins ?? 0,
      losses: playerStanding?.losses ?? 0,
      draws: playerStanding?.draws ?? 0,
      points: playerStanding?.points ?? 0,
      final_rank,
      kd: playerStanding?.kill_differential ?? 0,
    },
    signaturePokemon,
    notableWins,
    totalMatches: allMatchRecords.filter(
      (m) => m.player_1_id === params.playerId || m.player_2_id === params.playerId
    ).length,
    validPlayerNames: participants.map((p) => p.name),
    validPokemonNames: playerAggs.map((a) => a.pokemon_name),
  };
}

// ─── Prompts ────────────────────────────────────────────────────────

const PERSONA = `You are Kale Cabbage, competitive Pokémon sports journalist writing a player profile. Respectful, analytical, highlighting strengths and story arcs. No emojis.`;
const RULES = `CRITICAL: Use ONLY the facts provided. Do not invent stats or claims.`;

function getPromptTasks(factPack: unknown, mode: PipelineMode): PromptTask[] {
  const fp = factPack as PlayerProfileFactPack;

  const record = `${fp.seasonRecord.wins}W-${fp.seasonRecord.losses}L${fp.seasonRecord.draws > 0 ? `-${fp.seasonRecord.draws}D` : ''}, ${fp.seasonRecord.points}pts, #${fp.seasonRecord.final_rank}, KD: ${fp.seasonRecord.kd > 0 ? '+' : ''}${fp.seasonRecord.kd}`;
  const pokemonList = fp.signaturePokemon
    .map((p) => `${p.pokemonName}: ${p.timesUsed} uses, ${p.totalKos} KOs`)
    .join('\n');
  const wins = fp.notableWins.map((w) => `Beat ${w.opponentName}`).join('\n');

  if (mode === 'single') {
    return [{
      id: 'single_player_profile',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nRespond with JSON:\n{"headline":"","narrative":"","signature_pokemon":[{"pokemon_name":"","analysis":""}],"notable_wins":[{"context":""}],"team_evolution":""}`,
      userPrompt: `Player: ${fp.playerName}${fp.gymType ? ` (${fp.gymType}-type Gym Leader)` : ''}\nTournament: ${fp.tournamentName}\nRecord: ${record}\n\nSignature Pokémon:\n${pokemonList}\n\nNotable wins:\n${wins || 'None'}`,
      maxTokens: 2048,
    }];
  }

  return [
    {
      id: 'profile_headline',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a single headline sentence about this player's season.`,
      userPrompt: `${fp.playerName}${fp.gymType ? ` (${fp.gymType}-type)` : ''}: ${record}`,
      maxTokens: 100,
    },
    {
      id: 'signature_analysis',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nFor each signature Pokémon, write 1 sentence of analysis. Return as JSON array: [{"pokemon_name":"","analysis":""}]`,
      userPrompt: `Player: ${fp.playerName}\n${pokemonList}`,
      maxTokens: 400,
    },
    {
      id: 'team_evolution',
      stage: 1,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite 2-3 sentences about this player's team-building tendencies based on their Pokémon usage.`,
      userPrompt: `Player: ${fp.playerName}${fp.gymType ? ` (${fp.gymType}-type Gym)` : ''}\n${pokemonList}`,
      maxTokens: 200,
    },
    {
      id: 'profile_narrative',
      stage: 2,
      systemPrompt: `${PERSONA}\n\n${RULES}\n\nWrite a 2-4 paragraph player profile narrative. Cover their season arc, key Pokémon, and what defines their style.`,
      userPrompt: `Player: ${fp.playerName}${fp.gymType ? ` (${fp.gymType}-type Gym Leader)` : ''}\nRecord: ${record}\nMatches played: ${fp.totalMatches}\n\nSignature Pokémon:\n${pokemonList}\n\nNotable wins:\n${wins || 'None'}`,
      maxTokens: 600,
    },
  ];
}

// ─── Assembly ───────────────────────────────────────────────────────

function assemble(outputs: Map<string, string>, factPack: unknown): PlayerProfileContent {
  const fp = factPack as PlayerProfileFactPack;

  // Parse signature analysis
  let signaturePokemon: { pokemon_name: string; times_used: number; total_kos: number; analysis: string }[] = [];
  const sigRaw = outputs.get('signature_analysis') ?? '';
  try {
    const arrStart = sigRaw.indexOf('[');
    const arrEnd = sigRaw.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      const parsed = JSON.parse(sigRaw.slice(arrStart, arrEnd + 1));
      if (Array.isArray(parsed)) {
        signaturePokemon = parsed.map((p: Record<string, unknown>, i: number) => ({
          pokemon_name: String(p.pokemon_name ?? fp.signaturePokemon[i]?.pokemonName ?? ''),
          times_used: fp.signaturePokemon[i]?.timesUsed ?? 0,
          total_kos: fp.signaturePokemon[i]?.totalKos ?? 0,
          analysis: String(p.analysis ?? ''),
        }));
      }
    }
  } catch { /* use server data only */ }

  // Fallback: server data without AI analysis
  if (signaturePokemon.length === 0) {
    signaturePokemon = fp.signaturePokemon.map((p) => ({
      pokemon_name: p.pokemonName,
      times_used: p.timesUsed,
      total_kos: p.totalKos,
      analysis: '',
    }));
  }

  // Handle single mode
  if (outputs.has('single_player_profile')) {
    try {
      const raw = outputs.get('single_player_profile') ?? '';
      let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
      cleaned = cleaned.replace(/```(?:json)?\s*/g, '').replace(/```\s*/g, '');
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        const p = JSON.parse(cleaned.slice(start, end + 1));
        const str = (v: unknown, f = ''): string => typeof v === 'string' ? v : f;
        return {
          headline: str(p.headline, `${fp.playerName}'s Season`),
          narrative: str(p.narrative),
          season_record: fp.seasonRecord,
          signature_pokemon: signaturePokemon,
          notable_wins: fp.notableWins.map((w, i) => ({
            opponent_name: w.opponentName,
            score: w.score,
            context: Array.isArray(p.notable_wins) ? String((p.notable_wins[i] as Record<string, unknown>)?.context ?? '') : '',
          })),
          team_evolution: str(p.team_evolution),
        };
      }
    } catch { /* fall through */ }
  }

  return {
    headline: outputs.get('profile_headline')?.trim() || `${fp.playerName}'s Season`,
    narrative: outputs.get('profile_narrative')?.trim() || '',
    season_record: fp.seasonRecord,
    signature_pokemon: signaturePokemon,
    notable_wins: fp.notableWins.map((w) => ({
      opponent_name: w.opponentName,
      score: w.score,
      context: '',
    })),
    team_evolution: outputs.get('team_evolution')?.trim() || '',
  };
}

// ─── Validation ─────────────────────────────────────────────────────

function validate(_taskId: string, text: string, factPack: unknown): ValidationResult {
  const fp = factPack as PlayerProfileFactPack;
  const errors: { type: 'wrong_player' | 'wrong_pokemon' | 'wrong_score' | 'wrong_number' | 'structural'; detail: string; severity: 'error' | 'warning' }[] = [];

  // Verify player name is correctly referenced
  if (text.length > 0 && !text.includes(fp.playerName)) {
    errors.push({ type: 'wrong_player', detail: `Profile doesn't mention the subject (${fp.playerName})`, severity: 'warning' });
  }

  return { valid: errors.filter((e) => e.severity === 'error').length === 0, errors };
}

export const playerProfileDefinition: ReportDefinition = {
  type: 'player_profile',
  buildFactPack,
  getPromptTasks,
  validate,
  assemble,
};
