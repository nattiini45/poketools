"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createCastChannel } from "@/lib/broadcast/channel";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

interface CountdownTimerProps {
  sessionId?: string;
}

const PRESET_MINUTES = [1, 3, 5, 10] as const;

export default function CountdownTimer({ sessionId }: CountdownTimerProps) {
  const [endTime, setEndTime] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);
  const t = useT(broadcastCasterMessages);
  // null = the default label, translated at render (never store translated text in state)
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const label = customLabel ?? t("timer.defaultLabel");
  const channelRef = useRef(sessionId ? createCastChannel(sessionId) : null);

  // Tick every 250ms
  useEffect(() => {
    if (!endTime) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) setEndTime(null);
    }, 250);
    return () => clearInterval(id);
  }, [endTime]);

  // Reset remaining when no endTime
  const displayRemaining = endTime ? remaining : 0;

  const startTimer = useCallback(
    (seconds: number) => {
      const end = Date.now() + seconds * 1000;
      setEndTime(end);
      channelRef.current?.send({ type: "timer_sync", endTime: end, label });
    },
    [label]
  );

  const stopTimer = useCallback(() => {
    setEndTime(null);
    channelRef.current?.send({ type: "timer_sync", endTime: null, label });
  }, [label]);

  // Cleanup
  useEffect(() => {
    const ch = channelRef.current;
    return () => ch?.close();
  }, []);

  const mins = Math.floor(displayRemaining / 60);
  const secs = displayRemaining % 60;
  const display = `${mins}:${String(secs).padStart(2, "0")}`;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-poke-text">{t("timer.title")}</h3>

      {/* Label input */}
      <input
        type="text"
        value={label}
        onChange={(e) => setCustomLabel(e.target.value)}
        placeholder={t("timer.labelPlaceholder")}
        className="w-full px-3 py-1.5 text-xs rounded-lg bg-poke-surface border border-poke-border/30 text-poke-text placeholder:text-poke-text-muted focus:outline-none focus:border-poke-accent/50"
      />

      {/* Display */}
      <div className="text-center">
        <div className={`text-4xl font-mono font-bold ${displayRemaining <= 10 && endTime ? "text-red-400 animate-pulse" : "text-poke-text"}`}>
          {display}
        </div>
        {label && <div className="text-xs text-poke-text-secondary mt-1">{label}</div>}
      </div>

      {/* Presets */}
      <div className="flex gap-2 justify-center">
        {PRESET_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => startTimer(minutes * 60)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-poke-elevated text-poke-text-secondary hover:text-poke-text hover:bg-poke-accent/10 transition-colors"
          >
            {t("timer.preset", { minutes })}
          </button>
        ))}
      </div>

      {/* Stop */}
      {endTime && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={stopTimer}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
          >
            {t("timer.stop")}
          </button>
        </div>
      )}
    </div>
  );
}
