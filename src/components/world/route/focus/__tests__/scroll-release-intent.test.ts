import { afterEach, describe, expect, it } from 'vitest';
import { focusStore, SCROLL_RELEASE_INTENT_MS, scrollIntentFresh } from '../focus-store';
import type { FocusSubject } from '@/lib/route-world/focus';

/**
 * Wave 2 r3 (W1): the conductor's programmatic re-anchor at route handoff
 * (`onLayoutMutation` → `scrollTo`) fires a scroll event with no visitor
 * input. It must not release a deep-linked focus (`?board=roster` etc.);
 * a scroll after a wheel / touch / key / pointer intent still does.
 */

const roster: FocusSubject = {
  id: 'board:roster',
  kind: 'board',
  label: 'roster',
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  facing: [0, 0, 1],
  panel: { param: 'board', value: 'roster' },
};

let unregister: (() => void) | null = null;

function focusRoster(): void {
  unregister = focusStore.register(roster);
  focusStore.focus(roster);
  focusStore.settle();
}

afterEach(() => {
  focusStore.release();
  focusStore.clear();
  unregister?.();
  unregister = null;
});

describe('scroll release intent gate', () => {
  it('a programmatic re-anchor with no recorded intent does not release', () => {
    focusRoster();
    // Intent far in the past (or never): the re-anchor scroll is not a step-out.
    focusStore.noteInputIntent(0);
    expect(focusStore.releaseForScroll(10_000)).toBe(false);
    expect(focusStore.get().phase).toBe('focused');
    expect(focusStore.get().subject?.panel).toEqual({ param: 'board', value: 'roster' });
  });

  it('a scroll within the intent window releases', () => {
    focusRoster();
    focusStore.noteInputIntent(20_000);
    expect(focusStore.releaseForScroll(20_000 + SCROLL_RELEASE_INTENT_MS - 1)).toBe(true);
    expect(focusStore.get().phase).toBe('releasing');
  });

  it('an intent older than the window does not release', () => {
    focusRoster();
    focusStore.noteInputIntent(30_000);
    expect(focusStore.releaseForScroll(30_000 + SCROLL_RELEASE_INTENT_MS + 1)).toBe(false);
    expect(focusStore.get().phase).toBe('focused');
  });

  it('the pure gate bounds the window on both sides', () => {
    expect(scrollIntentFresh(Number.NEGATIVE_INFINITY, 1000)).toBe(false);
    expect(scrollIntentFresh(1000, 1000)).toBe(true);
    expect(scrollIntentFresh(1000, 1000 + SCROLL_RELEASE_INTENT_MS)).toBe(true);
    expect(scrollIntentFresh(1000, 999)).toBe(false);
  });
});
