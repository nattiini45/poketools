import { describe, expect, it } from 'vitest';
import { GRID_NAV_KEYS } from '../../grid-nav';
import { rovingTabStop, wallKeyAction } from '../wall-nav';

// The geometry walk's edge cases (clamping, no row in a direction, unknown cursor, empty wall) are covered
// against `nextIndexForKey` in `../../__tests__/grid-nav.test.ts`, the single grid walk the wall uses.

describe('wallKeyAction', () => {
  it('navigates on every grid key (arrows, Home, End) and on nothing else', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(GRID_NAV_KEYS.has(key)).toBe(true);
      expect(wallKeyAction(key)).toBe('navigate');
    }
    expect(wallKeyAction('PageDown')).toBeNull();
    expect(wallKeyAction('Tab')).toBeNull();
  });

  it('leaves modified navigation keys to the browser', () => {
    expect(wallKeyAction('ArrowRight', { ctrl: true })).toBeNull();
    expect(wallKeyAction('Home', { meta: true })).toBeNull();
  });

  it('maps Enter/Space to pin (never pick), f to favourite, c to compare', () => {
    expect(wallKeyAction('Enter')).toBe('pin');
    expect(wallKeyAction(' ')).toBe('pin');
    expect(wallKeyAction('f')).toBe('favorite');
    expect(wallKeyAction('F')).toBe('favorite');
    expect(wallKeyAction('c')).toBe('compare');
    expect(wallKeyAction('ArrowDown')).toBe('navigate');
    expect(wallKeyAction('x')).toBeNull();
  });

  it('leaves modified presses to the browser (Ctrl+C, Cmd+F)', () => {
    expect(wallKeyAction('c', { ctrl: true })).toBeNull();
    expect(wallKeyAction('f', { meta: true })).toBeNull();
    expect(wallKeyAction('Enter', { alt: true })).toBeNull();
  });
});

describe('rovingTabStop', () => {
  const visible = ['a', 'b', 'c'];
  it('prefers the keyboard cursor, then the pinned card', () => {
    expect(rovingTabStop(visible, 'b', 'c')).toBe('b');
    expect(rovingTabStop(visible, null, 'c')).toBe('c');
  });

  it('falls back to the first card when the pinned card is hidden', () => {
    expect(rovingTabStop(visible, 'gone', 'hidden')).toBe('a');
    expect(rovingTabStop([], null, 'hidden')).toBeNull();
  });
});
