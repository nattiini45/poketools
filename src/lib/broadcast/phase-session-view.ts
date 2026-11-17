import type { PhaseCastSession } from '@/types/phase-cast-session';

export type PublicPhaseCastSession = Pick<PhaseCastSession,
  'id' | 'phase_id' | 'season_id' | 'match_id' | 'name' | 'mode' | 'status' | 'format' | 'generation' |
  'player1_id' | 'player1_name' | 'player1_avatar_url' | 'player2_id' | 'player2_name' | 'player2_avatar_url' |
  'created_at' | 'updated_at'
>;

export function toPublicPhaseCastSession(session: PhaseCastSession): PublicPhaseCastSession {
  return {
    id: session.id, phase_id: session.phase_id, season_id: session.season_id, match_id: session.match_id,
    name: session.name, mode: session.mode, status: session.status, format: session.format, generation: session.generation,
    player1_id: session.player1_id, player1_name: session.player1_name, player1_avatar_url: session.player1_avatar_url,
    player2_id: session.player2_id, player2_name: session.player2_name, player2_avatar_url: session.player2_avatar_url,
    created_at: session.created_at, updated_at: session.updated_at,
  };
}
