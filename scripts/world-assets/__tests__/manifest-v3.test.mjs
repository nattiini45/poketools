import { describe, expect, it } from 'vitest';
import { Dex } from '@pkmn/dex';
import {
  animationDuration,
  clipMetaFromRoot,
  enrichManifest,
  MANIFEST_VERSION_V3,
  primaryTypeFor,
  rolesFor,
  typesFor,
} from '../manifest-v3.mjs';

/**
 * Manifest v3 bake helpers: durations from glTF animation samplers, primary
 * type from @pkmn/dex at bake time, and an enrich pass that never drops the
 * v2 pool section. glTF-Transform objects are stubbed with the same method
 * surface the helpers call (listAnimations / listSamplers / getInput /
 * getCount / getScalar / getName).
 */

function accessor(times) {
  return { getCount: () => times.length, getScalar: (i) => times[i] };
}
function animation(name, samplerTimes) {
  return {
    getName: () => name,
    listSamplers: () => samplerTimes.map((times) => ({ getInput: () => (times ? accessor(times) : null) })),
  };
}
function root(animations) {
  return { listAnimations: () => animations };
}

describe('animationDuration / clipMetaFromRoot', () => {
  it('takes the latest keyframe across every sampler', () => {
    expect(animationDuration(animation('idle', [[0, 0.5, 1.2], [0, 2.0166], null]))).toBeCloseTo(2.0166);
    expect(animationDuration(animation('empty', []))).toBe(0);
  });

  it('maps clip names to rounded durations and skips unnamed clips', () => {
    const meta = clipMetaFromRoot(root([animation('idle', [[0, 2.01666]]), animation('walk', [[0, 1.0166]]), animation('', [[0, 9]])]));
    expect(meta).toEqual({ idle: { duration: 2.017 }, walk: { duration: 1.017 } });
  });
});

describe('primaryTypeFor', () => {
  it('reads the first type from the dex, regional formes included', () => {
    expect(primaryTypeFor('Marill', Dex)).toBe('Water');
    expect(primaryTypeFor('Zapdos-Galar', Dex)).toBe('Fighting');
  });

  it('falls back to the base species, then null', () => {
    expect(primaryTypeFor('Marill-NotAForme', Dex)).toBe('Water');
    expect(primaryTypeFor('Notapokemonxyz-Glitch', Dex)).toBeNull();
  });
});

describe('typesFor / rolesFor (D35 Q1/Q2: additive metadata)', () => {
  it('reads both types, primary first, with the base-species fallback', () => {
    expect(typesFor('Marill', Dex)).toEqual(['Water', 'Fairy']);
    expect(typesFor('Zapdos-Galar', Dex)).toEqual(['Fighting', 'Flying']);
    expect(typesFor('Marill-NotAForme', Dex)).toEqual(['Water', 'Fairy']);
    expect(typesFor('Notapokemonxyz-Glitch', Dex)).toEqual([]);
    for (const name of ['Marill', 'Zapdos-Galar', 'Pikachu']) expect(typesFor(name, Dex)[0]).toBe(primaryTypeFor(name, Dex));
  });

  it('maps species to roles from the bake-side table only, by exact normalised name', () => {
    const table = { nurse: ['Chansey', 'Blissey'] };
    expect(rolesFor('Chansey', table)).toEqual(['nurse']);
    expect(rolesFor('chansey', table)).toEqual(['nurse']);
    expect(rolesFor('Chansey-Alt', table)).toEqual([]);
    expect(rolesFor('Marill', table)).toEqual([]);
    // The default table is lib.mjs NURSE_SPECIES.
    expect(rolesFor('Audino')).toEqual(['nurse']);
  });
});

describe('enrichManifest', () => {
  const v2 = {
    version: 2,
    generatedAt: '2026-09-19T00:00:00.000Z',
    figures: [
      { species: 'Marill', file: 'models/regular/183.glb', clips: ['idle', 'walk'] },
      { species: 'Ivysaur', file: 'models/regular/2.glb', clips: [] },
      { species: 'Pikachu', file: 'models/regular/25.glb', clips: ['idle'] },
    ],
    props: [{ name: 'p' }],
    environment: [{ file: 'env/x.hdr', kb: 1 }],
    missingForms: [],
    pool: { source: 'Pokemon-3D-api/assets', universe: 860 },
  };
  const roots = {
    'models/regular/183.glb': root([animation('idle', [[0, 2]]), animation('walk', [[0, 1]])]),
    'models/regular/2.glb': root([]),
  };

  it('bumps to v3, adds the fields, and keeps every other section', async () => {
    const { manifest, stats } = await enrichManifest(v2, {
      readRoot: async (file) => roots[file] ?? null,
      dex: Dex,
      now: new Date('2026-09-26T00:00:00.000Z'),
    });
    expect(manifest.version).toBe(MANIFEST_VERSION_V3);
    expect(manifest.pool).toEqual(v2.pool);
    expect(manifest.props).toEqual(v2.props);
    expect(manifest.environment).toEqual(v2.environment);
    expect(manifest.figures[0]).toMatchObject({ clipMeta: { idle: { duration: 2 }, walk: { duration: 1 } }, primaryType: 'Water' });
    expect(manifest.figures[1]).toMatchObject({ clipMeta: {}, primaryType: 'Grass' });
    // GLB absent locally: no clipMeta invented.
    expect(manifest.figures[2].clipMeta).toBeUndefined();
    expect(manifest.figures[2].primaryType).toBe('Electric');
    expect(stats).toEqual({ figures: 3, withMeta: 2, withType: 3, withTypes: 3, withRoles: 0, missingGlb: 1 });
    expect(manifest.figures[0].types).toEqual(['Water', 'Fairy']);
    expect(manifest.figures[0].roles).toBeUndefined();
    // Input untouched.
    expect(v2.version).toBe(2);
    expect(v2.figures[0].clipMeta).toBeUndefined();
  });
});

describe('R33: the full bake emits the same v3 fields as --enrich', () => {
  const figureRoot = () => root([animation('idle', [[0, 2]]), animation('walk', [[0, 1]])]);
  const roleSpecies = { nurse: ['Marill'] };
  const cases = [
    { dexId: 183, category: 'regular', species: 'Marill', aliases: [] },
    { dexId: 145, category: 'galarian', species: 'Zapdos-Galar', aliases: [] },
    { dexId: 25, category: 'regular', species: 'Pikachu', aliases: [] },
    { dexId: 9999, category: 'regular', species: 'Notapokemonxyz-Glitch', aliases: [] },
  ];

  it('bakedFigure carries clipMeta, primaryType, types and roles exactly as enrichManifest writes them', async () => {
    const { bakedFigure } = await import('../bake-manifest.mjs');
    const v3Keys = ['clipMeta', 'primaryType', 'types', 'roles'];
    for (const desc of cases) {
      const file = `models/${desc.category}/${desc.dexId}.glb`;
      const baked = bakedFigure(desc, {
        root: figureRoot(),
        file,
        sourceForm: desc.category,
        kb: 10,
        heightm: 0.4,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        triangles: 100,
        dex: Dex,
        roleSpecies,
      });
      const { manifest } = await enrichManifest(
        { version: 2, figures: [{ species: desc.species, file, clips: ['idle', 'walk'] }] },
        { readRoot: async () => figureRoot(), dex: Dex, roleSpecies },
      );
      const enriched = manifest.figures[0];
      for (const key of v3Keys) expect(baked[key], `${desc.species}.${key}`).toEqual(enriched[key]);
    }
  });

  it('the full bake writes types (both) and roles (when non-empty), and omits them when unresolvable', async () => {
    const { bakedFigure } = await import('../bake-manifest.mjs');
    const bake = (desc) =>
      bakedFigure(desc, {
        root: figureRoot(),
        file: 'x.glb',
        sourceForm: desc.category,
        kb: 1,
        heightm: null,
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        triangles: 1,
        dex: Dex,
        roleSpecies,
      });
    const marill = bake(cases[0]);
    expect(marill.types).toEqual(['Water', 'Fairy']);
    expect(marill.types[0]).toBe(marill.primaryType);
    expect(marill.roles).toEqual(['nurse']);
    expect(marill.clips).toEqual(['idle', 'walk']);
    expect(bake(cases[1]).types).toEqual(['Fighting', 'Flying']);
    expect(bake(cases[2]).roles).toBeUndefined();
    const glitch = bake(cases[3]);
    expect(glitch.types).toBeUndefined();
    expect(glitch.primaryType).toBeUndefined();
    // Default role table (lib.mjs NURSE_SPECIES) when none is passed.
    const audino = bakedFigure(
      { dexId: 531, category: 'regular', species: 'Audino', aliases: [] },
      { root: figureRoot(), file: 'y.glb', sourceForm: 'regular', kb: 1, heightm: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] }, triangles: 1, dex: Dex },
    );
    expect(audino.roles).toEqual(['nurse']);
  });

  it('importing bake-manifest.mjs does not run a bake (CLI guard)', async () => {
    const mod = await import('../bake-manifest.mjs');
    expect(typeof mod.bakedFigure).toBe('function');
  });
});
