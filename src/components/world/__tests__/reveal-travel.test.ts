import { describe, expect, it } from 'vitest';
import { startsAboveViewport } from '../Reveal';

/**
 * Bar W6 direction of travel, read once at mount: an item entirely above the
 * viewport drops in from above; anything else rises. Kilo PR #65: an element
 * with no box (mounted under `display: none`) reads an all-zero rect, whose
 * `bottom` of 0 must not count as "above the viewport".
 */

function element(rects: { top: number; bottom: number }[]): Pick<Element, 'getClientRects' | 'getBoundingClientRect'> {
  const first = rects[0] ?? { top: 0, bottom: 0 };
  return {
    getClientRects: () => rects as unknown as DOMRectList,
    getBoundingClientRect: () => ({ ...first, left: 0, right: 0, width: 0, height: first.bottom - first.top, x: 0, y: first.top, toJSON: () => ({}) }),
  };
}

describe('Reveal: the side an item enters from', () => {
  it('an item entirely above the viewport drops in from above', () => {
    expect(startsAboveViewport(element([{ top: -400, bottom: -20 }]))).toBe(true);
    // Ending exactly at the viewport's top edge is still entirely above it.
    expect(startsAboveViewport(element([{ top: -400, bottom: 0 }]))).toBe(true);
  });

  it('an item in or below the viewport rises', () => {
    expect(startsAboveViewport(element([{ top: -100, bottom: 40 }]))).toBe(false);
    expect(startsAboveViewport(element([{ top: 900, bottom: 1300 }]))).toBe(false);
  });

  it('an item with no box (display: none at mount) rises — its zero rect is not "above"', () => {
    expect(startsAboveViewport(element([]))).toBe(false);
  });
});
