"use client";

import TypeBadge from "@/components/shared/TypeBadge";
import { Card } from "@/components/ui";
import { useDataLocale, useLocale, useT } from "@/i18n/client";
import { translateEngineLabel } from "@/i18n/content/engine-labels";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";
import { localizeAbility } from "@/lib/pkmn/i18n/names/abilities";
import { localizeItem } from "@/lib/pkmn/i18n/names/items";
import { localizeSpecies } from "@/lib/pkmn/i18n/names/species";
import type { TeamArchetype } from "@/lib/pkmn/archetype";
import type { CasterData, CasterPlayerInfo } from "@/types/caster";

/** Archetype ids (stored English) -> message keys. */
const ARCHETYPE_KEYS = {
  "Hyper Offense": "hyperOffense",
  "Bulky Offense": "bulkyOffense",
  Balance: "balance",
  Stall: "stall",
  Rain: "rain",
  Sun: "sun",
  Sand: "sand",
  Snow: "snow",
  "Trick Room": "trickRoom",
  "Volt-Turn": "voltTurn",
  "Hazard Stack": "hazardStack",
  Weather: "weather",
} as const satisfies Record<TeamArchetype, string>;

function isArchetype(value: string): value is TeamArchetype {
  return Object.prototype.hasOwnProperty.call(ARCHETYPE_KEYS, value);
}

interface CheatSheetProps {
  data: CasterData;
}

function PlayerSection({ player, color }: { player: CasterPlayerInfo; color: string }) {
  const t = useT(broadcastCasterMessages);
  const dataLocale = useDataLocale();
  const species = (name: string) => localizeSpecies(name, dataLocale);
  const archetypeLabel = (a: string) =>
    isArchetype(a) ? t(`cheatSheet.archetype.${ARCHETYPE_KEYS[a]}`) : a;
  const topSpeeds = [...player.pokemon]
    .sort((a, b) => b.speedTiers.max.raw - a.speedTiers.max.raw)
    .slice(0, 5);

  const offMeta = player.pokemon.filter(
    (p) => p.usagePct !== null && p.usagePct < 5
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className={`text-lg font-bold ${color}`}>{player.name}</h3>
        {player.rating && (
          <span className="text-xs text-poke-text-secondary font-mono">
            {t("cheatSheet.rating", { rating: String(Math.round(player.rating)) })}
          </span>
        )}
        {player.streak.type && player.streak.count >= 2 && (
          <span className={`text-xs font-medium ${player.streak.type === 'win' ? 'text-emerald-400' : 'text-red-400'}`}>
            {player.streak.type === 'win'
              ? t("cheatSheet.winStreak", { count: player.streak.count })
              : t("cheatSheet.lossStreak", { count: player.streak.count })}
          </span>
        )}
      </div>

      {/* Record */}
      <div className="text-xs text-poke-text-secondary">
        {player.record.draws > 0
          ? t("cheatSheet.recordWithDraws", {
              wins: player.record.wins,
              losses: player.record.losses,
              draws: player.record.draws,
            })
          : t("cheatSheet.record", { wins: player.record.wins, losses: player.record.losses })}
        {player.archetype && (
          <span className="ml-2 px-2 py-0.5 rounded-full bg-poke-elevated text-poke-text font-medium">
            {archetypeLabel(player.archetype.primary)}
            {player.archetype.secondary && ` / ${archetypeLabel(player.archetype.secondary)}`}
          </span>
        )}
      </div>

      {/* Roster */}
      <div className="grid grid-cols-2 gap-2">
        {player.pokemon.map((p) => (
          <div key={p.species} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-poke-surface/50 border border-poke-border/20">
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-poke-text truncate">{species(p.species)}</div>
              <div className="flex items-center gap-0.5 mt-0.5">
                {p.types.map((type) => (
                  <TypeBadge key={type} type={type} className="text-[8px] px-0.5 py-0" />
                ))}
              </div>
            </div>
            <div className="text-right text-[10px] text-poke-text-secondary">
              {p.ability && <div>{localizeAbility(p.ability, dataLocale)}</div>}
              {p.item && <div className="text-poke-text-muted">{localizeItem(p.item, dataLocale)}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Speed Top-5 */}
      <div>
        <h4 className="text-[10px] font-semibold text-poke-text-secondary uppercase tracking-wider mb-1">
          {t("cheatSheet.speedTiersMax")}
        </h4>
        <div className="flex gap-2 text-[10px]">
          {topSpeeds.map((p) => (
            <span
              key={p.species}
              className="inline-flex min-w-0 px-1.5 py-0.5 rounded bg-poke-elevated text-poke-text font-mono"
              title={species(p.species)}
            >
              {/* Localized names vary in length: truncate by width, not characters. */}
              <span className="max-w-[8ch] truncate">{species(p.species)}</span>
              <span className="shrink-0">: {p.speedTiers.max.raw}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Off-meta */}
      {offMeta.length > 0 && (
        <div className="text-xs">
          <span className="text-amber-400 font-medium">{t("cheatSheet.offMeta")}</span>
          {offMeta.map((p) => species(p.species)).join(", ")}
        </div>
      )}
    </div>
  );
}

export default function CheatSheet({ data }: CheatSheetProps) {
  const t = useT(broadcastCasterMessages);
  const locale = useLocale();
  return (
    <div className="space-y-6 print:space-y-4">
      {/* Match header */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-poke-text-secondary">
              {data.roundName && translateEngineLabel("round", data.roundName, locale)}
            </div>
            <div className="text-sm text-poke-text-muted">
              {t("cheatSheet.bestOf", { bestOf: data.bestOf, format: data.format ?? "" })}
            </div>
          </div>
          {data.h2h.player1Wins + data.h2h.player2Wins > 0 && (
            <div className="text-xs text-poke-text-secondary">
              {t("cheatSheet.h2h", { a: data.h2h.player1Wins, b: data.h2h.player2Wins })}
            </div>
          )}
        </div>
      </Card>

      {/* Player sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-4">
          <PlayerSection player={data.player1} color="text-blue-400" />
        </Card>
        <Card className="p-4">
          <PlayerSection player={data.player2} color="text-red-400" />
        </Card>
      </div>

      {/* Standings context */}
      {data.standings && data.standings.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-bold text-poke-text mb-2">{t("cheatSheet.standingsTop8")}</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1 text-xs">
            {data.standings.slice(0, 8).map((s) => {
              const isInMatch = s.playerId === data.player1.id || s.playerId === data.player2.id;
              return (
                <div
                  key={s.playerId}
                  className={`flex items-center justify-between px-2 py-1 rounded ${isInMatch ? 'bg-poke-accent/10 text-poke-accent font-medium' : 'text-poke-text-secondary'}`}
                >
                  <span>#{s.rank} {s.playerName}</span>
                  <span className="font-mono">{s.wins}-{s.losses}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
