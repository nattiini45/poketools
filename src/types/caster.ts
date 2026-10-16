import type { PokemonSet, StatSpread } from './team';
import type { SpeedResult } from './speed';

// ── Per-pokemon enriched data ──────────────────────────────────────
export interface CasterPokemonInfo {
  species: string;
  types: string[];
  baseStats: StatSpread;
  ability: string;
  item: string;
  moves: string[];
  spriteUrl: string;
  itemSpriteUrl: string | null;
  usagePct: number | null;       // from aggregates
  leadPct: number | null;
  bringPct: number | null;
  koDealt: number;
  koReceived: number;
  speedTiers: {
    min: SpeedResult;              // 0 EVs, negative nature
    neutral: SpeedResult;          // 0 EVs, neutral nature
    max: SpeedResult;              // 252 EVs, positive nature
    scarf: SpeedResult;            // 252 EVs, positive nature, Choice Scarf
  };
}

// ── Per-player context ─────────────────────────────────────────────
export interface CasterPlayerInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
  rating: number | null;
  rd: number | null;
  record: { wins: number; losses: number; draws: number };
  signaturePokemon: string | null;
  streak: { type: 'win' | 'loss' | null; count: number };
  team: PokemonSet[];
  pokemon: CasterPokemonInfo[];
  archetype: { primary: string; secondary: string | null; reasoning: string } | null;
  nextMatch: { opponentName: string; roundName: string | null } | null;
}

// ── H2H context ────────────────────────────────────────────────────
export interface CasterH2H {
  player1Wins: number;
  player2Wins: number;
  draws: number;
  pastMatches: Array<{
    matchId: string;
    roundName: string | null;
    winnerId: string | null;
    date: string;
  }>;
}

// ── Full caster data envelope ──────────────────────────────────────
export interface CasterData {
  matchId: string;
  tournamentId: string | null;
  seasonId: string | null;
  roundName: string | null;
  bestOf: number;
  format: string | null;
  generation: number;
  player1: CasterPlayerInfo;
  player2: CasterPlayerInfo;
  h2h: CasterH2H;
  standings: Array<{
    playerId: string;
    playerName: string;
    rank: number;
    points: number;
    wins: number;
    losses: number;
  }> | null;
}
