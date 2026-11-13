"use client";

import TypeBadge from "@/components/shared/TypeBadge";
import StatRadar from "./StatRadar";
import type { CasterPokemonInfo } from "@/types/caster";
import { useDataLocale, useFormatter, useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeAbility } from "@/lib/pkmn/i18n/names/abilities";
import { localizeItem } from "@/lib/pkmn/i18n/names/items";
import { localizeStat } from "@/lib/pkmn/i18n/names/misc";
import { localizeMove } from "@/lib/pkmn/i18n/names/moves";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";

interface PokemonInfoCardProps {
  info: CasterPokemonInfo;
  playerName?: string;
}

export default function PokemonInfoCard({ info, playerName }: PokemonInfoCardProps) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const formatter = useFormatter();
  const speedLabel = localizeStat("spe", dataLocale, "short");

  return (
    <div className="p-3 w-[300px] space-y-3">
      {/* Header: types + usage */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-fg">{localizeSpecies(info.species, dataLocale)}</span>
          {info.types.map((type) => (
            <TypeBadge key={type} type={type} className="text-micro px-1 py-0" />
          ))}
        </div>
        {info.usagePct !== null && (
          <span className="text-micro px-1.5 py-0.5 rounded-full bg-elevated text-fg-muted font-mono">
            {formatter.percentOf(info.usagePct)}
          </span>
        )}
      </div>

      {/* Radar + details row */}
      <div className="flex gap-3">
        <StatRadar stats={info.baseStats} size={80} />

        <div className="flex-1 space-y-1.5 min-w-0">
          {/* Ability */}
          <div className="text-xs">
            <span className="text-fg-muted">{t("infoCard.ability")}</span>
            <span className="text-fg font-medium">{localizeAbility(info.ability, dataLocale)}</span>
          </div>

          {/* Item */}
          {info.item && (
            <div className="flex items-center gap-1 text-xs">
              <span className="text-fg-muted">{t("infoCard.item")}</span>
              {info.itemSpriteUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={info.itemSpriteUrl} alt="" width={16} height={16} className="inline" />
              )}
              <span className="text-fg font-medium">{localizeItem(info.item, dataLocale)}</span>
            </div>
          )}

          {/* Speed tiers */}
          <div className="text-micro text-fg-muted space-y-0.5">
            <div className="flex justify-between">
              <span>{t("infoCard.minSpeed", { stat: speedLabel })}</span>
              <span className="font-mono text-fg">{info.speedTiers.min.raw}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("infoCard.maxSpeed", { stat: speedLabel })}</span>
              <span className="font-mono text-fg">{info.speedTiers.max.raw}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("infoCard.scarf")}</span>
              <span className="font-mono text-fg">{info.speedTiers.scarf.final}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Moves */}
      {info.moves.length > 0 && (
        <div>
          <div className="text-micro text-fg-muted mb-1">{t("infoCard.moves")}</div>
          <div className="flex flex-wrap gap-1">
            {info.moves.slice(0, 4).map((move) => (
              <span
                key={move}
                className="px-1.5 py-0.5 rounded bg-elevated text-micro text-fg font-medium"
              >
                {localizeMove(move, dataLocale)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Player-specific stats */}
      {(info.koDealt > 0 || info.koReceived > 0 || info.bringPct !== null) && (
        <div className="flex gap-3 text-micro pt-1 border-t">
          {playerName && (
            <span className="text-fg-muted">{playerName}:</span>
          )}
          {info.bringPct !== null && (
            <span>
              <span className="text-fg-muted">{t("infoCard.bring")}</span>
              <span className="font-mono text-fg">{formatter.percentOf(info.bringPct)}</span>
            </span>
          )}
          {info.leadPct !== null && (
            <span>
              <span className="text-fg-muted">{t("infoCard.lead")}</span>
              <span className="font-mono text-fg">{formatter.percentOf(info.leadPct)}</span>
            </span>
          )}
          {info.koDealt > 0 && (
            <span className="text-accent-ink">{t("infoCard.kosDealt", { count: info.koDealt })}</span>
          )}
          {info.koReceived > 0 && (
            <span className="text-loss">{t("infoCard.koedCount", { count: info.koReceived })}</span>
          )}
        </div>
      )}
    </div>
  );
}
