import type { PokemonSet, TeamImportSource } from './team';

export interface MatchPrepTeam {
  id: string;
  match_id: string;
  player_id: string;
  pokemon: PokemonSet[];
  import_source: TeamImportSource;
  created_at: string;
  updated_at: string;
}
