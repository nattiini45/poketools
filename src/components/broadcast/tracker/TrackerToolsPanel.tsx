"use client";

import { useState, type ReactNode } from "react";
import SpeedTierPanel from "./SpeedTierPanel";
import TypeMatchupMatrix from "./TypeMatchupMatrix";
import WinConditions from "../caster/WinConditions";
import NarrativeNotes from "../caster/NarrativeNotes";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface Tab {
  id: "speed" | "matchup" | "wincond" | "notes";
  content: ReactNode;
}

interface TrackerToolsPanelProps {
  sessionId?: string;
}

export default function TrackerToolsPanel({ sessionId }: TrackerToolsPanelProps) {
  const t = useT(broadcastCasterMessages);
  const [activeTab, setActiveTab] = useState<Tab["id"]>("speed");

  const tabs: Tab[] = [
    { id: "speed", content: <SpeedTierPanel /> },
    { id: "matchup", content: <TypeMatchupMatrix /> },
    { id: "wincond", content: <WinConditions /> },
    { id: "notes", content: <NarrativeNotes sessionId={sessionId} /> },
  ];

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="bg-poke-surface/50 rounded-xl border border-poke-border/30 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-poke-border/30">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "text-poke-accent border-b-2 border-poke-accent bg-poke-accent/5"
                : "text-poke-text-secondary hover:text-poke-text"
            }`}
          >
            {t(`tools.${tab.id}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-3 max-h-[400px] overflow-y-auto">{active.content}</div>
    </div>
  );
}

