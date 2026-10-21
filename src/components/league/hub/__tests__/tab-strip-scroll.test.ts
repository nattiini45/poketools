/**
 * HubTabStripScroll's offset maths: on a phone the hub's tab strip scrolls
 * sideways, and an active tab past the right edge (the Rules tab after a
 * "Zum Regeln-Tab" landing) must be scrolled into view. The strip scrolls,
 * never the page, so the maths is all there is to it.
 */
import { describe, expect, it } from 'vitest';
import { tabStripScrollLeft } from '../HubTabStripScroll';

// A 360 px strip starting 16 px from the viewport edge (the page gutter).
const STRIP = { left: 16, width: 360, scrollLeft: 0 };

describe('tabStripScrollLeft', () => {
  it('leaves the strip alone when the active tab is fully visible', () => {
    expect(tabStripScrollLeft(STRIP, { left: 16, width: 90 })).toBeNull();
    expect(tabStripScrollLeft(STRIP, { left: 286, width: 90 })).toBeNull();
  });

  it('centres a tab past the right edge', () => {
    // The tab starts 500 px into the strip's content: centred, the strip
    // scrolls to 500 - (360 - 80) / 2 = 360.
    expect(tabStripScrollLeft(STRIP, { left: 516, width: 80 })).toBe(360);
  });

  it('centres a tab cut off at the right edge', () => {
    expect(tabStripScrollLeft(STRIP, { left: 330, width: 80 })).toBe(174);
  });

  it('counts the current scroll offset and scrolls back for a tab past the left edge', () => {
    const scrolled = { ...STRIP, scrollLeft: 400 };
    // On screen 40 px left of the strip: 360 px into the content.
    expect(tabStripScrollLeft(scrolled, { left: -24, width: 80 })).toBe(220);
  });

  it('never scrolls before the start', () => {
    const scrolled = { ...STRIP, scrollLeft: 50 };
    expect(tabStripScrollLeft(scrolled, { left: -20, width: 80 })).toBe(0);
  });
});
