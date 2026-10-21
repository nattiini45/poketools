"use client";

import { useCasterData } from "./CasterDataContext";
import type { TrackerState } from "@/types/broadcast";
import { useDataLocale, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";

interface GameRecapPanelProps {
  gameNumber: number;
  winnerId: string | null;
  state: TrackerState;
  seriesScore: [number, number];
}

export default function GameRecapPanel({
  gameNumber,
  winnerId,
  state,
  seriesScore,
}: GameRecapPanelProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const data = useCasterData();
  if (!winnerId) return null;

  const winnerName = data
    ? winnerId === data.player1.id
      ? data.player1.name
      : data.player2.name
    : t("recapPanel.winner");

  // Find MVP (most KOs dealt) from the previous game
  const prevGame = state.games_submitted[state.games_submitted.length - 1];
  if (!prevGame) return null;

  // Use current game state for the last completed game
  // (The submitted game freezes the state)
  const allSlots = [
    ...state.current_game.player1.slots,
    ...state.current_game.player2.slots,
  ];
  const mvpSlot = allSlots
    .filter((s) => s.pokemon_name && s.kos_dealt > 0)
    .sort((a, b) => b.kos_dealt - a.kos_dealt)[0];

  const mvpText = mvpSlot?.pokemon_name
    ? ` ${t("recapPanel.mvp", {
        pokemon: localizeSpecies(mvpSlot.pokemon_name, dataLocale),
        count: mvpSlot.kos_dealt,
      })}`
    : "";

  const [s1, s2] = seriesScore;

  return (
    <div className="px-4 py-3 rounded-xl bg-poke-surface/50 border border-poke-border/30 text-center">
      <div className="text-xs text-poke-text-secondary mb-1">{t("recapPanel.title", { game: gameNumber })}</div>
      <div className="text-sm text-poke-text">
        {t.rich("recapPanel.summary", {
          name: winnerName,
          game: gameNumber,
          winner: (chunks) => <span className="font-bold">{chunks}</span>,
        })}
        {mvpText}{" "}
        {t.rich("recapPanel.series", {
          a: s1,
          b: s2,
          score: (chunks) => <span className="font-mono font-bold">{chunks}</span>,
        })}
      </div>
    </div>
  );
}
