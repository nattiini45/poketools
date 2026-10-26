'use client';

import { useEffect, type FocusEventHandler, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CatalogKind } from '@/lib/pkmn/catalog-index';
import { GAP, estimateRowSize, type Density, type GridRow, type Position } from '@/lib/ruleset-studio/editor/picker/layout';
import type { HeaderItem } from '@/lib/ruleset-studio/editor/picker/view';

interface EntryListProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  rows: readonly GridRow[];
  positions: readonly Position[];
  columns: number;
  kind: CatalogKind;
  density: Exclude<Density, 'table'>;
  /** The keyboard's active entry (flat index); its row is scrolled into view. */
  activeIndex: number;
  listId: string;
  label: string;
  /** DOM id of the active option, for aria-activedescendant. */
  activeOptionId: string | undefined;
  onKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onFocus: FocusEventHandler<HTMLDivElement>;
  onBlur: FocusEventHandler<HTMLDivElement>;
  renderCell: (entryIndex: number) => ReactNode;
  renderHeader: (header: HeaderItem) => ReactNode;
}

/**
 * The virtualized listbox. One scroll container is the listbox (`role="listbox"`, focusable, `aria-activedescendant` names
 * the active option, which may be unmounted while it scrolls), inside it rows are positioned absolutely and only the rows
 * near the viewport exist (`@tanstack/react-virtual`, overscan 6). A row is a group header or up to `columns` entries laid
 * out in a grid. Row heights are fixed per kind and density, so no measuring is needed.
 */
export default function EntryList({
  scrollRef,
  rows,
  positions,
  columns,
  kind,
  density,
  activeIndex,
  listId,
  label,
  activeOptionId,
  onKeyDown,
  onFocus,
  onBlur,
  renderCell,
  renderHeader,
}: EntryListProps) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateRowSize(rows[index], kind, density),
    overscan: 6,
    // Before the container is measured (the server render, the first paint) assume a screenful.
    initialRect: { width: 0, height: 720 },
    getItemKey: (index) => {
      const row = rows[index];
      return row.kind === 'header' ? row.header.key : `cells:${row.start}`;
    },
  });

  const activeRow = positions[activeIndex]?.row;
  useEffect(() => {
    if (activeRow !== undefined) virtualizer.scrollToIndex(activeRow, { align: 'auto' });
    // The virtualizer object is stable for the life of the list; the row decides when to scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow]);

  return (
    <div
      ref={scrollRef}
      id={listId}
      role="listbox"
      aria-label={label}
      aria-multiselectable="true"
      aria-activedescendant={activeOptionId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      className="relative h-[min(62vh,44rem)] min-h-[20rem] overflow-y-auto overscroll-contain rounded-poke-md border border-poke-border bg-poke-base p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-poke-focus"
    >
      <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={item.key}
              role="presentation"
              className="absolute left-0 top-0 w-full"
              style={{ height: item.size - GAP, transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'header' ? (
                renderHeader(row.header)
              ) : (
                <div
                  role="presentation"
                  className="grid h-full gap-2"
                  style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: 'minmax(0, 1fr)' }}
                >
                  {Array.from({ length: row.count }, (_, col) => (
                    <div key={row.start + col} role="presentation" className="h-full min-w-0">
                      {renderCell(row.start + col)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
