import { describe, expect, it } from 'vitest';
import {
  applyTreeDensity,
  growTree,
  isTreeCulled,
  TREE_CULL_RADIUS_M,
  treeDensityForRung,
  treeSkinById,
  TREE_SKINS,
  type TreeSpec,
} from '../tree';

/**
 * C-100 criterion 3 — the shared tree system's pure half: deterministic
 * growth, quality-gated density tiers over the QUALITY_LADDER rungs,
 * distance culling, and the three demo skins as data.
 */

const SKIN = treeSkinById('sakura');

function spec(seed: number, heightM = 5): TreeSpec {
  return { skin: SKIN, heightM, seed };
}

describe('growTree — deterministic trunk + branch + card structure', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = growTree(spec(101));
    const b = growTree(spec(101));
    const c = growTree(spec(102));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it('grows REAL structure: a trunk, level-1 limbs, level-2 twigs, layered cards over both sets', () => {
    const tree = growTree(spec(7));
    expect(tree.trunk.level).toBe(0);
    expect(tree.branches.some((branch) => branch.level === 1)).toBe(true);
    expect(tree.branches.some((branch) => branch.level === 2)).toBe(true);
    expect(tree.cards.length).toBeGreaterThanOrEqual(30);
    expect(new Set(tree.cards.map((card) => card.layer)).size).toBe(3);
    expect(tree.cards.some((card) => card.set === 'A')).toBe(true);
    expect(tree.cards.some((card) => card.set === 'B')).toBe(true);
    // Canopy cards sit up the crown, not on the ground.
    for (const card of tree.cards) expect(card.position.y).toBeGreaterThan(0.5);
  });

  it('scales with the authored height', () => {
    const small = growTree(spec(11, 3));
    const tall = growTree(spec(11, 7));
    expect(tall.trunk.to.y).toBeGreaterThan(small.trunk.to.y);
    expect(tall.trunk.radiusFrom).toBeGreaterThan(small.trunk.radiusFrom);
  });
});

describe('treeDensityForRung — QUALITY_LADDER gating (0=TOP → 4=bottom)', () => {
  it('is monotone: higher rung, fewer cards and shallower branches', () => {
    const tree = growTree(spec(21));
    let previousCards = Number.POSITIVE_INFINITY;
    let previousBranches = Number.POSITIVE_INFINITY;
    for (let rung = 0; rung <= 4; rung += 1) {
      const density = treeDensityForRung(rung);
      const thinned = applyTreeDensity(tree, density);
      expect(thinned.cards.length).toBeLessThanOrEqual(previousCards);
      expect(thinned.branches.length).toBeLessThanOrEqual(previousBranches);
      previousCards = thinned.cards.length;
      previousBranches = thinned.branches.length;
    }
  });

  it('the bottom rung keeps a readable tree rather than vanishing', () => {
    const thinned = applyTreeDensity(growTree(spec(21)), treeDensityForRung(4));
    expect(thinned.cards.length).toBeGreaterThanOrEqual(2);
    expect(thinned.branches.length).toBeGreaterThanOrEqual(1);
  });

  it('thinning is deterministic — the same tree thins the same way', () => {
    const tree = growTree(spec(21));
    expect(JSON.stringify(applyTreeDensity(tree, treeDensityForRung(2)))).toBe(
      JSON.stringify(applyTreeDensity(growTree(spec(21)), treeDensityForRung(2))),
    );
  });

  it('clamps out-of-ladder rungs into range', () => {
    expect(treeDensityForRung(-1)).toEqual(treeDensityForRung(0));
    expect(treeDensityForRung(9)).toEqual(treeDensityForRung(4));
  });
});

describe('isTreeCulled — distance culling', () => {
  it('keeps trees inside the cull radius and drops trees beyond it', () => {
    const tree = { x: 30, z: 40 };
    expect(isTreeCulled(tree, { x: 0, z: 0 })).toBe(false); // exactly 50 m
    expect(isTreeCulled(tree, { x: 0, z: 0 }, 49.9)).toBe(true);
    expect(isTreeCulled(tree, { x: 0, z: 0 }, 50)).toBe(false);
  });

  it('the default radius is the shared cull constant', () => {
    const edge = { x: TREE_CULL_RADIUS_M, z: 0 };
    expect(isTreeCulled(edge, { x: 0, z: 0 })).toBe(false);
    expect(isTreeCulled({ x: TREE_CULL_RADIUS_M + 0.1, z: 0 }, { x: 0, z: 0 })).toBe(true);
  });
});

describe('TREE_SKINS — the per-theme leaf-card sets as data', () => {
  it('ships exactly the three demo skins with two distinct leaf sets each', () => {
    expect(TREE_SKINS.map((skin) => skin.id)).toEqual(['sakura', 'mountain', 'clouds']);
    for (const skin of TREE_SKINS) {
      expect(JSON.stringify(skin.leafA)).not.toBe(JSON.stringify(skin.leafB));
      expect(skin.cardScaleM).toBeGreaterThan(0);
    }
  });

  it('resolves by id and rejects unknown ids with a distinct error', () => {
    expect(treeSkinById('mountain').id).toBe('mountain');
    expect(() => treeSkinById('volcano')).toThrow('unknown tree skin');
  });
});
