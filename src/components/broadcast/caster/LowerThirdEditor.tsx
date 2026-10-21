"use client";

import { useState, useRef, useEffect } from "react";
import { createCastChannel } from "@/lib/broadcast/channel";
import { useLocale, useT } from "@/i18n/client";
import { upperForPaint } from "@/i18n/core";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface LowerThirdEditorProps {
  sessionId?: string;
}

/** Preset keys; the text is stored in sentence case and sent in caps (i18n-core §1.3). */
const PRESETS = ["upsetAlert", "playoffImplications", "matchPoint", "firstBlood"] as const;
type PresetKey = (typeof PRESETS)[number];

export default function LowerThirdEditor({ sessionId }: LowerThirdEditorProps) {
  const t = useT(broadcastCasterMessages);
  const locale = useLocale();
  const presetText = (preset: PresetKey) => upperForPaint(t(`lowerThird.presets.${preset}`), locale);
  const [text, setText] = useState("");
  const [subtext, setSubtext] = useState("");
  const channelRef = useRef(sessionId ? createCastChannel(sessionId) : null);

  const broadcast = (show: boolean) => {
    channelRef.current?.send({
      type: "lower_third_update",
      text,
      subtext,
      visible: show,
      preset: null,
    });
  };

  // The lower-third text is caster content sent to the overlay, so a preset
  // is applied in the caster's language at click time.
  const applyPreset = (preset: PresetKey) => {
    setText(presetText(preset));
    setSubtext("");
  };

  useEffect(() => {
    const ch = channelRef.current;
    return () => ch?.close();
  }, []);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-poke-text">{t("lowerThird.title")}</h3>

      {/* Text inputs */}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("lowerThird.textPlaceholder")}
        className="w-full px-3 py-1.5 text-sm rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted focus:outline-none focus:border-poke-accent/50"
      />
      <input
        type="text"
        value={subtext}
        onChange={(e) => setSubtext(e.target.value)}
        placeholder={t("lowerThird.subtextPlaceholder")}
        className="w-full px-3 py-1.5 text-xs rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted focus:outline-none focus:border-poke-accent/50"
      />

      {/* Presets */}
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => applyPreset(p)}
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-poke-elevated text-poke-text-secondary hover:text-poke-text border border-poke-border/30 hover:border-poke-accent/40 transition-colors"
          >
            {presetText(p)}
          </button>
        ))}
      </div>

      {/* Preview */}
      {text && (
        <div className="rounded-lg bg-gradient-to-r from-poke-surface to-poke-elevated border border-poke-border/30 px-4 py-2.5">
          <div className="text-sm font-bold text-poke-text">{text}</div>
          {subtext && (
            <div className="text-xs text-poke-text-secondary mt-0.5">{subtext}</div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => broadcast(true)}
          disabled={!text}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-poke-accent text-poke-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {t("lowerThird.show")}
        </button>
        <button
          type="button"
          onClick={() => broadcast(false)}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-poke-elevated text-poke-text-secondary hover:text-poke-text transition-colors"
        >
          {t("lowerThird.hide")}
        </button>
      </div>
    </div>
  );
}
