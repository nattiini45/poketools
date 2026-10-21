import { NextResponse } from 'next/server';
import { safeErrorResponse } from '@/lib/api/error-response';
import { rejectInvalidPathId } from '@/lib/api/invalid-path-id';
import { getCastSessionById } from '@/lib/supabase/queries/cast-sessions';
import { createInitialState, normalizeSoloTrackerState } from '@/lib/broadcast/tracker-reducer';
import { soloPlayerDefaults } from '@/lib/broadcast/solo-defaults';
import type { ApiResult } from '@/types/api';
import type { PublicSoloBroadcastState, TrackerState } from '@/types/broadcast';

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

function buildPublicState(
  session: NonNullable<Awaited<ReturnType<typeof getCastSessionById>>>,
): PublicSoloBroadcastState {
  const defaults = soloPlayerDefaults(session);
  const tracker = session.tracker_state
    ? normalizeSoloTrackerState(session.tracker_state as unknown as TrackerState, defaults)
    : createInitialState(
        session.match_id ?? '',
        {
          id: defaults.player1.id,
          name: defaults.player1.name,
          avatar_url: defaults.player1.avatar_url,
          pokemon: session.player1_team.map((set) => set.species).filter(Boolean),
        },
        {
          id: defaults.player2.id,
          name: defaults.player2.name,
          avatar_url: defaults.player2.avatar_url,
          pokemon: session.player2_team.map((set) => set.species).filter(Boolean),
        },
      );

  const player1Id = tracker.current_game.player1.player_id;

  return {
    session_id: session.id,
    player1_id: player1Id,
    player1_name: tracker.current_game.player1.player_name || session.player1_name,
    player2_name: tracker.current_game.player2.player_name || session.player2_name,
    player1_team: session.player1_team
      .filter((set) => set.species)
      .map((set) => ({ species: set.species })),
    player2_team: session.player2_team
      .filter((set) => set.species)
      .map((set) => ({ species: set.species })),
    current_game: {
      game_number: tracker.current_game.game_number,
      player1: {
        player_id: tracker.current_game.player1.player_id,
        player_name: tracker.current_game.player1.player_name,
        slots: tracker.current_game.player1.slots.map((slot) => ({
          pokemon_name: slot.pokemon_name,
          was_brought: slot.was_brought,
          was_koed: slot.was_koed,
          kos_dealt: slot.kos_dealt,
        })),
      },
      player2: {
        player_id: tracker.current_game.player2.player_id,
        player_name: tracker.current_game.player2.player_name,
        slots: tracker.current_game.player2.slots.map((slot) => ({
          pokemon_name: slot.pokemon_name,
          was_brought: slot.was_brought,
          was_koed: slot.was_koed,
          kos_dealt: slot.kos_dealt,
        })),
      },
    },
    games_submitted: tracker.games_submitted.map((game) => ({
      game_number: game.game_number,
      winner_id: game.winner_id,
    })),
    wins: tracker.games_submitted.filter((g) => g.winner_id === player1Id).length,
    losses: tracker.games_submitted.filter((g) => g.winner_id !== player1Id).length,
    updated_at: session.updated_at,
  };
}

// Public: no auth required — the solo overlay polls it; only the public solo state is returned
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    // A malformed id names no row: 404 before the query (Postgres would reject the filter with a 500).
    const invalidId = rejectInvalidPathId(sessionId, 'INVALID_SESSION_ID');
    if (invalidId) return invalidId;
    const session = await getCastSessionById(sessionId);

    if (!session || session.mode !== 'solo') {
      return NextResponse.json<ApiResult<never>>(
        { success: false, error: 'Solo session not found', code: 'solo_session_not_found' },
        { status: 404 },
      );
    }

    return NextResponse.json<ApiResult<PublicSoloBroadcastState>>(
      { success: true, data: buildPublicState(session) },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=5',
        },
      },
    );
  } catch (err) {
    return safeErrorResponse(err, 'Failed to fetch solo broadcast state');
  }
}
