/**
 * Unsaved input on the league admin page (`/admin/leagues/[id]?tab=`).
 *
 * Every tab is a link, so a tab switch is a navigation and the open panel's forms unmount. A form that holds
 * input not yet saved marks itself with `data-unsaved="true"` (`unsavedMarker(dirty)`) and clears the marker
 * once the input is saved or discarded. While any element inside the panel region carries the marker,
 * `UnsavedTabGuard` asks before a tab switch (and the browser asks before a reload or close).
 *
 * Opt-in on purpose: only the form knows when its input is saved (a DOM-level "something was typed" guard
 * would also fire after a successful save).
 *
 * Pure and client-safe: no reads, no React.
 */

/** The marker attribute and the selector the guard looks for. */
export const UNSAVED_ATTRIBUTE = 'data-unsaved';
export const UNSAVED_SELECTOR = `[${UNSAVED_ATTRIBUTE}="true"]`;

/** Spread onto a form's root: `<form {...unsavedMarker(dirty)}>`. Nothing at all while clean. */
export function unsavedMarker(dirty: boolean): { 'data-unsaved'?: 'true' } {
  return dirty ? { [UNSAVED_ATTRIBUTE]: 'true' } : {};
}

/** Does the region (the tab panel) hold a form with unsaved input? A missing region holds none. */
export function hasUnsavedInput(region: Pick<ParentNode, 'querySelector'> | null): boolean {
  return region?.querySelector(UNSAVED_SELECTOR) != null;
}

export interface TabSwitchClick {
  /** The panel holds unsaved input (`hasUnsavedInput`). */
  unsaved: boolean;
  /** The clicked link is the tab that is already open (`aria-current="page"`). */
  activeTab: boolean;
  /** Ctrl/Cmd/Shift/Alt or a non-primary button: the browser opens a new tab or window, this page stays. */
  newContext: boolean;
}

/** Ask before following the tab link? Only when the switch would really unmount unsaved input. */
export function shouldConfirmTabSwitch({ unsaved, activeTab, newContext }: TabSwitchClick): boolean {
  return unsaved && !activeTab && !newContext;
}
