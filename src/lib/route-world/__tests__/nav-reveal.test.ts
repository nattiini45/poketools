import { describe, expect, it } from 'vitest';
import {
  NAV_REVEAL,
  NAV_REVEAL_CLOSED,
  navFocusReturn,
  navRevealWakeAt,
  stepNavReveal,
  type NavRevealEvent,
  type NavRevealState,
} from '../nav-reveal';

const BAR = 73;

function run(events: NavRevealEvent[], from: NavRevealState = NAV_REVEAL_CLOSED): NavRevealState {
  return events.reduce(stepNavReveal, from);
}

/** Step, then fire the scheduled wake if it is due by `until`. */
function settle(state: NavRevealState, until: number): NavRevealState {
  let current = state;
  for (let guard = 0; guard < 8; guard += 1) {
    const at = navRevealWakeAt(current);
    if (at === null || at > until) return current;
    current = stepNavReveal(current, { type: 'tick', now: at });
  }
  return current;
}

const move = (now: number, y: number): NavRevealEvent => ({ type: 'pointer', now, y, barBottom: BAR });

describe('D33 nav reveal — fine pointer dwell', () => {
  it('opens only after the pointer rests in the top zone for the dwell', () => {
    let s = run([move(0, 400), move(10, NAV_REVEAL.edgePx)]);
    expect(s.open).toBe(false);
    expect(navRevealWakeAt(s)).toBe(10 + NAV_REVEAL.dwellMs);
    s = stepNavReveal(s, { type: 'tick', now: 10 + NAV_REVEAL.dwellMs - 1 });
    expect(s.open).toBe(false);
    s = stepNavReveal(s, { type: 'tick', now: 10 + NAV_REVEAL.dwellMs });
    expect(s.open).toBe(true);
    expect(s.source).toBe('pointer');
    expect(s.pointerInside).toBe(true);
  });

  it('a pointer passing through toward the browser tabs never opens it', () => {
    // Enters the zone and leaves the document before the dwell completes.
    let s = run([move(0, 300), move(5, 12), { type: 'pointer-exit', now: 40 }]);
    expect(s.dwellSince).toBeNull();
    expect(navRevealWakeAt(s)).toBeNull();
    s = settle(s, 1000);
    expect(s.open).toBe(false);
    // Or moves back down out of the zone.
    s = settle(run([move(0, 10), move(60, 200)]), 1000);
    expect(s.open).toBe(false);
  });

  it('stays open over the bar and within the buffer, and closes ~0.4 s after the pointer leaves', () => {
    let s = settle(run([move(0, 5)]), 200);
    expect(s.open).toBe(true);
    s = run([move(300, BAR - 10), move(320, BAR + NAV_REVEAL.bufferPx)], s);
    expect(s.open).toBe(true);
    expect(navRevealWakeAt(s)).toBeNull();
    s = stepNavReveal(s, move(400, BAR + NAV_REVEAL.bufferPx + 1));
    expect(navRevealWakeAt(s)).toBe(400 + NAV_REVEAL.closeDelayMs);
    expect(settle(s, 400 + NAV_REVEAL.closeDelayMs - 1).open).toBe(true);
    expect(settle(s, 400 + NAV_REVEAL.closeDelayMs).open).toBe(false);
  });

  it('coming back onto the bar inside the close delay keeps it open', () => {
    let s = settle(run([move(0, 5)]), 200);
    s = run([move(300, 500), move(500, 30)], s);
    expect(s.leaveSince).toBeNull();
    expect(settle(s, 5000).open).toBe(true);
  });

  it('leaving the document from an open bar closes it after the delay', () => {
    let s = settle(run([move(0, 5)]), 200);
    s = stepNavReveal(s, { type: 'pointer-exit', now: 1000 });
    expect(settle(s, 1000 + NAV_REVEAL.closeDelayMs).open).toBe(false);
  });

  it('never re-renders on moves that change nothing (identity preserved)', () => {
    const s = run([move(0, 400)]);
    expect(stepNavReveal(s, move(10, 500))).toBe(s);
    const open = settle(run([move(0, 5)]), 200);
    const over = stepNavReveal(open, move(300, 20));
    expect(stepNavReveal(over, move(310, 30))).toBe(over);
  });

  it('a pointer over a panel hanging from the bar (the host reports y: 0) holds it open', () => {
    // RouteNavReveal maps any target inside #site-nav (e.g. the palette panel) to y: 0.
    let s = settle(run([move(0, 5)]), 200);
    s = stepNavReveal(s, move(300, 0));
    expect(s.open).toBe(true);
    expect(s.pointerInside).toBe(true);
    expect(navRevealWakeAt(s)).toBeNull();
    // A dip below the buffer arms the close; moving onto the panel disarms it.
    s = stepNavReveal(s, move(400, BAR + 250));
    expect(navRevealWakeAt(s)).toBe(400 + NAV_REVEAL.closeDelayMs);
    s = stepNavReveal(s, move(450, 0));
    expect(s.pointerInside).toBe(true);
    expect(s.leaveSince).toBeNull();
    expect(navRevealWakeAt(s)).toBeNull();
    expect(settle(s, 10_000).open).toBe(true);
  });
});

describe('D33 nav reveal — keyboard', () => {
  it('focus inside reveals it and holds it open against the pointer', () => {
    let s = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'focus-in', now: 0 });
    expect(s.open).toBe(true);
    expect(s.source).toBe('focus');
    s = run([move(100, 600)], s);
    expect(navRevealWakeAt(s)).toBeNull();
    expect(settle(s, 10_000).open).toBe(true);
  });

  it('focus leaving the bar closes it after the delay', () => {
    let s = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'focus-in', now: 0 });
    s = stepNavReveal(s, { type: 'focus-out', now: 50 });
    expect(settle(s, 50 + NAV_REVEAL.closeDelayMs).open).toBe(false);
  });

  it('Esc closes at once and suppresses the dwell until the pointer leaves the zone', () => {
    let s = settle(run([move(0, 5)]), 200);
    s = stepNavReveal(s, { type: 'escape', now: 300 });
    expect(s.open).toBe(false);
    expect(s.suppressed).toBe(true);
    // The resting pointer does not re-open it.
    s = run([move(320, 6), move(900, 3)], s);
    expect(settle(s, 5000).open).toBe(false);
    // Leaving the zone lifts the suppression; the next rest opens again.
    s = run([move(1000, 300), move(1100, 4)], s);
    expect(s.suppressed).toBe(false);
    expect(settle(s, 1100 + NAV_REVEAL.dwellMs).open).toBe(true);
  });

  it('Esc from keyboard focus clears the focus hold', () => {
    let s = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'focus-in', now: 0 });
    s = stepNavReveal(s, { type: 'escape', now: 10 });
    expect(s.open).toBe(false);
    expect(s.focusInside).toBe(false);
  });
});

describe('D33 nav reveal — coarse pointer chip', () => {
  it('the chip toggles the bar and holds it with no hover', () => {
    let s = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'chip', now: 0 });
    expect(s.open).toBe(true);
    expect(s.source).toBe('chip');
    expect(s.chipHeld).toBe(true);
    expect(navRevealWakeAt(s)).toBeNull();
    s = stepNavReveal(s, { type: 'chip', now: 100 });
    expect(s.open).toBe(false);
    expect(s.chipHeld).toBe(false);
  });

  it('a tap outside, Esc or a station chip closes it', () => {
    const open = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'chip', now: 0 });
    for (const type of ['outside', 'station', 'escape'] as const) {
      const s = stepNavReveal(open, { type, now: 10 });
      expect(s.open, type).toBe(false);
      expect(s.chipHeld, type).toBe(false);
    }
  });

  it('outside / station presses are no-ops while closed', () => {
    expect(stepNavReveal(NAV_REVEAL_CLOSED, { type: 'outside', now: 0 })).toBe(NAV_REVEAL_CLOSED);
    expect(stepNavReveal(NAV_REVEAL_CLOSED, { type: 'station', now: 0 })).toBe(NAV_REVEAL_CLOSED);
  });

  it('reset (the world is no longer the page) closes everything', () => {
    const open = stepNavReveal(NAV_REVEAL_CLOSED, { type: 'chip', now: 0 });
    expect(stepNavReveal(open, { type: 'reset' })).toBe(NAV_REVEAL_CLOSED);
  });
});

describe('D33 nav reveal — focus return', () => {
  it('returns focus to the chip for a chip-opened bar, else where the visitor came from', () => {
    const all = { previousFocusable: true, stationChipFocusable: true, menuChipFocusable: true };
    expect(navFocusReturn({ source: 'chip', ...all })).toBe('menu-chip');
    expect(navFocusReturn({ source: 'focus', ...all })).toBe('previous');
    expect(navFocusReturn({ source: 'focus', ...all, previousFocusable: false })).toBe('station-chip');
    expect(
      navFocusReturn({ source: 'pointer', previousFocusable: false, stationChipFocusable: false, menuChipFocusable: true }),
    ).toBe('menu-chip');
    expect(
      navFocusReturn({ source: 'focus', previousFocusable: false, stationChipFocusable: false, menuChipFocusable: false }),
    ).toBe('none');
  });
});
