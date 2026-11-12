'use client';

import { Children, isValidElement, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import SkewPlate from '@/components/ui/SkewPlate';

interface GalleryPanelProps {
  /** Names the tab and the panel; unique within one strip. */
  id: string;
  label: string;
  /** A count shown after the label. */
  count?: number;
  children: ReactNode;
}

/**
 * One panel of a `GalleryTabs` strip (a server page imports it as a client reference, so the strip finds its panels by their
 * props, never by comparing element types): its props name the tab, its children are the panel the server page rendered.
 */
export function GalleryPanel({ children }: GalleryPanelProps) {
  return <>{children}</>;
}

interface GalleryTabsProps {
  /** The `GalleryPanel`s, in tab order. */
  children: ReactNode;
  /** Names the strip for assistive technology. */
  label: string;
  /** Shared by the tabs of one strip, so the accent underside glides between them. */
  glideId: string;
}

/**
 * The tabs of a studio gallery (Yours, Shared, Examples; redesign A10a). Every panel is rendered by the server page and
 * the inactive ones are hidden, so switching reads and fetches nothing. The strip scrolls sideways on a phone instead of
 * wrapping; arrow keys, Home and End move between the tabs.
 */
export default function GalleryTabs({ children, label, glideId }: GalleryTabsProps) {
  const base = useId();
  const tabs = Children.toArray(children).filter((child): child is ReactElement<GalleryPanelProps> => isValidElement(child));
  const [active, setActive] = useState(tabs[0]?.props.id ?? '');
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? tabs.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = tabs[next].props.id;
    setActive(target);
    buttons.current[target]?.focus();
  };

  return (
    <div className="space-y-4" data-gallery-tabs>
      <div role="tablist" aria-label={label} className="-mx-1 flex w-auto items-center gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
        {tabs.map((panel, index) => {
          const tab = panel.props;
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                buttons.current[tab.id] = node;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              onKeyDown={(event) => move(event, index)}
              className="relative inline-flex shrink-0 items-center whitespace-nowrap rounded-[3px] text-body max-sm:min-h-11"
            >
              <SkewPlate variant="tab" active={selected} glideId={glideId}>
                <span className="inline-flex items-baseline gap-1.5">
                  {tab.label}
                  {tab.count !== undefined && <span className="font-mono text-caption tabular-nums text-fg-muted">{tab.count}</span>}
                </span>
              </SkewPlate>
            </button>
          );
        })}
      </div>
      {tabs.map((panel) => (
        <div
          key={panel.props.id}
          role="tabpanel"
          id={`${base}-panel-${panel.props.id}`}
          aria-labelledby={`${base}-tab-${panel.props.id}`}
          hidden={panel.props.id !== active}
          className="min-w-0 space-y-4"
        >
          {panel}
        </div>
      ))}
    </div>
  );
}
