import { NextRequest, NextResponse } from 'next/server';
import { requirePlayer } from '@/lib/auth/helpers';
import { safeErrorResponse } from '@/lib/api/error-response';
import { UserFacingError } from '@/lib/api/user-facing-error';
import { resolveIdOnlyMatchRoute } from '@/lib/league-phase/match-route-owner';
import { getMatchById } from '@/lib/supabase/queries/matches';
import { getOpponentBattleStatsInTournament } from '@/lib/supabase/queries/games';
import { getOpponentBattleStatsInPhase, getPhaseScoutingMatch } from '@/lib/supabase/queries/phase-opponent-summary';
import { getTournamentById } from '@/lib/supabase/queries/tournaments';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { buildThreatEntry } from '@/lib/pkmn/threat-list';
import tournamentErrors from '@/i18n/messages/errors/tournaments/en';
import type { ApiResult } from '@/types/api';
import type { ThreatEntry } from '@/types/calc';

/** Aggregated Pokémon stat from opponent battle history */
interface OpponentPokemonSummary {
  species: string;
  games: number;
  bring_rate: number;
  ko_rate: number;
  lead_rate: number;
  win_rate: number;
  sample_moves: string[];
  /** Calc-ready set: observed moves first, usage data fills the rest */
  default_set: ThreatEntry['default_set'] | null;
  types: string[];
}

interface OpponentSummaryResponse {
  match_id: string;
  opponent_id: string;
  opponent_name: string;
  pokemon: OpponentPokemonSummary[];
  data_scope: 'tournament' | 'season' | 'phase';
  total_games: number;
}

/**
 * GET /api/match-prep/opponent-summary?match_id=X
 *
 * Returns opponent Pokémon usage statistics for scouting purposes.
 * Allowed only for match participants.
 * Reads battle_stats directly — this is the documented scouting exception per CLAUDE.md.
 */
export async function GET(request: NextRequest) {
  try {
    const player = await requirePlayer();
    const matchId = request.nextUrl.searchParams.get('match_id');

    if (!matchId) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'match_id is required', code: 'MISSING_PARAM', params: { name: 'match_id' } },
        { status: 400 },
      );
    }

    const nativeMatchId = matchId.toLowerCase();
    const owner = await resolveIdOnlyMatchRoute(nativeMatchId);
    const match = owner?.kind === 'phase'
      ? await getPhaseScoutingMatch(nativeMatchId, owner)
      : owner?.kind === 'legacy' ? await getMatchById(matchId) : null;
    if (!match) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Match not found', code: 'match_not_found' },
        { status: 404 },
      );
    }

    // Authorization: only match participants can scout
    const isParticipant =
      match.player_1_id === player.playerId || match.player_2_id === player.playerId;
    if (!isParticipant) {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Forbidden', code: 'forbidden' },
        { status: 403 },
      );
    }

    const opponentId =
      match.player_1_id === player.playerId ? match.player_2_id : match.player_1_id;
    const opponentName =
      match.player_1_id === player.playerId ? match.player_2_name : match.player_1_name;

    let stats: Awaited<ReturnType<typeof getOpponentBattleStatsInPhase>>;
    let baseFormat: string;
    let dataScope: OpponentSummaryResponse['data_scope'];
    if ('phase_id' in match) {
      const ruleset = await getRulesetById(match.ruleset_id);
      if (!ruleset || ruleset.id !== match.ruleset_id) {
        throw new UserFacingError(tournamentErrors.ruleset_not_found, { code: 'ruleset_not_found', status: 404 });
      }
      stats = await getOpponentBattleStatsInPhase(opponentId, match.phase_id);
      baseFormat = ruleset.base_format;
      dataScope = 'phase';
    } else {
      stats = await getOpponentBattleStatsInTournament(opponentId, match.tournament_id);
      const tournament = await getTournamentById(match.tournament_id);
      const ruleset = tournament ? await getRulesetById(tournament.ruleset_id) : null;
      baseFormat = ruleset?.base_format ?? 'gen9ou';
      dataScope = 'tournament';
    }

    // Aggregate per Pokémon
    const totalGames = new Set(stats.map((s) => s.game_id)).size;

    const bySpecies = new Map<
      string,
      { brought: number; lead: number; kos: number; won: number; moves: Set<string>; games: Set<string> }
    >();

    for (const stat of stats) {
      if (!bySpecies.has(stat.pokemon_name)) {
        bySpecies.set(stat.pokemon_name, {
          brought: 0, lead: 0, kos: 0, won: 0,
          moves: new Set(), games: new Set(),
        });
      }
      const entry = bySpecies.get(stat.pokemon_name)!;
      entry.games.add(stat.game_id);
      if (stat.was_brought) entry.brought++;
      if (stat.was_lead) entry.lead++;
      entry.kos += stat.kos_dealt;
      if (stat.match_won) entry.won++;
      for (const move of stat.moves_used ?? []) entry.moves.add(move);
    }

    const pokemon: OpponentPokemonSummary[] = await Promise.all(
      [...bySpecies.entries()].map(async ([species, e]) => {
        const sampleMoves = [...e.moves].slice(0, 4);
        const threat = await buildThreatEntry(species, baseFormat, sampleMoves);
        return {
          species,
          games: e.games.size,
          bring_rate: totalGames > 0 ? Math.round((e.brought / totalGames) * 100) : 0,
          ko_rate: e.brought > 0 ? Math.round((e.kos / e.brought) * 100) : 0,
          lead_rate: e.brought > 0 ? Math.round((e.lead / e.brought) * 100) : 0,
          win_rate: e.games.size > 0 ? Math.round((e.won / e.games.size) * 100) : 0,
          sample_moves: sampleMoves,
          default_set: threat?.default_set ?? null,
          types: threat?.types ?? [],
        };
      }),
    );
    pokemon.sort((a, b) => b.bring_rate - a.bring_rate);

    const response: OpponentSummaryResponse = {
      match_id: matchId,
      opponent_id: opponentId,
      opponent_name: opponentName,
      pokemon,
      data_scope: dataScope,
      total_games: totalGames,
    };

    return NextResponse.json<ApiResult<OpponentSummaryResponse>>({
      success: true,
      data: response,
    });
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch opponent summary');
  }
}
