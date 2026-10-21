import { describe, expect, it } from 'vitest';
import {
  CONTACT_BLOB_CAPACITY,
  CONTACT_BLOB_FADE_HEIGHT,
  layoutContactBlobs,
  type BlobFigure,
} from '../ContactBlobs';

function walker(i: number, extra: Partial<BlobFigure> = {}): BlobFigure {
  return { role: 'patrol', optOut: false, position: [i, 0, -i], footprint: 0.5, ...extra };
}

describe('ContactBlobs layout', () => {
  it('has a fixed capacity of 32 and never exceeds it', () => {
    expect(CONTACT_BLOB_CAPACITY).toBe(32);
    const many = Array.from({ length: 50 }, (_, i) => walker(i));
    const blobs = layoutContactBlobs(many);
    expect(blobs).toHaveLength(CONTACT_BLOB_CAPACITY);
    // Registration order wins, so the set is stable frame to frame.
    expect(blobs[0].x).toBe(0);
    expect(blobs[31].x).toBe(31);
  });

  it('count follows the live figures', () => {
    expect(layoutContactBlobs([])).toHaveLength(0);
    expect(layoutContactBlobs([walker(0), walker(1), walker(2)])).toHaveLength(3);
  });

  it('opts out floating, perched and swimming figures and explicit opt-outs', () => {
    const blobs = layoutContactBlobs([
      walker(0, { role: 'floating' }),
      walker(1, { role: 'perched' }),
      walker(2, { role: 'swimmer' }),
      walker(3, { optOut: true }),
      walker(4, { role: null }),
    ]);
    expect(blobs.map((b) => b.x)).toEqual([4]);
  });

  it('opted-out figures do not consume capacity', () => {
    const figures = [
      ...Array.from({ length: 10 }, (_, i) => walker(i, { role: 'floating' })),
      ...Array.from({ length: 40 }, (_, i) => walker(100 + i)),
    ];
    const blobs = layoutContactBlobs(figures);
    expect(blobs).toHaveLength(CONTACT_BLOB_CAPACITY);
    expect(blobs.every((b) => b.x >= 100)).toBe(true);
  });

  it('grounded figures sit their blob just above their feet at full strength', () => {
    const [blob] = layoutContactBlobs([walker(0, { position: [1, 0.9, 2], role: 'stationary' })]);
    expect(blob.y).toBeCloseTo(0.92, 6);
    expect(blob.fade).toBe(1);
  });

  it('fliers keep a ground blob that fades with height and vanishes at the fade height', () => {
    const low = layoutContactBlobs([walker(0, { role: 'airborne', position: [0, 0.5, 0] })])[0];
    const high = layoutContactBlobs([walker(0, { role: 'airborne', position: [0, 2, 0] })])[0];
    expect(low.y).toBeCloseTo(0.02, 6);
    expect(low.fade).toBeGreaterThan(high.fade);
    expect(layoutContactBlobs([walker(0, { role: 'airborne', position: [0, CONTACT_BLOB_FADE_HEIGHT, 0] })])).toHaveLength(0);
  });

  it('clamps the radius to a sane range', () => {
    const [tiny] = layoutContactBlobs([walker(0, { footprint: 0.01 })]);
    const [huge] = layoutContactBlobs([walker(0, { footprint: 9 })]);
    expect(tiny.radius).toBeGreaterThan(0.1);
    expect(huge.radius).toBeLessThanOrEqual(1.6);
  });
});

describe('scene discovery (LOOK r3: nothing calls registerFigure)', () => {
  it('finds figure roots by the names Figure mounts with, and skips registry entries', async () => {
    const THREE = await import('three');
    const { findFigureRoots, FIGURE_ROOT_NAME } = await import('../ContactBlobs');
    const scene = new THREE.Scene();
    const names = ['figure-a', 'ambient-7', 'ace-player-0001', 'nurse', 'plaza-ground', 'nurse-desk', 'teams-ledger'];
    const nodes = names.map((name) => {
      const group = new THREE.Group();
      group.name = name;
      scene.add(group);
      return group;
    });
    const found = findFigureRoots(scene).map((o) => o.name);
    expect(found).toEqual(['figure-a', 'ambient-7', 'ace-player-0001', 'nurse']);
    expect(FIGURE_ROOT_NAME.test('nurse-desk')).toBe(false);
    expect(findFigureRoots(scene, new Set([nodes[0]])).map((o) => o.name)).not.toContain('figure-a');
  });
});
