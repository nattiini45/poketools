"use client";

import { useState } from "react";
import { OVERLAY_CATEGORIES, buildOverlayUrl, type OverlayTypeDefinition } from "@/lib/broadcast/url-builder";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface SceneSwitcherProps {
  matchId: string;
  seasonId?: string | null;
}

function getEntityId(overlay: OverlayTypeDefinition, matchId: string, seasonId?: string | null): string | null {
  if (overlay.entityType === "match") return matchId;
  if (overlay.entityType === "season" && seasonId) return seasonId;
  return null;
}

export default function SceneSwitcher({ matchId, seasonId }: SceneSwitcherProps) {
  const t = useT(broadcastCasterMessages);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Labels by overlay key / category id; the English registry label is the fallback
  // for an overlay type added to url-builder later.
  const overlayLabel = (overlay: OverlayTypeDefinition) =>
    t.dynamic(`sceneSwitcher.overlay.${overlay.key}`, undefined, overlay.label);
  const categoryLabel = (category: string) => t.dynamic(`sceneSwitcher.category.${category}`, undefined, category);

  const handleCopy = async (overlay: OverlayTypeDefinition) => {
    const entityId = getEntityId(overlay, matchId, seasonId);
    if (!entityId) return;
    const url = buildOverlayUrl(overlay.key, entityId);
    const fullUrl = `${window.location.origin}${url}`;
    await navigator.clipboard.writeText(fullUrl);
    setCopiedKey(overlay.key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Filter categories to those with usable overlays
  const usableCategories = OVERLAY_CATEGORIES.filter((cat) =>
    cat.types.some((ov) => getEntityId(ov, matchId, seasonId) !== null)
  );

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-poke-text">{t("sceneSwitcher.title")}</h3>
      {usableCategories.map((cat) => (
        <div key={cat.category}>
          <h4 className="text-[10px] font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
            {t("sceneSwitcher.categoryOverlays", { category: categoryLabel(cat.category) })}
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {cat.types
              .filter((ov) => getEntityId(ov, matchId, seasonId) !== null)
              .map((overlay) => (
                <button
                  key={overlay.key}
                  type="button"
                  onClick={() => handleCopy(overlay)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors border ${
                    copiedKey === overlay.key
                      ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                      : "bg-poke-surface border-poke-border/30 text-poke-text hover:border-poke-accent/40"
                  }`}
                >
                  <div>{overlayLabel(overlay)}</div>
                  {copiedKey === overlay.key && (
                    <div className="text-[10px] mt-0.5">{t("sceneSwitcher.copied")}</div>
                  )}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
