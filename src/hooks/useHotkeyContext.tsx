"use client";

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface HotkeyEntry {
  key: string;
  description: string;
  scope: string;
}

interface HotkeyContextValue {
  register: (entries: HotkeyEntry[]) => () => void;
  bindings: HotkeyEntry[];
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

const HotkeyContext = createContext<HotkeyContextValue | null>(null);

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const bindingsRef = useRef<Map<string, HotkeyEntry>>(new Map());
  const [bindings, setBindings] = useState<HotkeyEntry[]>([]);

  const register = useCallback((entries: HotkeyEntry[]) => {
    for (const entry of entries) {
      bindingsRef.current.set(`${entry.scope}:${entry.key}`, entry);
    }
    setBindings(Array.from(bindingsRef.current.values()));
    return () => {
      for (const entry of entries) {
        bindingsRef.current.delete(`${entry.scope}:${entry.key}`);
      }
      setBindings(Array.from(bindingsRef.current.values()));
    };
  }, []);

  return (
    <HotkeyContext.Provider value={{ register, bindings, helpOpen, setHelpOpen }}>
      {children}
    </HotkeyContext.Provider>
  );
}

export function useHotkeyContext() {
  const ctx = useContext(HotkeyContext);
  if (!ctx) throw new Error("useHotkeyContext must be used within HotkeyProvider");
  return ctx;
}
