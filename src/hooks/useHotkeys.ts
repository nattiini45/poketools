"use client";

import { useEffect, useRef } from "react";
import { useHotkeyContext, type HotkeyEntry } from "./useHotkeyContext";

export interface HotkeyBinding {
  key: string;
  handler: () => void;
  description: string;
  when?: () => boolean;
}

interface UseHotkeysOptions {
  enabled?: boolean;
  scope?: string;
}

const IGNORED_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (IGNORED_TAGS.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Parse "ctrl+shift+z" → { ctrl, shift, alt, meta, key } */
function parseCombo(combo: string) {
  const parts = combo.toLowerCase().split("+");
  return {
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
    meta: parts.includes("meta"),
    key: parts.filter((p) => !["ctrl", "shift", "alt", "meta"].includes(p))[0] ?? "",
  };
}

function matchesEvent(combo: ReturnType<typeof parseCombo>, e: KeyboardEvent): boolean {
  if (combo.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (combo.shift !== e.shiftKey) return false;
  if (combo.alt !== e.altKey) return false;
  const eventKey = e.key.toLowerCase();
  // Handle special keys
  if (combo.key === "enter" && eventKey === "enter") return true;
  if (combo.key === "escape" && eventKey === "escape") return true;
  if (combo.key === "?" && (eventKey === "?" || (e.shiftKey && eventKey === "/"))) return true;
  return eventKey === combo.key;
}

export function useHotkeys(
  bindings: HotkeyBinding[],
  options: UseHotkeysOptions = {}
): void {
  const { enabled = true, scope = "global" } = options;
  const bindingsRef = useRef(bindings);

  useEffect(() => {
    bindingsRef.current = bindings;
  });

  const ctx = useHotkeyContext();

  // Register for help display
  useEffect(() => {
    if (!enabled) return;
    const entries: HotkeyEntry[] = bindings.map((b) => ({
      key: b.key,
      description: b.description,
      scope,
    }));
    return ctx.register(entries);
  }, [enabled, scope, ctx, bindings]);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;

      for (const binding of bindingsRef.current) {
        const combo = parseCombo(binding.key);
        if (!matchesEvent(combo, e)) continue;
        if (binding.when && !binding.when()) continue;
        e.preventDefault();
        binding.handler();
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}
