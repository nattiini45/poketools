
/**
 * Stored placeholder names. They are data (persisted in solo sessions and the
 * tracker state), so they stay English; screens translate them on display
 * through `soloPlaceholderOf`.
 */
export const SOLO_PLAYER1_DEFAULT_NAME = 'Me';
export const SOLO_PLAYER2_DEFAULT_NAME = 'Opponent';

export type SoloPlaceholder = 'me' | 'opponent';

/** Which stored placeholder `name` is, or null for a real player name. */
export function soloPlaceholderOf(name: string): SoloPlaceholder | null {
  if (name === SOLO_PLAYER1_DEFAULT_NAME) return 'me';
  if (name === SOLO_PLAYER2_DEFAULT_NAME) return 'opponent';
  return null;
}

/**
 * Canonical solo-session player defaults. Used by the tracker reducer,
 * CastStudioContext, and the broadcast API route to ensure consistent
 * fallback IDs and names when the session has empty/placeholder values.
 */
export function soloPlayerDefaults(session: {
  owner_id: string;
  player1_id: string | null;
  player1_name: string | null;
  player1_avatar_url: string | null;
  player2_id: string | null;
  player2_name: string | null;
  player2_avatar_url: string | null;
}) {
  return {
    player1: {
      id: session.player1_id || session.owner_id,
      name: session.player1_name || SOLO_PLAYER1_DEFAULT_NAME,
      avatar_url: session.player1_avatar_url,
    },
    player2: {
      id: session.player2_id || 'solo-opponent',
      name: session.player2_name || SOLO_PLAYER2_DEFAULT_NAME,
      avatar_url: session.player2_avatar_url,
    },
  };
}
