/**
 * D33 — the site NavBar stays reachable inside the 3D world. Pure state
 * machine behind `RouteNavReveal` (no DOM, no timers: every transition takes
 * `now` in wall-clock ms and the host schedules one wake at `navRevealWakeAt`).
 *
 * While the world is the page (`html.world-route-live`, and from handoff
 * phase 1) the NavBar keeps its sticky flow slot but is slid out of view. It
 * is revealed by:
 * - a FINE pointer that rests within `edgePx` of the viewport top for
 *   `dwellMs` (a pointer passing through toward the browser tabs never opens
 *   it); it then stays open while the pointer is over the bar or within
 *   `bufferPx` below it, and slides away `closeDelayMs` after it left;
 * - keyboard focus inside the bar (Tab from the page start reaches it);
 * - the WorldNav HUD's menu chip (coarse pointers / touch have no hover): it
 *   stays open until the chip is tapped again, a tap lands outside the bar,
 *   Esc, or a station chip is chosen.
 *
 * Esc closes it at once from every source; while the pointer is still in the
 * reveal zone after an Esc the dwell is suppressed until it leaves the zone
 * (otherwise the resting pointer would re-open it 120 ms later).
 */

export const NAV_REVEAL = {
  /** The reveal zone: this close to the viewport top (CSS px). */
  edgePx: 24,
  /** How long the pointer must rest in the zone before the bar opens. */
  dwellMs: 120,
  /** Below the open bar's bottom edge, the pointer still counts as "on the bar". */
  bufferPx: 16,
  /** After the pointer (or focus) left, the bar slides away this much later. */
  closeDelayMs: 400,
} as const;

export type NavRevealSource = 'pointer' | 'focus' | 'chip';

export interface NavRevealState {
  open: boolean;
  /** What opened it (null while closed). */
  source: NavRevealSource | null;
  /** A pointer rests in the reveal zone since (closed bar only); null = not dwelling. */
  dwellSince: number | null;
  /** The pointer / focus left an open bar at; the bar closes `closeDelayMs` later. */
  leaveSince: number | null;
  /** The pointer is over the open bar or inside its buffer. */
  pointerInside: boolean;
  /** Keyboard focus is inside the bar. */
  focusInside: boolean;
  /** The HUD menu chip holds the bar open (until tapped again / outside / Esc / station). */
  chipHeld: boolean;
  /** After an Esc with the pointer in the zone: no dwell until the pointer leaves the zone. */
  suppressed: boolean;
}

export const NAV_REVEAL_CLOSED: NavRevealState = {
  open: false,
  source: null,
  dwellSince: null,
  leaveSince: null,
  pointerInside: false,
  focusInside: false,
  chipHeld: false,
  suppressed: false,
};

export type NavRevealEvent =
  /**
   * A fine-pointer move (mouse / pen). `y` is the pointer's viewport y;
   * `barBottom` the open bar's bottom edge in viewport px (its height).
   */
  | { type: 'pointer'; now: number; y: number; barBottom: number }
  /** The pointer left the document (toward the browser chrome, or another window). */
  | { type: 'pointer-exit'; now: number }
  | { type: 'focus-in'; now: number }
  | { type: 'focus-out'; now: number }
  | { type: 'escape'; now: number }
  /** The HUD menu chip was activated (toggle). */
  | { type: 'chip'; now: number }
  /** A press landed outside the bar, its drawer and the chip. */
  | { type: 'outside'; now: number }
  /** A station chip was chosen in the HUD. */
  | { type: 'station'; now: number }
  /** A scheduled wake (dwell or close delay due). */
  | { type: 'tick'; now: number }
  /** The world is not the page (any more): everything resets, closed. */
  | { type: 'reset' };

function close(state: NavRevealState, keep: Partial<NavRevealState> = {}): NavRevealState {
  return {
    ...state,
    open: false,
    source: null,
    dwellSince: null,
    leaveSince: null,
    chipHeld: false,
    ...keep,
  };
}

function openAs(state: NavRevealState, source: NavRevealSource): NavRevealState {
  return {
    ...state,
    open: true,
    source: state.open && state.source !== null ? state.source : source,
    dwellSince: null,
    leaveSince: null,
  };
}

/** Anything still holding the open bar (the close delay only runs when nothing does). */
function held(state: NavRevealState): boolean {
  return state.pointerInside || state.focusInside || state.chipHeld;
}

/** One step. Returns `state` itself when nothing changed (a React setter bails out). */
export function stepNavReveal(state: NavRevealState, event: NavRevealEvent): NavRevealState {
  switch (event.type) {
    case 'reset':
      return state === NAV_REVEAL_CLOSED ? state : NAV_REVEAL_CLOSED;

    case 'pointer': {
      const inZone = event.y <= NAV_REVEAL.edgePx;
      const onBar = state.open && event.y <= Math.max(event.barBottom, NAV_REVEAL.edgePx) + NAV_REVEAL.bufferPx;
      if (state.suppressed) {
        if (inZone || onBar) return state;
        return { ...state, suppressed: false, pointerInside: false };
      }
      if (!state.open) {
        if (inZone) return state.dwellSince === null ? { ...state, dwellSince: event.now } : state;
        return state.dwellSince === null ? state : { ...state, dwellSince: null };
      }
      if (onBar) {
        if (state.pointerInside && state.leaveSince === null) return state;
        return { ...state, pointerInside: true, leaveSince: null };
      }
      if (!state.pointerInside && state.leaveSince !== null) return state;
      const next = { ...state, pointerInside: false };
      return held(next) ? next : { ...next, leaveSince: state.leaveSince ?? event.now };
    }

    case 'pointer-exit': {
      if (!state.open) {
        // Passing through toward the tabs: the dwell never completes.
        if (state.dwellSince === null && !state.suppressed) return state;
        return { ...state, dwellSince: null, suppressed: false };
      }
      const next = { ...state, pointerInside: false, suppressed: false };
      return held(next) ? next : { ...next, leaveSince: state.leaveSince ?? event.now };
    }

    case 'focus-in': {
      if (state.open && state.focusInside) return state;
      return openAs({ ...state, focusInside: true, suppressed: false }, 'focus');
    }

    case 'focus-out': {
      if (!state.focusInside) return state;
      const next = { ...state, focusInside: false };
      if (!next.open) return next;
      return held(next) ? next : { ...next, leaveSince: event.now };
    }

    case 'escape': {
      if (!state.open && state.dwellSince === null) return state;
      // The resting pointer must leave the zone before the dwell can re-open it.
      return close(state, { pointerInside: false, focusInside: false, suppressed: true });
    }

    case 'chip': {
      if (state.open && state.chipHeld) return close(state, { suppressed: false });
      return openAs({ ...state, chipHeld: true, suppressed: false }, 'chip');
    }

    case 'outside':
    case 'station': {
      if (!state.open) return state;
      // A press outside while keyboard focus is still inside (focus moves on
      // the press's own focus event) closes too: the visitor went elsewhere.
      return close(state, { pointerInside: false, focusInside: false });
    }

    case 'tick': {
      if (!state.open) {
        if (state.dwellSince !== null && !state.suppressed && event.now - state.dwellSince >= NAV_REVEAL.dwellMs) {
          // The dwell only runs while the last pointer read was in the zone.
          return openAs({ ...state, pointerInside: true }, 'pointer');
        }
        return state;
      }
      if (state.leaveSince !== null && !held(state) && event.now - state.leaveSince >= NAV_REVEAL.closeDelayMs) {
        return close(state);
      }
      return state;
    }
  }
}

/** The wall-clock time of the next pending transition, or null when only an event can move the state. */
export function navRevealWakeAt(state: NavRevealState): number | null {
  if (!state.open) {
    return state.dwellSince !== null && !state.suppressed ? state.dwellSince + NAV_REVEAL.dwellMs : null;
  }
  return state.leaveSince !== null && !held(state) ? state.leaveSince + NAV_REVEAL.closeDelayMs : null;
}

/**
 * Where focus goes when Esc (or the chip) closes the bar while focus is inside
 * it: back where the visitor came from, else the HUD's current station chip,
 * else the menu chip, else nowhere (the document). Pure over the candidates'
 * availability so the host only supplies which ones are still focusable.
 */
export type NavFocusReturn = 'previous' | 'station-chip' | 'menu-chip' | 'none';

export function navFocusReturn(input: {
  source: NavRevealSource | null;
  previousFocusable: boolean;
  stationChipFocusable: boolean;
  menuChipFocusable: boolean;
}): NavFocusReturn {
  if (input.source === 'chip' && input.menuChipFocusable) return 'menu-chip';
  if (input.previousFocusable) return 'previous';
  if (input.stationChipFocusable) return 'station-chip';
  if (input.menuChipFocusable) return 'menu-chip';
  return 'none';
}
