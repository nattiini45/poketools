import type { PokemonSet, StatSpread } from './team';

// ── Smogon moveset (raw with slash options) ─────────────────────────

export interface SmogonMoveset {
  moves: (string | string[])[];
  ability: string | string[];
  item: string | string[];
  nature: string | string[];
  evs?: Partial<StatSpread>;
  ivs?: Partial<StatSpread>;
  teratypes?: string[];
  level?: number;
}

// ── Database row ────────────────────────────────────────────────────

export interface SampleSetRow {
  id: string;
  generation: number;
  format: string;
  pokemon_name: string;
  set_name: string;
  moveset: SmogonMoveset;
  description: string | null;
  outdated: boolean;
  last_imported: string;
}

// ── Resolved set (slash options picked, ready to load) ──────────────

export interface ResolvedSampleSet {
  set_name: string;
  format: string;
  pokemon_set: PokemonSet;
  raw_moveset: SmogonMoveset;
  description: string | null;
  outdated: boolean;
}

// ── Import types ────────────────────────────────────────────────────

export interface SetImportResult {
  generation: number;
  setsCount: number;
  analysesCount: number;
  status: 'success' | 'skipped' | 'error';
  error?: string;
}
