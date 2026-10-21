export interface SignaturePokemon {
  pokemon_name: string;
  games_played: number;
  win_rate: number; // 0-1
  total_kos: number;
  slot_number: number; // 1-6
  unlocked_at: string; // ISO date
}

export interface PlayerSignatures {
  id: string;
  player_id: string;
  signatures: SignaturePokemon[];
  updated_at: string;
}

export const SIGNATURE_THRESHOLDS = [10, 15, 20, 30, 40, 50] as const;
