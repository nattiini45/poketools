import 'server-only';
import { NextResponse } from 'next/server';
import { fetchBoundReplay } from '@/lib/pkmn/replay-binding';
import { getPlayerByPsUsername } from '@/lib/supabase/queries/players';
import type { ReplayGameInput } from '@/lib/pkmn/game-pipeline';
import type { ApiResult } from '@/types/api';

export async function prepareReplayGame(
  replayUrl: string,
  match: { readonly player_1_id: string; readonly player_2_id: string },
): Promise<Pick<ReplayGameInput, 'replay' | 'side_player_ids'> | NextResponse<ApiResult<never>>> {
  const replay = await fetchBoundReplay(replayUrl);
  const parsed = replay.parsed;
  const playerMap = new Map<string, string>();

  for (const parsedPlayer of parsed.players) {
    const dbPlayer = await getPlayerByPsUsername(parsedPlayer.ps_username);
    if (!dbPlayer) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          code: 'name_mismatch',
          params: { username: parsedPlayer.ps_username },
          error: `Could not match PS username "${parsedPlayer.ps_username}" to a registered player. ` +
            `Players must set their PS username in their profile.`,
          ps_usernames: parsed.players.map((p) => p.ps_username),
        },
        { status: 400 }
      );
    }
    if (dbPlayer.id !== match.player_1_id && dbPlayer.id !== match.player_2_id) {
      return NextResponse.json<ApiResult<never>>(
        {
          success: false,
          code: 'replay_player_not_in_match',
          params: { username: parsedPlayer.ps_username, player: dbPlayer.name },
          error: `Player "${parsedPlayer.ps_username}" (${dbPlayer.name}) is not a participant in this match`,
          ps_usernames: parsed.players.map((p) => p.ps_username),
        },
        { status: 400 }
      );
    }
    playerMap.set(parsedPlayer.ps_username, dbPlayer.id);
  }

  const sidePlayerIds = parsed.players.map((p) => playerMap.get(p.ps_username) ?? '');
  return { replay, side_player_ids: [sidePlayerIds[0] ?? '', sidePlayerIds[1] ?? ''] };
}
