'use client';

/**
 * The roster wall (draft-frontend §5.5 `RosterWall`, §5.9, SPEC:196-215): every line of the active price
 * tab as a slanted card, in the finder's order.
 *
 * - `role="listbox"` with roving focus: arrow keys move by geometry, Home/End jump, Enter/Space pin,
 *   `f` favourites, `c` toggles the comparison. **Click and Enter never pick** (SPEC:480-497).
 * - The tab stop is the keyboard cursor, else the pinned card, else the first card: a pinned card hidden by
 *   a filter or tab does not trap focus (draft-ui-gaps §2.1 1.1f).
 * - Hover details: `onHover(lineId, anchor)` fires at once on mouse enter and on keyboard focus; the caller
 *   (or `HoverDetails`' own delay) applies the hover intent. Touch (`hover: none`) never opens them.
 * - While the search index loads (`rows === null`) the wall shows the catalog in list order.
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { nextIndexForKey, type GridTile } from '@/components/draft-tool/grid-nav';
import { useDataLocale, useT } from '@/i18n/client';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';
import { draftSharedMessages } from '@/i18n/messages/draft/shared';
import type { FinderResult } from '@/lib/draft-finder/engine';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '@/lib/draft-finder/line-catalog';
import { pkmnNameResolver, type NameResolver } from '@/lib/draft-finder/names-port';
import { reasonText } from '@/lib/draft-ui/reasons';
import { cardStateOf, LINE_LEVEL_REASONS, type DraftViewModel } from '@/lib/draft-ui/snapshot-adapter';
import type { LineId, ReasonDTO } from '@/lib/draft-ui/snapshot-types';
import { cn } from '@/lib/utils/cn';
import RosterCard from './RosterCard';
import { rovingTabStop, wallKeyAction } from './wall-nav';

export interface RosterWallProps {
  /** The finder's rows of the active tab; null while the search index loads (catalog order is shown). */
  rows: FinderResult['rows'] | null;
  catalog: DraftLineCatalog;
  /** null before the first snapshot: every card renders as available. */
  vm: DraftViewModel | null;
  favorites: ReadonlySet<LineId>;
  pinnedLineId: LineId | null;
  compareIds: readonly LineId[];
  onPin(lineId: LineId): void;
  onToggleFavorite(lineId: LineId): void;
  onToggleCompare(lineId: LineId): void;
  onHover(lineId: LineId | null, anchor: HTMLElement | null): void;
  /** Verdicts that grey the cards; admin pick-on-behalf passes `vm.viewer.activePlayerLineStatus`. */
  lineStatus?: Record<LineId, ReasonDTO>;
  /** Rendered instead of the grid when no row matches (the active chips and "Clear all"). */
  empty?: ReactNode;
  names?: NameResolver;
  id?: string;
  className?: string;
}

const HINT_ID = 'draft-wall-keyboard-hint';

function hoverCapable(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(hover: none)').matches;
}

export default function RosterWall({
  rows,
  catalog,
  vm,
  favorites,
  pinnedLineId,
  compareIds,
  onPin,
  onToggleFavorite,
  onToggleCompare,
  onHover,
  lineStatus,
  empty,
  names = pkmnNameResolver,
  id = 'draft-roster-wall',
  className,
}: RosterWallProps) {
  const t = useT(draftFinderMessages);
  const ts = useT(draftSharedMessages);
  const dl = useDataLocale();
  const cardRefs = useRef(new Map<LineId, HTMLDivElement>());
  const [cursorId, setCursorId] = useState<LineId | null>(null);

  const entries = useMemo(() => {
    const byId = new Map<LineId, DraftLineCatalogEntry>(catalog.lines.map((l) => [l.lineId, l]));
    const ids = rows ? rows.map((r) => r.lineId) : catalog.lines.map((l) => l.lineId);
    return ids.map((lineId) => byId.get(lineId)).filter((e): e is DraftLineCatalogEntry => e !== undefined);
  }, [rows, catalog]);

  const visibleIds = useMemo(() => entries.map((e) => e.lineId), [entries]);
  const tabStop = rovingTabStop(visibleIds, cursorId, pinnedLineId);
  const statuses = lineStatus ?? vm?.viewer.lineStatus ?? {};
  const compare = useMemo(() => new Set(compareIds), [compareIds]);

  const focusCard = useCallback((lineId: LineId) => {
    setCursorId(lineId);
    cardRefs.current.get(lineId)?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const action = wallKeyAction(event.key, { ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey });
      if (action === null) return;
      const current = tabStop;
      if (current === null) return;
      event.preventDefault();
      switch (action) {
        case 'navigate': {
          const tiles: GridTile[] = visibleIds.flatMap((lineId) => {
            const el = cardRefs.current.get(lineId);
            return el ? [{ id: lineId, top: el.offsetTop, left: el.offsetLeft }] : [];
          });
          // -1: no tiles measured. At an edge the walk returns the same card: no move.
          // An unknown cursor starts from the first card.
          const i = nextIndexForKey(tiles, current, event.key);
          const next = i === -1 ? null : tiles[i].id;
          if (next !== null && next !== current) focusCard(next);
          break;
        }
        case 'pin':
          onPin(current);
          break;
        case 'favorite':
          onToggleFavorite(current);
          break;
        case 'compare':
          onToggleCompare(current);
          break;
      }
    },
    [tabStop, visibleIds, focusCard, onPin, onToggleFavorite, onToggleCompare],
  );

  if (entries.length === 0) {
    return (
      <div id={id} className={cn('p-4 text-sm text-[var(--draft-ink-2,var(--poke-text-secondary))]', className)}>
        {empty ?? t('empty')}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <p id={HINT_ID} className="sr-only">
        {t('wall.keyboardHint')}
      </p>
      <div
        id={id}
        role="listbox"
        aria-label={t('wall.label')}
        aria-describedby={HINT_ID}
        onKeyDown={handleKeyDown}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHover(null, null);
        }}
        className="grid gap-x-3 gap-y-2 px-3 py-2 [grid-template-columns:repeat(auto-fill,minmax(84px,1fr))] lg:[grid-template-columns:repeat(auto-fill,minmax(104px,1fr))]"
      >
        {entries.map((entry) => {
          const state = vm ? cardStateOf(vm, entry.lineId, statuses) : 'available';
          const reason = statuses[entry.lineId];
          const blockedReason =
            state === 'blocked' && vm && reason && LINE_LEVEL_REASONS.has(reason.code) ? reasonText(ts, reason, vm) : null;
          const owner = vm?.takenBy[entry.lineId];
          return (
            <RosterCard
              key={entry.lineId}
              cardRef={(el: HTMLDivElement | null) => {
                if (el) cardRefs.current.set(entry.lineId, el);
                else cardRefs.current.delete(entry.lineId);
              }}
              entry={entry}
              state={state}
              ownerName={owner?.name ? owner.name : null}
              isPinned={pinnedLineId === entry.lineId}
              isFavorite={favorites.has(entry.lineId)}
              inCompare={compare.has(entry.lineId)}
              reasonText={blockedReason}
              names={names}
              dl={dl}
              tabIndex={tabStop === entry.lineId ? 0 : -1}
              onSelect={() => {
                setCursorId(entry.lineId);
                onPin(entry.lineId);
              }}
              onToggleFavorite={() => onToggleFavorite(entry.lineId)}
              onFocus={(el) => {
                setCursorId(entry.lineId);
                if (hoverCapable()) onHover(entry.lineId, el);
              }}
              onHoverStart={(el) => onHover(entry.lineId, el)}
              onHoverEnd={() => onHover(null, null)}
            />
          );
        })}
      </div>
    </div>
  );
}
