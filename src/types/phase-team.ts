import type { Tables } from './database';
import type { PokemonSet, TeamImportSource } from './team';

export type PhaseTeam = Omit<Tables<'phase_teams'>, 'pokemon' | 'share_token' | 'share_enabled_at'> & {
  pokemon: PokemonSet[];
};

export interface PhaseTeamFormData {
  phase_id: string;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  name?: string;
}

export type PhaseMatchPrepTeam = Omit<Tables<'phase_match_prep_teams'>, 'pokemon'> & { pokemon: PokemonSet[] };
