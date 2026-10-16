import type { KoInfo } from '@/lib/pkmn/i18n/calc-text';
import type { StatSpread } from './team';

// ── Calculator Pokémon (used in API request/response) ───────────────

export interface CalcPokemon {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  evs?: Partial<StatSpread>;
  ivs?: Partial<StatSpread>;
  level?: number;
  moves?: string[];
  boosts?: Partial<BoostSpread>;
  status?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
  tera_type?: string;
  is_tera?: boolean;
}

export interface BoostSpread {
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

// ── Field conditions ────────────────────────────────────────────────

export interface CalcField {
  gameType?: 'Singles' | 'Doubles';
  weather?: '' | 'Sun' | 'Rain' | 'Sand' | 'Snow' | 'Harsh Sunshine' | 'Heavy Rain';
  terrain?: '' | 'Electric' | 'Grassy' | 'Misty' | 'Psychic';
  isBeadsOfRuin?: boolean;
  isSwordOfRuin?: boolean;
  isTabletsOfRuin?: boolean;
  isVesselOfRuin?: boolean;
  attackerSide?: SideConditions;
  defenderSide?: SideConditions;
}

export interface SideConditions {
  spikes?: number;
  stealth_rock?: boolean;
  reflect?: boolean;
  light_screen?: boolean;
  aurora_veil?: boolean;
  tailwind?: boolean;
  is_helping_hand?: boolean;
  is_friend_guard?: boolean;
}

// ── Calculation result ──────────────────────────────────────────────

export interface CalcResult {
  move: string;
  damage: {
    min: number;
    max: number;
    min_pct: number;
    max_pct: number;
  };
  /** English @smogon/calc KO text. Stays English: the AI agent and the golden-set eval parse it. */
  ko_chance: string;
  /** English @smogon/calc description (stays English). */
  description: string;
  /**
   * Structured KO info (`toKoInfo(kochance())`, `@/lib/pkmn/i18n/calc-text`); displays render it with
   * `formatKo(r.ko, locale, r.ko_chance)` and badge it with `koLevel`. `null` = no KO info (also on a failed calc).
   * Every calc route (`/api/calc/damage`, `/batch`, `/batch-incoming`) sets it on every result.
   */
  ko: KoInfo | null;
  rolls: number[];
  recoil?: { min: number; max: number };
  recovery?: { min: number; max: number };
}

// ── Threat list ─────────────────────────────────────────────────────

export interface ThreatEntry {
  species: string;
  usage_pct: number;
  default_set: CalcPokemon;
  types: string[];
}

// ── API request/response ────────────────────────────────────────────

export interface CalcRequest {
  generation: number;
  attacker: CalcPokemon;
  defender: CalcPokemon;
  move: string;
  field?: CalcField;
  allMoves?: boolean;
}

export interface BatchCalcRequest {
  generation: number;
  attacker: CalcPokemon;
  defenders: CalcPokemon[];
  moves?: string[];
  field?: CalcField;
}

export interface CalcResponse {
  success: true;
  data: { results: CalcResult[] };
}

export interface BatchCalcResponse {
  success: true;
  data: {
    results: Array<{
      defender: string;
      move_results: CalcResult[];
    }>;
  };
}

// ── Batch incoming (many attackers → one defender) ──────────────────

export interface BatchIncomingRequest {
  generation: number;
  attackers: CalcPokemon[];
  defender: CalcPokemon;
  field?: CalcField;
}

export interface BatchIncomingResponse {
  success: true;
  data: {
    results: Array<{
      attacker: string;
      move_results: CalcResult[];
    }>;
  };
}
