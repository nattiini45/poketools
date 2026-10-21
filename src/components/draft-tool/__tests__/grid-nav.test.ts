import { describe, expect, it } from 'vitest';
import { nextIndexForKey, type GridTile } from '../grid-nav';

// Two rows of three, one row of two (skewed: sub-pixel top offsets within a row):  a b c / d e f / g h
const TILES: GridTile[] = [
  { id: 'h', top: 200.4, left: 100 },
  { id: 'a', top: 0, left: 0 },
  { id: 'b', top: 0.6, left: 100 },
  { id: 'c', top: 0, left: 200 },
  { id: 'd', top: 100, left: 0 },
  { id: 'e', top: 100, left: 100 },
  { id: 'f', top: 100, left: 200 },
  { id: 'g', top: 200, left: 0 },
];

const next = (current: string | null, key: string) => {
  const i = nextIndexForKey(TILES, current, key);
  return i === -1 ? null : TILES[i].id;
};

describe('nextIndexForKey', () => {
  it('moves left/right in reading order and clamps at the ends', () => {
    expect(next('b', 'ArrowRight')).toBe('c');
    expect(next('c', 'ArrowRight')).toBe('d');
    expect(next('a', 'ArrowLeft')).toBe('a');
    expect(next('h', 'ArrowRight')).toBe('h');
  });

  it('keeps the column on up/down, clamping to a shorter row, and stays at the edge', () => {
    expect(next('b', 'ArrowDown')).toBe('e');
    expect(next('f', 'ArrowDown')).toBe('h');
    expect(next('e', 'ArrowUp')).toBe('b');
    expect(next('b', 'ArrowUp')).toBe('b');
    expect(next('g', 'ArrowDown')).toBe('g');
  });

  it('jumps with Home/End', () => {
    expect(next('e', 'Home')).toBe('a');
    expect(next('a', 'End')).toBe('h');
  });

  it('starts from the first tile when the current one is hidden or unset', () => {
    expect(next('zz', 'ArrowDown')).toBe('a');
    expect(next(null, 'ArrowRight')).toBe('a');
    expect(next(null, 'End')).toBe('h');
  });

  it('returns -1 for other keys or without tiles', () => {
    expect(nextIndexForKey(TILES, 'a', 'Enter')).toBe(-1);
    expect(nextIndexForKey([], 'a', 'ArrowDown')).toBe(-1);
    expect(nextIndexForKey([], 'a', 'ArrowRight')).toBe(-1);
    expect(nextIndexForKey([], null, 'Home')).toBe(-1);
  });

  // Edge cases carried over from the retired `right/wall-nav.ts` walk (`nextIdForKey`), whose "null at an
  // edge" is "the same tile" here: the roster wall treats that as no move.
  describe('roster-wall edge cases', () => {
    // The same wall with exact integer row tops.
    const FLAT: GridTile[] = TILES.map((t) => ({ ...t, top: Math.floor(t.top) }));
    const flat = (current: string | null, key: string) => {
      const i = nextIndexForKey(FLAT, current, key);
      return i === -1 ? null : FLAT[i].id;
    };

    it('stays on the tile when there is no row in that direction', () => {
      expect(next('a', 'ArrowUp')).toBe('a');
      expect(next('c', 'ArrowUp')).toBe('c');
      expect(next('h', 'ArrowDown')).toBe('h');
      expect(flat('a', 'ArrowUp')).toBe('a');
      expect(flat('g', 'ArrowDown')).toBe('g');
    });

    it('walks left/right across row breaks in reading order', () => {
      expect(next('d', 'ArrowLeft')).toBe('c');
      expect(next('f', 'ArrowRight')).toBe('g');
      expect(flat('c', 'ArrowRight')).toBe('d');
      expect(flat('h', 'ArrowRight')).toBe('h');
    });

    it('keeps the column on up/down with exact row tops, clamping to the short last row', () => {
      expect(flat('b', 'ArrowDown')).toBe('e');
      expect(flat('f', 'ArrowDown')).toBe('h');
      expect(flat('e', 'ArrowUp')).toBe('b');
      expect(flat('h', 'ArrowUp')).toBe('e');
    });

    it('jumps with Home/End from anywhere, including an unknown cursor', () => {
      expect(flat('e', 'Home')).toBe('a');
      expect(flat('e', 'End')).toBe('h');
      expect(flat('gone', 'Home')).toBe('a');
      expect(flat('gone', 'End')).toBe('h');
    });

    it('moves an unknown (hidden) cursor to the first tile on any arrow', () => {
      expect(flat('gone', 'ArrowRight')).toBe('a');
      expect(flat('gone', 'ArrowLeft')).toBe('a');
      expect(flat('gone', 'ArrowUp')).toBe('a');
    });

    it('returns an index into the tiles as passed, not the sorted order', () => {
      expect(nextIndexForKey(FLAT, 'f', 'ArrowDown')).toBe(0);
      expect(nextIndexForKey(FLAT, 'b', 'ArrowLeft')).toBe(1);
    });

    it('handles a single tile', () => {
      const one: GridTile[] = [{ id: 'x', top: 0, left: 0 }];
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        expect(nextIndexForKey(one, 'x', key)).toBe(0);
      }
    });
  });
});
