"use client";

import { useHotkeyContext } from "@/hooks/useHotkeyContext";
import { useHotkeys } from "@/hooks/useHotkeys";
import { Modal } from "@/components/ui";
import { useMemo } from "react";
import { useT } from "@/i18n/client";
import { broadcastCasterMessages } from "@/i18n/messages/broadcast-caster";

export default function HotkeyHelpModal() {
  const t = useT(broadcastCasterMessages);
  const { bindings, helpOpen, setHelpOpen } = useHotkeyContext();

  useHotkeys(
    [{ key: "?", handler: () => setHelpOpen(!helpOpen), description: t("hotkeys.toggleHelp") }],
    { scope: "help" }
  );

  const grouped = useMemo(() => {
    const map = new Map<string, typeof bindings>();
    for (const b of bindings) {
      if (b.key === "?") continue; // Don't show the help key itself
      const group = map.get(b.scope) ?? [];
      group.push(b);
      map.set(b.scope, group);
    }
    return map;
  }, [bindings]);

  return (
    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t("hotkeys.title")} size="md">
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([scope, entries]) => (
          <div key={scope}>
            <h3 className="text-xs font-semibold text-poke-text-secondary uppercase tracking-wider mb-2">
              {t.dynamic(`hotkeys.scope.${scope}`, undefined, scope)}
            </h3>
            <div className="space-y-1">
              {entries.map((entry) => (
                <div key={entry.key} className="flex items-center justify-between py-1">
                  <span className="text-sm text-poke-text-primary">{entry.description}</span>
                  <kbd className="px-2 py-0.5 text-xs font-mono bg-poke-surface-alt rounded border border-poke-border text-poke-text-secondary">
                    {entry.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
