import type { GameSummary, MatchWithPlayers } from '@/types/match';

/**
 * The public match shape: the ONLY match fields that may cross from a server
 * component or a public API route into a client component, a public read
 * cache entry or an anonymous caller.
 *
 * A `matches` row (and `MatchWithPlayers`, built on it with `select('*')`)
 * carries admin-only columns: `notes` (the admin notes / dispute log, which
 * only admins may write), `submitter_id` (who reported the result),
 * `auto_confirm_at` and `confirmed_at` (the confirmation workflow). Props into
 * a `'use client'` component are serialized into the page, a cached public
 * read is served to every visitor, and an API response is readable by whoever
 * calls the route, so a full row there publishes all of it. Map with
 * `toPublicMatch` / `toPublicMatches` on the server first.
 *
 * Who may receive FULL match rows (`Match` / `MatchWithPlayers`):
 * - admins (the `/api/admin/**` routes, the admin pages, `confirm-match`
 *   when an admin overrides a result and writes notes);
 * - resource admins of the match's tournament or league (live
 *   `requireResourceAdmin`: generate-round, repair);
 * - the match's own participants (`/api/matches/me`, `confirm-match`,
 *   `match-proposals/[id]/accept`).
 * Everyone else (public pages, `GET /api/matches/[id]`,
 * `GET /api/tournaments/[id]/rounds/[rid]`, the creator content page, the
 * public read cache) receives `PublicMatch`.
 *
 * The database draws the same line for direct callers: `anon` and
 * `authenticated` hold no privilege on `public.matches`
 * (`supabase/migrations/20261008081402_revoke_anon_private_match_columns.sql`)
 * or on anything else in `public` (`20261008081443_close_public_api_roles.sql`;
 * both applied), so the anon key in the browser bundle
 * cannot read any match column over REST or GraphQL. Only the service-role
 * client reads the table, and this mapper is the boundary for everything it
 * returns. Classifying a new column here does not grant it to anyone in the
 * database. (Objects created from the dashboard as `supabase_admin` are the
 * exception: see the status section of docs/security/anon-match-columns.md.)
 *
 * `social_image_url` stays public: it is the match's public social card.
 *
 * The mapper copies fields one by one (never a spread of a row), and the
 * compile-time check below makes every `MatchWithPlayers` key either public
 * or private, so a column added to `matches` later cannot leak through it
 * by default: it fails to compile until it is classified.
 *
 * Pure and type-only: safe to import from server and client modules alike.
 */

/** A match as any viewer may receive it: `MatchWithPlayers` minus the admin-only columns. */
export interface PublicMatch
  extends Pick<
    MatchWithPlayers,
    | 'id'
    | 'round_id'
    | 'tournament_id'
    | 'player_1_id'
    | 'player_2_id'
    | 'winner_id'
    | 'status'
    | 'date_played'
    | 'scheduled_at'
    | 'social_image_url'
    | 'bracket_side'
    | 'bracket_pos'
    | 'created_at'
    | 'updated_at'
    | 'player_1_name'
    | 'player_2_name'
    | 'player_1_avatar_url'
    | 'player_2_avatar_url'
    | 'winner_name'
    | 'round_status'
  > {
  /** Every game of the match, each copied field by field (all `GameSummary` fields are public). */
  games: GameSummary[];
}

/** The fields of `PublicMatch`, in order. Tests assert payloads against it. */
export const PUBLIC_MATCH_FIELDS = [
  'id',
  'round_id',
  'tournament_id',
  'player_1_id',
  'player_2_id',
  'winner_id',
  'status',
  'date_played',
  'scheduled_at',
  'social_image_url',
  'bracket_side',
  'bracket_pos',
  'created_at',
  'updated_at',
  'player_1_name',
  'player_2_name',
  'player_1_avatar_url',
  'player_2_avatar_url',
  'winner_name',
  'round_status',
  'games',
] as const satisfies readonly (keyof PublicMatch)[];

/**
 * The admin-only match columns `PublicMatch` leaves out. Only admins, resource
 * admins and the match's participants receive them (see the header).
 */
export const PRIVATE_MATCH_FIELDS = [
  'notes',
  'submitter_id',
  'auto_confirm_at',
  'confirmed_at',
] as const satisfies readonly Exclude<keyof MatchWithPlayers, keyof PublicMatch>[];

/** The fields of a public game summary, in order (every `GameSummary` field). */
export const PUBLIC_GAME_FIELDS = [
  'id',
  'game_number',
  'winner_id',
  'replay_url',
  'source',
  'stats_locked',
] as const satisfies readonly (keyof GameSummary)[];

// ─── Compile-time completeness checks ─────────────────────────────────────
//
// The two lists partition `MatchWithPlayers`' keys: every key is public or
// private (a new column fails here until it is classified), the public list
// names every `PublicMatch` key, and the game list names every `GameSummary`
// key. Each alias is `true` only when its check holds, and `Assert` rejects
// a `false` one, so a failing check is a type error (no runtime code).

type PublicMatchField = (typeof PUBLIC_MATCH_FIELDS)[number];
type PrivateMatchField = (typeof PRIVATE_MATCH_FIELDS)[number];
type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends true> = T;

type MatchKeysPartitioned = IsNever<
  | Exclude<keyof MatchWithPlayers, PublicMatchField | PrivateMatchField>
  | Exclude<PublicMatchField | PrivateMatchField, keyof MatchWithPlayers>
  | Extract<PublicMatchField, PrivateMatchField>
>;
type PublicMatchFieldsComplete = IsNever<Exclude<keyof PublicMatch, PublicMatchField>>;
type PublicGameFieldsComplete = IsNever<Exclude<keyof GameSummary, (typeof PUBLIC_GAME_FIELDS)[number]>>;

/** Compile-time only: the `_` prefix keeps the unused-vars lint quiet. */
type _MatchFieldChecks = [
  Assert<MatchKeysPartitioned>,
  Assert<PublicMatchFieldsComplete>,
  Assert<PublicGameFieldsComplete>,
];

// ─── Mappers ──────────────────────────────────────────────────────────────

/** Anything with a match's public fields (full `MatchWithPlayers` rows included). */
export type PublicMatchSource = Pick<MatchWithPlayers, keyof PublicMatch>;

function toPublicGame(game: GameSummary): GameSummary {
  return {
    id: game.id,
    game_number: game.game_number,
    winner_id: game.winner_id,
    replay_url: game.replay_url,
    source: game.source,
    stats_locked: game.stats_locked,
  };
}

/**
 * A match as any viewer may receive it. Copies each public field by name and
 * each game field by field; values pass through unchanged.
 */
export function toPublicMatch(match: PublicMatchSource): PublicMatch {
  return {
    id: match.id,
    round_id: match.round_id,
    tournament_id: match.tournament_id,
    player_1_id: match.player_1_id,
    player_2_id: match.player_2_id,
    winner_id: match.winner_id,
    status: match.status,
    date_played: match.date_played,
    scheduled_at: match.scheduled_at,
    social_image_url: match.social_image_url,
    bracket_side: match.bracket_side,
    bracket_pos: match.bracket_pos,
    created_at: match.created_at,
    updated_at: match.updated_at,
    player_1_name: match.player_1_name,
    player_2_name: match.player_2_name,
    player_1_avatar_url: match.player_1_avatar_url,
    player_2_avatar_url: match.player_2_avatar_url,
    winner_name: match.winner_name,
    round_status: match.round_status,
    games: match.games.map(toPublicGame),
  };
}

export function toPublicMatches(matches: readonly PublicMatchSource[]): PublicMatch[] {
  return matches.map(toPublicMatch);
}
