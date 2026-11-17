import type { Tables } from '@/types/database';
import type { PhaseTeam } from '@/types/phase-team';

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
