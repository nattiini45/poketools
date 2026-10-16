import type { Player, PublicPlayer } from '@/types/player';
import type { CoreTriple, SeasonParticipant } from '@/types/season';
import type { ParticipantWithSeed } from '@/types/tournament';

/**
 * Public player shapes: the ONLY player fields that may cross from a server
 * component or a public API route into a client component or another
 * player's browser.
 *
 * A `players` row (and everything built on it: `SeasonParticipant`,
 * `ParticipantWithSeed`) carries private columns — `discord_id`,
 * `auth_user_id`, `ban_reason`, `suspended_until`, `status`, `is_admin`,
 * `is_test_account`, `avatar_config` and more. Props into a `'use client'`
 * component are serialized into the page, and an API response is readable by
 * whoever calls the route, so a full row there publishes all of it. Map to one
 * of these shapes on the server first.
 *
 * The database draws the same line for direct callers: `anon` and
 * `authenticated` hold no privilege on `public.players`, or on anything else
 * in `public` (`supabase/migrations/20261008081443_close_public_api_roles.sql`,
 * applied), so the anon key in the browser bundle cannot
 * read any player column over REST or GraphQL. Only the service-role client
 * reads the table, and these mappers are the boundary for everything it
 * returns. A shape here does not grant a column to anyone in the database.
 * (Objects created from the dashboard as `supabase_admin` are the exception:
 * see the status section of docs/security/anon-match-columns.md.)
 *
 * The mappers copy fields one by one (never a spread of a row), so a column
 * added to `players` later cannot leak through them by default.
 *
 * Shapes, narrowest first:
 * - `PublicPlayerRef` (`{ id, name }`) and `PublicParticipant` (+ gym band):
 *   client props and the world route contract.
 * - `PublicSeasonParticipant` (+ avatar, type core): public league pages and
 *   `GET /api/seasons/[id]/participants`.
 * - `PublicTournamentParticipant` (`{ id, name, avatar_url, seed,
 *   starting_bracket }`): the tournament and phase participant endpoints.
 * - `PublicPlayer` (the profile card, `src/types/player.ts`): the public
 *   profile, and another player's `GET /api/players/[id]` and profile.
 * - `AdminSeasonParticipant` / `AdminTournamentParticipant`: only for a
 *   caller the live `requireResourceAdmin` guard confirmed.
 *
 * Pure and type-only: safe to import from server and client modules alike.
 */

/** The identity every viewer may see: who the player is, nothing else. */
export interface PublicPlayerRef {
  id: string;
  name: string;
}

/** The fields of `PublicPlayerRef`, in order. Tests assert payloads against it. */
export const PUBLIC_PLAYER_REF_FIELDS = ['id', 'name'] as const satisfies readonly (keyof PublicPlayerRef)[];

/**
 * A league participant as any viewer's client receives it: identity plus the
 * gym band the 3D worlds and team walls paint. This is the participant shape
 * of the world route contract (`WorldRouteData.participants`).
 */
export interface PublicParticipant extends PublicPlayerRef {
  gym_type: string | null;
}

/** The fields of `PublicParticipant`, in order. */
export const PUBLIC_PARTICIPANT_FIELDS = [
  'id',
  'name',
  'gym_type',
] as const satisfies readonly (keyof PublicParticipant)[];

/**
 * A season participant row safe to hold on the server for public pages
 * (standings, insights, type cores). Everything here is public league
 * information; it is what `getPublicSeasonParticipants` selects, and it is
 * still narrowed with `toPublicParticipant` before it enters a client payload
 * that does not render the avatar or the core.
 */
export interface PublicSeasonParticipant extends PublicParticipant {
  avatar_url: string | null;
  core_types: CoreTriple | null;
}

/** The fields of `PublicSeasonParticipant`, in order. */
export const PUBLIC_SEASON_PARTICIPANT_FIELDS = [
  'id',
  'name',
  'gym_type',
  'avatar_url',
  'core_types',
] as const satisfies readonly (keyof PublicSeasonParticipant)[];

/** Anything with at least a player's id and name (full rows included). */
export type PlayerRefSource = Pick<Player, 'id' | 'name'>;

/** Anything with a participant's id, name and gym band (full rows included). */
export type ParticipantSource = Pick<SeasonParticipant, 'id' | 'name' | 'gym_type'>;

export function toPublicPlayerRef(player: PlayerRefSource): PublicPlayerRef {
  return { id: player.id, name: player.name };
}

export function toPublicParticipant(participant: ParticipantSource): PublicParticipant {
  return {
    id: participant.id,
    name: participant.name,
    gym_type: participant.gym_type ?? null,
  };
}

export function toPublicParticipants(
  participants: readonly ParticipantSource[],
): PublicParticipant[] {
  return participants.map(toPublicParticipant);
}

/** Anything with a season participant's public fields (full rows included). */
export type SeasonParticipantSource = Pick<
  SeasonParticipant,
  'id' | 'name' | 'gym_type' | 'avatar_url' | 'core_types'
>;

export function toPublicSeasonParticipant(
  participant: SeasonParticipantSource,
): PublicSeasonParticipant {
  return {
    id: participant.id,
    name: participant.name,
    gym_type: participant.gym_type ?? null,
    avatar_url: participant.avatar_url ?? null,
    core_types: participant.core_types ?? null,
  };
}

// ─── Player profile card ──────────────────────────────────────────────────

/**
 * The fields of `PublicPlayer` (`src/types/player.ts`), in order: exactly what
 * the profile card (`ProfileHeader`) renders. These are profile information
 * the player shows every visitor (their Showdown and Champions names, when
 * they joined, the creator and guest badges), unlike the moderation, identity
 * and admin columns.
 */
export const PUBLIC_PLAYER_FIELDS = [
  'id',
  'name',
  'avatar_url',
  'ps_username',
  'champions_username',
  'joined_date',
  'is_creator',
  'is_guest',
] as const satisfies readonly (keyof PublicPlayer)[];

/** Anything with a player's profile card fields (full rows included). */
export type PublicPlayerSource = Pick<Player, (typeof PUBLIC_PLAYER_FIELDS)[number]>;

/**
 * A player as another player (or an anonymous visitor) may receive it: the
 * public profile, `GET /api/players/[id]` for someone else, and the profile
 * API for anyone but the player themself or an admin.
 */
export function toPublicPlayer(player: PublicPlayerSource): PublicPlayer {
  return {
    id: player.id,
    name: player.name,
    avatar_url: player.avatar_url ?? null,
    ps_username: player.ps_username,
    champions_username: player.champions_username,
    joined_date: player.joined_date ?? null,
    is_creator: player.is_creator === true,
    is_guest: player.is_guest === true,
  };
}

// ─── Tournament participants ──────────────────────────────────────────────

/**
 * A tournament (or league phase) participant as any viewer receives it: the
 * public participant list endpoints and the public read cache.
 */
export interface PublicTournamentParticipant {
  id: string;
  name: string;
  avatar_url: string | null;
  seed: number | null;
  starting_bracket: 'winners' | 'losers';
}

/** The fields of `PublicTournamentParticipant`, in order. */
export const PUBLIC_TOURNAMENT_PARTICIPANT_FIELDS = [
  'id',
  'name',
  'avatar_url',
  'seed',
  'starting_bracket',
] as const satisfies readonly (keyof PublicTournamentParticipant)[];

/** Anything with a tournament participant's public fields (full rows included). */
export type TournamentParticipantSource = Pick<
  ParticipantWithSeed,
  'id' | 'name' | 'avatar_url' | 'seed' | 'starting_bracket'
>;

export function toPublicTournamentParticipant(
  participant: TournamentParticipantSource,
): PublicTournamentParticipant {
  return {
    id: participant.id,
    name: participant.name,
    avatar_url: participant.avatar_url ?? null,
    seed: participant.seed ?? null,
    starting_bracket: participant.starting_bracket ?? 'winners',
  };
}

// ─── Roster admin shapes ──────────────────────────────────────────────────
//
// What a VERIFIED resource admin of the season or tournament receives from
// the participant list endpoints: the public shape plus the flags the admin
// roster screens render (the guest badge and link flow, the test-account
// badge). Only a route that has confirmed the caller with the live
// `requireResourceAdmin` guard may return these (`canViewAdminRoster` in
// `src/lib/players/roster-access.ts`). Moderation and identity columns stay
// out even here: the admin player directory (`GET /api/players`) is the one
// place that shows them.

/** A league roster row for its admins (`LeagueRosterManager`). */
export interface AdminSeasonParticipant extends PublicSeasonParticipant {
  is_guest: boolean;
  is_test_account: boolean;
}

/** The fields of `AdminSeasonParticipant`, in order. */
export const ADMIN_SEASON_PARTICIPANT_FIELDS = [
  ...PUBLIC_SEASON_PARTICIPANT_FIELDS,
  'is_guest',
  'is_test_account',
] as const satisfies readonly (keyof AdminSeasonParticipant)[];

export function toAdminSeasonParticipant(
  participant: SeasonParticipantSource & Pick<SeasonParticipant, 'is_guest' | 'is_test_account'>,
): AdminSeasonParticipant {
  return {
    ...toPublicSeasonParticipant(participant),
    is_guest: participant.is_guest === true,
    is_test_account: participant.is_test_account === true,
  };
}

/** A tournament participant row for its admins (`ParticipantManager` / `SeedingTable`). */
export interface AdminTournamentParticipant extends PublicTournamentParticipant {
  is_guest: boolean;
}

/** The fields of `AdminTournamentParticipant`, in order. */
export const ADMIN_TOURNAMENT_PARTICIPANT_FIELDS = [
  ...PUBLIC_TOURNAMENT_PARTICIPANT_FIELDS,
  'is_guest',
] as const satisfies readonly (keyof AdminTournamentParticipant)[];

export function toAdminTournamentParticipant(
  participant: TournamentParticipantSource & Pick<ParticipantWithSeed, 'is_guest'>,
): AdminTournamentParticipant {
  return {
    ...toPublicTournamentParticipant(participant),
    is_guest: participant.is_guest === true,
  };
}
