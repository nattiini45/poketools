"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useCasterData } from "../tracker/CasterDataContext";
import type { CasterNotes } from "@/types/cast-session";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface NarrativeNotesProps {
  sessionId?: string;
  initialNotes?: CasterNotes;
}

export default function NarrativeNotes({
  sessionId,
  initialNotes = {},
}: NarrativeNotesProps) {
  const t = useT(broadcastCasterMessages);
  const data = useCasterData();
  const [notes, setNotes] = useState<CasterNotes>(initialNotes);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const debouncedSave = useCallback(
    (updated: CasterNotes) => {
      if (!sessionId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch(`/api/cast-sessions/${sessionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caster_notes: updated }),
          });
        } catch {
          // Silent fail — notes are local-first
        } finally {
          setSaving(false);
        }
      }, 1000);
    },
    [sessionId]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleChange = (key: keyof CasterNotes, value: string) => {
    const updated = { ...notes, [key]: value };
    setNotes(updated);
    debouncedSave(updated);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wider">
          {t("notes.title")}
        </h4>
        {saving && (
          <span className="text-[10px] text-poke-text-muted animate-pulse">
            {t("notes.saving")}
          </span>
        )}
      </div>

      <div>
        <label className="text-[10px] text-blue-400 font-medium block mb-1">
          {t("notes.playerNotes", { name: data?.player1.name ?? t("common.player1") })}
        </label>
        <textarea
          value={notes.player1 ?? ""}
          onChange={(e) => handleChange("player1", e.target.value)}
          placeholder={t("notes.playerPlaceholder")}
          rows={3}
          className="w-full px-2 py-1.5 text-xs rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted resize-none focus:outline-none focus:border-poke-accent/50"
        />
      </div>

      <div>
        <label className="text-[10px] text-red-400 font-medium block mb-1">
          {t("notes.playerNotes", { name: data?.player2.name ?? t("common.player2") })}
        </label>
        <textarea
          value={notes.player2 ?? ""}
          onChange={(e) => handleChange("player2", e.target.value)}
          placeholder={t("notes.playerPlaceholder")}
          rows={3}
          className="w-full px-2 py-1.5 text-xs rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted resize-none focus:outline-none focus:border-poke-accent/50"
        />
      </div>

      <div>
        <label className="text-[10px] text-poke-text-secondary font-medium block mb-1">
          {t("notes.matchNotes")}
        </label>
        <textarea
          value={notes.match ?? ""}
          onChange={(e) => handleChange("match", e.target.value)}
          placeholder={t("notes.matchPlaceholder")}
          rows={3}
          className="w-full px-2 py-1.5 text-xs rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted resize-none focus:outline-none focus:border-poke-accent/50"
        />
      </div>
    </div>
  );
}
