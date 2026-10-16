"use client";

import { useMemo } from "react";
import { useCasterData } from "./CasterDataContext";
import { previewRatingChange } from "@/lib/rating/glicko2-preview";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

export default function RatingChangePreview() {
  const t = useT(broadcastCasterMessages);
  const data = useCasterData();

  const previews = useMemo(() => {
    if (!data?.player1.rating || !data?.player2.rating) return null;

    const p1Win = previewRatingChange(
      data.player1.rating, data.player1.rd ?? 200, 0.06,
      data.player2.rating, data.player2.rd ?? 200, 0.06,
      1
    );
    const p2Win = previewRatingChange(
      data.player1.rating, data.player1.rd ?? 200, 0.06,
      data.player2.rating, data.player2.rd ?? 200, 0.06,
      2
    );

    return { p1Win, p2Win };
  }, [data]);

  if (!previews) return null;

  return (
    <div className="flex items-center justify-center gap-6 py-2 text-xs">
      <div className="text-center">
        <div className="text-poke-text-secondary">{t("rating.wins", { name: data?.player1.name ?? "" })}</div>
        <div className="flex gap-3 mt-0.5">
          <span className="text-emerald-400 font-mono font-bold">
            +{previews.p1Win.player1Delta}
          </span>
          <span className="text-red-400 font-mono font-bold">
            {previews.p1Win.player2Delta}
          </span>
        </div>
      </div>
      <div className="w-px h-8 bg-poke-border/30" />
      <div className="text-center">
        <div className="text-poke-text-secondary">{t("rating.wins", { name: data?.player2.name ?? "" })}</div>
        <div className="flex gap-3 mt-0.5">
          <span className="text-red-400 font-mono font-bold">
            {previews.p2Win.player1Delta}
          </span>
          <span className="text-emerald-400 font-mono font-bold">
            +{previews.p2Win.player2Delta}
          </span>
        </div>
      </div>
    </div>
  );
}
