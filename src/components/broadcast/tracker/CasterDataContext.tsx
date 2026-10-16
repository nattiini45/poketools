"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { CasterData, CasterPokemonInfo } from "@/types/caster";

// ─── Context ────────────────────────────────────────────────────────

const CasterDataCtx = createContext<CasterData | null>(null);

export function CasterDataProvider({
  data,
  children,
}: {
  data: CasterData | null;
  children: ReactNode;
}) {
  return (
    <CasterDataCtx.Provider value={data}>{children}</CasterDataCtx.Provider>
  );
}

// ─── Hooks ──────────────────────────────────────────────────────────

/** Full caster data object. Returns null if not loaded. */
export function useCasterData(): CasterData | null {
  return useContext(CasterDataCtx);
}

/**
 * Lookup enriched pokemon info by species + player side.
 * Returns null if caster data not loaded or pokemon not found.
 */
export function useCasterPokemonInfo(
  species: string | null,
  player: 1 | 2
): CasterPokemonInfo | null {
  const data = useContext(CasterDataCtx);
  if (!data || !species) return null;
  const pokemonList = player === 1 ? data.player1.pokemon : data.player2.pokemon;
  return (
    pokemonList.find(
      (p) => p.species.toLowerCase() === species.toLowerCase()
    ) ?? null
  );
}

/**
 * Get all pokemon info for a player side.
 */
export function useCasterPlayerPokemon(player: 1 | 2): CasterPokemonInfo[] {
  const data = useContext(CasterDataCtx);
  if (!data) return [];
  return player === 1 ? data.player1.pokemon : data.player2.pokemon;
}
