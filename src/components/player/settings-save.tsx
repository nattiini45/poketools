'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@/components/ui/Button';
import { useT } from '@/i18n/client';
import { accountMessages } from '@/i18n/messages/account';
import { PlateButton } from './Plate';

interface SaveEntry {
  dirty: boolean;
  saving: boolean;
  /** The section's own save: its request, validation and messages stay in the section. */
  save: () => void | Promise<void>;
  /** Puts the section back to what is stored. */
  reset: () => void;
}

interface SaveRegistry {
  report: (id: string, state: { dirty: boolean; saving: boolean } | null) => void;
  handlers: React.RefObject<Map<string, Pick<SaveEntry, 'save' | 'reset'>>>;
}

const SaveContext = createContext<SaveRegistry | null>(null);

/**
 * Reports a section's unsaved state to the page's save bar. Returns true when a bar is mounted, so the section drops
 * its own Save button; without one (a section rendered on its own) it keeps the button.
 */
export function useSettingsSave(id: string, entry: SaveEntry): boolean {
  const registry = useContext(SaveContext);
  const { dirty, saving, save, reset } = entry;
  useEffect(() => {
    registry?.handlers.current.set(id, { save, reset });
  }, [registry, id, save, reset]);
  useEffect(() => {
    registry?.report(id, { dirty, saving });
  }, [registry, id, dirty, saving]);
  useEffect(() => {
    if (!registry) return;
    const handlers = registry.handlers.current;
    return () => {
      handlers.delete(id);
      registry.report(id, null);
    };
  }, [registry, id]);
  return registry !== null;
}

/**
 * The settings page's one save bar. Sections keep their own write paths; the bar counts the sections with unsaved
 * changes and runs each one's save (or reset). It is sticky at the bottom of the viewport and, below `lg`, sits above
 * the phone tab bar.
 */
export function SettingsSaveProvider({ children }: { children: ReactNode }) {
  const t = useT(accountMessages);
  const handlers = useRef(new Map<string, Pick<SaveEntry, 'save' | 'reset'>>());
  const [states, setStates] = useState<Record<string, { dirty: boolean; saving: boolean }>>({});

  const report = useCallback<SaveRegistry['report']>((id, state) => {
    setStates((prev) => {
      if (state === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const current = prev[id];
      if (current && current.dirty === state.dirty && current.saving === state.saving) return prev;
      return { ...prev, [id]: state };
    });
  }, []);
  const registry = useMemo(() => ({ report, handlers }), [report]);

  const dirtyIds = Object.keys(states).filter((id) => states[id].dirty);
  const saving = Object.values(states).some((state) => state.saving);

  return (
    <SaveContext.Provider value={registry}>
      {children}
      <div aria-live="polite" className="sr-only">
        {dirtyIds.length > 0 ? t('saveBar.unsaved', { count: dirtyIds.length }) : ''}
      </div>
      {dirtyIds.length > 0 && (
        <div className="sticky bottom-[calc(56px+env(safe-area-inset-bottom)+0.5rem)] z-30 mt-5 lg:bottom-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-poke-lg border border-hairline-strong bg-elevated px-4 py-2.5 shadow-surface-2">
            <p className="flex items-center gap-2.5 text-body text-fg">
              <span aria-hidden="true" className="h-5 w-1.5 shrink-0 rounded-[1px] bg-accent-fill [transform:skewX(var(--skew))]" />
              {t('saveBar.unsaved', { count: dirtyIds.length })}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => dirtyIds.forEach((id) => handlers.current.get(id)?.reset())}
              >
                {t('saveBar.discard')}
              </Button>
              <PlateButton disabled={saving} onClick={() => dirtyIds.forEach((id) => void handlers.current.get(id)?.save())}>
                {saving ? t('saveBar.saving') : t('saveBar.save')}
              </PlateButton>
            </div>
          </div>
        </div>
      )}
    </SaveContext.Provider>
  );
}
