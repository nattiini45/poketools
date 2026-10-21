import type { AvatarConfig } from './avatar';

export type PlayerStatus = 'active' | 'suspended' | 'banned';

/**
 * Per-player 3D world experience preference (`players.world_experience`).
 * `'auto'` lets capability detection decide; `'on'` always renders the route
 * tier (WebGL / reduced-motion hard floors still apply); `'off'` always shows
 * the simple (Lite) version.
 */
export type WorldExperience = 'auto' | 'on' | 'off';

export const WORLD_EXPERIENCE_VALUES: readonly WorldExperience[] = ['auto', 'on', 'off'];

/**
 * What every viewer gets without a stored choice: signed-out visitors, a
 * failed preference read, and the `players.world_experience` column default.
 * 3D is opt-in: 'off' renders the simple (Lite) version until the viewer picks
 * 'auto' or 'on' in settings. The `?tier=route` / `?routeDebug=1` URL
 * overrides still force the route tier.
 */
export const DEFAULT_WORLD_EXPERIENCE: WorldExperience = 'off';

/** Runtime guard for the `world_experience` enum — DB text column, API bodies. */
export function isWorldExperience(value: unknown): value is WorldExperience {
  return (
    typeof value === 'string' &&
    (WORLD_EXPERIENCE_VALUES as readonly string[]).includes(value)
  );
}

export interface Player {
  id: string; // Supabase UUID
  name: string;
  discord_id: string | null;
  auth_user_id: string | null; // Supabase Auth user (email/password login)
  ps_username: string;
  champions_username: string;
  is_admin: boolean;
  is_creator: boolean;
  is_guest: boolean;
  is_test_account: boolean;
  joined_date: string | null; // ISO 8601
  avatar_url: string | null;
  avatar_config: AvatarConfig | null;
  status: PlayerStatus;
  suspended_until: string | null; // ISO 8601 — if set and in future, player is suspended
  ban_reason: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A player as anyone but the player themself or an admin receives it: the
 * profile card (`ProfileHeader`) fields and nothing else. An allowlist, so the
 * identity, moderation and admin columns (`discord_id`, `auth_user_id`,
 * `status`, `ban_reason`, `suspended_until`, `is_admin`, `is_test_account`,
 * `avatar_config`, timestamps) and any column added later stay out. Build it
 * with `toPublicPlayer` (`src/lib/players/public-player.ts`), never a spread.
 */
export type PublicPlayer = Pick<
  Player,
  | 'id'
  | 'name'
  | 'avatar_url'
  | 'ps_username'
  | 'champions_username'
  | 'joined_date'
  | 'is_creator'
  | 'is_guest'
>;

/** Safe fields for the public /players directory */
export interface PublicPlayerDirectoryEntry {
  id: string;
  name: string;
  avatar_url: string | null;
  is_creator: boolean;
  is_guest: boolean;
  rating: number | null;
  /** Glicko-2 rating deviation; null when the player has no rating row yet. */
  rd: number | null;
}

/**
 * A registered player needs discord_id or auth_user_id; a guest (`is_guest`) has neither.
 * The DB CHECK players_identity_check enforces "identity or guest"; playerInsert also
 * rejects a guest that carries an identity.
 */
export interface PlayerRegistration {
  name: string;
  discord_id?: string;
  auth_user_id?: string;
  ps_username?: string;
  champions_username?: string;
  is_guest?: boolean;
}

export interface PlayerUpdate {
  name?: string;
  discord_id?: string;
  ps_username?: string;
  champions_username?: string;
  is_admin?: boolean;
  is_creator?: boolean;
  avatar_url?: string | null;
  avatar_config?: AvatarConfig | null;
}

export interface PlayerBanInput {
  ban_reason: string;
}

export interface PlayerSuspendInput {
  suspended_until: string; // ISO 8601
}
