import type { Tables } from '@/types/database';
import type { PhaseTeam } from '@/types/phase-team';
import type { SharedTeamView, TeamLibraryEntry } from '@/types/team';

export type PublicPhaseTeam = PhaseTeam;

export const PUBLIC_PHASE_TEAM_FIELDS = [
  'id', 'player_id', 'phase_id', 'season_id', 'name', 'match_id', 'pokemon', 'import_source', 'locked',
  'is_draft_team', 'draft_pool_id', 'library_published_at', 'library_title', 'library_description', 'library_tags',
  'forked_from_team_id', 'forked_from_phase_team_id', 'created_at', 'updated_at',
] as const satisfies readonly (keyof PublicPhaseTeam)[];
export const PRIVATE_PHASE_TEAM_FIELDS = ['share_token', 'share_enabled_at'] as const satisfies readonly Exclude<keyof Tables<'phase_teams'>, keyof PublicPhaseTeam>[];
type Assert<T extends true> = T;
type PublicField = typeof PUBLIC_PHASE_TEAM_FIELDS[number];
type PrivateField = typeof PRIVATE_PHASE_TEAM_FIELDS[number];
type Classified = PublicField | PrivateField;
export type _PhaseTeamColumnsClassified = Assert<
  [Exclude<keyof Tables<'phase_teams'>, Classified> | Exclude<Classified, keyof Tables<'phase_teams'>>
    | Extract<PublicField, PrivateField> | Exclude<keyof PublicPhaseTeam, PublicField>] extends [never] ? true : false
>;

export function toPublicPhaseTeam(team: PhaseTeam): PublicPhaseTeam {
  return {
    id: team.id, player_id: team.player_id, phase_id: team.phase_id, season_id: team.season_id,
    name: team.name, match_id: team.match_id, pokemon: team.pokemon, import_source: team.import_source,
    locked: team.locked, is_draft_team: team.is_draft_team, draft_pool_id: team.draft_pool_id,
    library_published_at: team.library_published_at, library_title: team.library_title,
    library_description: team.library_description, library_tags: team.library_tags,
    forked_from_team_id: team.forked_from_team_id, forked_from_phase_team_id: team.forked_from_phase_team_id,
    created_at: team.created_at, updated_at: team.updated_at,
  };
}

export function phaseTeamForShare(team: PhaseTeam) {
  return { id: team.id, phase_id: team.phase_id, pokemon: team.pokemon.filter((set) => set && set.species),
    library_title: team.library_title, library_description: team.library_description, created_at: team.created_at };
}

/**
 * A native team as the share link shows it: the same `SharedTeamView` allowlist the legacy link answers with, so the
 * shared page and `GET /api/teams/shared/[token]` render either store from one shape. A phase team names no legacy
 * tournament, so the page's tournament chip stays off (its phase is the competition).
 */
export function phaseTeamShareView(team: PhaseTeam): SharedTeamView {
  return {
    id: team.id,
    pokemon: team.pokemon.filter((set) => set && set.species),
    library_title: team.library_title,
    library_description: team.library_description,
    tournament_id: null,
    created_at: team.created_at,
  };
}

/**
 * A published native team as the library shows it. The caller has already checked `library_published_at`: the listing
 * filters on it and the entry page refuses an unpublished row.
 */
export function phaseTeamLibraryEntry(team: PhaseTeam): TeamLibraryEntry {
  if (!team.library_published_at) throw new Error('phaseTeamLibraryEntry: the row is not published to the library');
  return {
    id: team.id,
    player_id: team.player_id,
    pokemon: team.pokemon,
    library_title: team.library_title,
    library_description: team.library_description,
    library_tags: team.library_tags,
    library_published_at: team.library_published_at,
    forked_from_team_id: team.forked_from_team_id,
    created_at: team.created_at,
    updated_at: team.updated_at,
  };
}
