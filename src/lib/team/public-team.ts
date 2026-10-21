import type { Tables } from '@/types/database';
import type { Team, TeamWithContext } from '@/types/team';

/**
 * Public team shape: the ONLY team fields that may leave the server in an API
 * response or a page payload (code review C1).
 *
 * A `teams` row also carries the share-link columns `share_token` and
 * `share_enabled_at`. The token IS the authorization of the public share link
 * (`GET /api/teams/shared/[token]`, spec §7 "Share Link Visibility"), so it
 * may reach the owner only, and only through the share route's own response
 * (`TeamShareLink`). The team queries never select it, and every response
 * that carries a team maps it here first, field by field, never with a
 * spread: a row that picked up extra properties somewhere (a cast, a future
 * column) still serializes as exactly these fields.
 *
 * Roster redaction (spec §7) happens before this mapper, in
 * `src/lib/team/visibility.ts`; `PublicTeam` says nothing about whether the
 * viewer may see the Pokémon.
 *
 * Pure and type-only: safe to import from server and client modules alike.
 */
export interface PublicTeam {
  id: string;
  player_id: string;
  name: string;
  tournament_id: string | null;
  season_id: string | null;
  match_id: string | null;
  pokemon: Team['pokemon'];
  import_source: Team['import_source'];
  locked: boolean;
  is_draft_team: boolean;
  draft_pool_id: string | null;
  library_published_at: string | null;
  library_title: string | null;
  library_description: string | null;
  library_tags: string[] | null;
  forked_from_team_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A public team with its tournament's name (the owner's team list). */
export interface PublicTeamWithContext extends PublicTeam {
  tournament_name: string | null;
}

/** The fields of `PublicTeam`, in order. Tests assert payloads against it. */
export const PUBLIC_TEAM_FIELDS = [
  'id',
  'player_id',
  'name',
  'tournament_id',
  'season_id',
  'match_id',
  'pokemon',
  'import_source',
  'locked',
  'is_draft_team',
  'draft_pool_id',
  'library_published_at',
  'library_title',
  'library_description',
  'library_tags',
  'forked_from_team_id',
  'created_at',
  'updated_at',
] as const satisfies readonly (keyof PublicTeam)[];

/**
 * The `teams` columns no team response carries. The owner receives the share
 * token only from `POST /api/teams/share`.
 */
export const PRIVATE_TEAM_FIELDS = [
  'share_token',
  'share_enabled_at',
] as const satisfies readonly Exclude<keyof Tables<'teams'>, keyof PublicTeam>[];

// ─── Compile-time completeness checks ─────────────────────────────────────
//
// The two lists partition the `teams` row's columns: every column is public
// or private (a new column fails here until it is classified), and the public
// list names every `PublicTeam` key. Each alias is `true` only when its check
// holds, and `Assert` rejects a `false` one (no runtime code).

type PublicTeamField = (typeof PUBLIC_TEAM_FIELDS)[number];
type PrivateTeamField = (typeof PRIVATE_TEAM_FIELDS)[number];
type TeamColumn = keyof Tables<'teams'>;
type IsNever<T> = [T] extends [never] ? true : false;
type Assert<T extends true> = T;

type TeamColumnsPartitioned = IsNever<
  | Exclude<TeamColumn, PublicTeamField | PrivateTeamField>
  | Exclude<PublicTeamField | PrivateTeamField, TeamColumn>
  | Extract<PublicTeamField, PrivateTeamField>
>;
type PublicTeamFieldsComplete = IsNever<Exclude<keyof PublicTeam, PublicTeamField>>;

/** Compile-time only: the `_` prefix keeps the unused-vars lint quiet. */
export type _PublicTeamChecks = [Assert<TeamColumnsPartitioned>, Assert<PublicTeamFieldsComplete>];

/** Copy the public fields of `team`, one by one. */
export function toPublicTeam(team: Team): PublicTeam {
  return {
    id: team.id,
    player_id: team.player_id,
    name: team.name,
    tournament_id: team.tournament_id,
    season_id: team.season_id,
    match_id: team.match_id,
    pokemon: team.pokemon,
    import_source: team.import_source,
    locked: team.locked,
    is_draft_team: team.is_draft_team,
    draft_pool_id: team.draft_pool_id,
    library_published_at: team.library_published_at,
    library_title: team.library_title,
    library_description: team.library_description,
    library_tags: team.library_tags,
    forked_from_team_id: team.forked_from_team_id,
    created_at: team.created_at,
    updated_at: team.updated_at,
  };
}

/** `toPublicTeam` plus the tournament name (the owner's team list). */
export function toPublicTeamWithContext(team: TeamWithContext): PublicTeamWithContext {
  return { ...toPublicTeam(team), tournament_name: team.tournament_name };
}
