"use client";

import { useState } from "react";
import { useCasterPokemonInfo } from "./CasterDataContext";
import type { TrackerDispatchAction } from "@/lib/broadcast/tracker-reducer";
import { useDataLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeMove } from "@/lib/pkmn/i18n/names/moves";

interface MoveQuickSelectProps {
  pokemonName: string;
  player: 1 | 2;
  slotIndex: number;
  movesUsed: string[];
  dispatch: (action: TrackerDispatchAction) => void;
}

export default function MoveQuickSelect({
  pokemonName,
  player,
  slotIndex,
  movesUsed,
  dispatch,
}: MoveQuickSelectProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const info = useCasterPokemonInfo(pokemonName, player);
  const [customMove, setCustomMove] = useState("");

  const knownMoves = info?.moves ?? [];
  const usedSet = new Set(movesUsed);

  const handleToggle = (move: string) => {
    if (usedSet.has(move)) {
      dispatch({ type: "remove_move", player, slot: slotIndex, move });
    } else {
      dispatch({ type: "log_move", player, slot: slotIndex, move });
    }
  };

  const handleCustomSubmit = () => {
    const trimmed = customMove.trim();
    if (trimmed && !usedSet.has(trimmed)) {
      dispatch({ type: "log_move", player, slot: slotIndex, move: trimmed });
      setCustomMove("");
    }
  };

  return (
    <div className="mt-1 px-2 space-y-1.5">
      {/* Known moves grid */}
      {knownMoves.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {knownMoves.map((move) => (
            <button
              key={move}
              type="button"
              onClick={() => handleToggle(move)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                usedSet.has(move)
                  ? "bg-poke-accent/20 text-poke-accent border border-poke-accent/40"
                  : "bg-poke-elevated text-poke-text-secondary hover:text-poke-text border border-transparent"
              }`}
            >
              {localizeMove(move, dataLocale)}
            </button>
          ))}
        </div>
      )}

      {/* Logged but unknown moves */}
      {movesUsed.filter((m) => !knownMoves.includes(m)).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {movesUsed
            .filter((m) => !knownMoves.includes(m))
            .map((move) => (
              <span
                key={move}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-poke-elevated text-[10px] text-poke-text border border-poke-accent/30"
              >
                {localizeMove(move, dataLocale)}
                <button
                  type="button"
                  onClick={() => dispatch({ type: "remove_move", player, slot: slotIndex, move })}
                  className="text-poke-text-secondary hover:text-red-400"
                  aria-label={t("moveSelect.remove", { move: localizeMove(move, dataLocale) })}
                >
                  x
                </button>
              </span>
            ))}
        </div>
      )}

      {/* Custom move input */}
      <div className="flex gap-1">
        <input
          type="text"
          value={customMove}
          onChange={(e) => setCustomMove(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCustomSubmit();
            }
          }}
          placeholder={t("moveSelect.customPlaceholder")}
          className="flex-1 px-2 py-0.5 text-[10px] rounded bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted focus:outline-none focus:border-poke-accent/50"
        />
        {customMove.trim() && (
          <button
            type="button"
            onClick={handleCustomSubmit}
            className="px-2 py-0.5 text-[10px] rounded bg-poke-accent/20 text-poke-accent font-medium"
          >
            {t("moveSelect.add")}
          </button>
        )}
      </div>
    </div>
  );
}
