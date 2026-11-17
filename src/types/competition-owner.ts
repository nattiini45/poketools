export type CompetitionOwner =
  | { kind: 'tournament'; tournament_id: string; season_id: string | null }
  | { kind: 'phase'; phase_id: string; season_id: string };
