"use client";

import { useCasterData } from "./CasterDataContext";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

export default function NextMatchTeaser() {
  const t = useT(broadcastCasterMessages);
  const data = useCasterData();
  if (!data) return null;

  const p1Next = data.player1.nextMatch;
  const p2Next = data.player2.nextMatch;

  if (!p1Next && !p2Next) return null;

  return (
    <div className="flex gap-4 text-xs text-fg-muted">
      {p1Next && (
        <div className="flex-1 px-3 py-2 rounded-lg border">
          <span className="text-micro text-fg-muted">{t("nextMatch.nextFor", { name: data.player1.name })}</span>
          <div className="text-fg font-medium mt-0.5">
            {t("common.versus", { name: p1Next.opponentName })}
          </div>
        </div>
      )}
      {p2Next && (
        <div className="flex-1 px-3 py-2 rounded-lg border">
          <span className="text-micro text-fg-muted">{t("nextMatch.nextFor", { name: data.player2.name })}</span>
          <div className="text-fg font-medium mt-0.5">
            {t("common.versus", { name: p2Next.opponentName })}
          </div>
        </div>
      )}
    </div>
  );
}
