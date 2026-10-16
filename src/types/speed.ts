// ── Speed benchmark (from meta usage data) ─────────────────────────

export interface SpeedBenchmark {
  species: string;
  speed: number;
  label: string;
  evs: number;
  nature: 'positive' | 'neutral';
  item?: string;
  baseSpe: number;
}

// ── Speed calculation result ────────────────────────────────────────

export type NatureEffect = 'positive' | 'negative' | 'neutral';

export interface SpeedResult {
  raw: number;
  withItem: number;
  withAbility: number;
  final: number;
  modifiers: {
    item: { name: string; mod: number } | null;
    ability: { name: string; mod: number } | null;
    status: { name: string; mod: number } | null;
    boosts: number;
  };
}

// ── Outspeed solver ─────────────────────────────────────────────────

export interface SpeedSolution {
  nature: string;
  ev: number;
  resulting_speed: number;
  remaining_evs: number;
  label: string;
}

export interface OutspeedResult {
  outspeeds: Array<{ species: string; speed: number; label: string }>;
  outsped_by: Array<{ species: string; speed: number; label: string }>;
  speed_ties: Array<{ species: string; speed: number; label: string }>;
}

// ── API request/response ────────────────────────────────────────────

export interface SpeedTiersResponse {
  format: string;
  benchmarks: SpeedBenchmark[];
  min_speed: number;
  max_speed: number;
  common_ranges: {
    slow: [number, number];
    mid: [number, number];
    fast: [number, number];
    scarf: [number, number];
  };
}

export interface SpeedCalcRequest {
  species: string;
  target_speed: number;
  generation: number;
  level?: number;
  item?: string;
  ability?: string;
  constraints?: {
    nature: 'any' | 'positive' | 'neutral' | 'negative';
    max_ev?: number;
  };
}

export interface SpeedCalcResponse {
  solutions: SpeedSolution[];
  impossible?: boolean;
  note?: string;
}
