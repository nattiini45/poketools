import { describe, expect, it } from 'vitest';
import { isStationAnchor } from '../useScrollConductor';

/**
 * Deep-link landing on load: the conductor lands a fragment that is a station
 * or an anchor inside one (the rules link's Lite exit is a full load to
 * `#league-hub`, inside Puls); any other anchor stays the browser's.
 */
type Node = { id: string; parentElement: Node | null };

function chain(...ids: string[]): Node {
  // Outermost first; returns the innermost node.
  let parent: Node | null = null;
  for (const id of ids) parent = { id, parentElement: parent };
  if (!parent) throw new Error('empty chain');
  return parent;
}

const STATIONS = ['pulse', 'schedule', 'rules'];

describe('isStationAnchor', () => {
  it('accepts a station section itself', () => {
    expect(isStationAnchor(chain('world', 'schedule') as unknown as Element, STATIONS)).toBe(true);
  });

  it('accepts an anchor inside a station (the hub inside Puls)', () => {
    expect(isStationAnchor(chain('world', 'pulse', '', 'league-hub') as unknown as Element, STATIONS)).toBe(true);
  });

  it('rejects an anchor outside every station', () => {
    expect(isStationAnchor(chain('footer', 'imprint') as unknown as Element, STATIONS)).toBe(false);
  });
});
