/**
 * Own-property membership check for the URL-keyed overlay records
 * (`OverlaySwitch`'s `contents` / `titles`).
 *
 * Those records are keyed by whatever value a search param carries
 * (`?rules=…`, `?team=…`) — untrusted input. The `in` operator (and a naive
 * `record[key]` read) also matches prototype-chain keys, so a crafted param
 * like `?rules=constructor`, `?rules=toString` or `?rules=__proto__` would
 * pass the membership check and hand React a function as a child — a client
 * render crash from a shareable URL (PR #63 review, critical). Only a
 * registered OWN key may open an overlay.
 *
 * Extracted as a pure module so the guard is regression-testable without a
 * DOM (the vitest suite runs in the node environment).
 */
export function hasOverlayKey(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

/**
 * Fidelity wave 2 (2D): the `board` param value that opens the full roster
 * list panel (`?board=roster`, RosterListPanel) in every world — no new URL
 * param, one more own key on the existing `board` OverlaySwitch. The single
 * source for the overlay maps (EvoligaOverlays, ThemeOverlays), the roster
 * tap targets (plaza kiosk, sakura wall, mountain lodge) and the Station
 * Card CTA, so the value a subject writes is always one a map answers.
 */
export const ROSTER_BOARD_VALUE = 'roster';
