/**
 * Roster-wall keyboard model (draft-frontend §5.5 `RosterWall`, §5.9). Pure.
 *
 * The 2-D geometry walk itself lives in `@/components/draft-tool/grid-nav` (`nextIndexForKey`, the one
 * grid walk of the draft tool); this module maps key presses to wall actions and picks the roving tab stop.
 */
import { GRID_NAV_KEYS } from '@/components/draft-tool/grid-nav';

export type WallKeyAction = 'pin' | 'favorite' | 'compare' | 'navigate' | null;

/**
 * What a key press on a focused card does. Arrows/Home/End navigate, Enter/Space pin (never pick:
 * SPEC:497), `f` favourites, `c` toggles the comparison; modified presses (Ctrl/Meta/Alt) are left to the
 * browser.
 */
export function wallKeyAction(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): WallKeyAction {
  if (mods.ctrl || mods.meta || mods.alt) return null;
  if (GRID_NAV_KEYS.has(key)) return 'navigate';
  if (key === 'Enter' || key === ' ' || key === 'Spacebar') return 'pin';
  if (key === 'f' || key === 'F') return 'favorite';
  if (key === 'c' || key === 'C') return 'compare';
  return null;
}

/**
 * The card that holds `tabIndex=0`: the keyboard cursor if it is visible, else the pinned card if visible,
 * else the first card (draft-ui-gaps §2.1 1.1f: a hidden pinned card must not trap the tab stop).
 */
export function rovingTabStop(
  visibleIds: readonly string[],
  cursorId: string | null,
  pinnedId: string | null,
): string | null {
  if (cursorId !== null && visibleIds.includes(cursorId)) return cursorId;
  if (pinnedId !== null && visibleIds.includes(pinnedId)) return pinnedId;
  return visibleIds[0] ?? null;
}
