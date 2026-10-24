import { describe, expect, it } from 'vitest';
import { EMPTY_MANIFEST, FigureIndex, type FigureEntry, type WorldManifest } from '../model-manifest';
import {
  COLOSSAL_M,
  planThemeFigures,
  TINY_M,
  themeFigureLoadSet,
  type ThemeFigurePlan,
} from '../figure-contract';

/**
 * C-100 criterion 1 — the theme figure contract's pure planner: roster-
 * driven (per-player aces through the manifest resolve chain) AND pool-
 * driven (arbitrary species sets), colossal/tiny handling from the manifest
 * bounds, unresolvable lines degrading to the billboard fallback, and the
 * preload set the KTX2 queue is kicked with (PB-100).
 */

function entry(partial: Pick<FigureEntry, 'dexId' | 'form' | 'species'> & Partial<FigureEntry>): FigureEntry {
  return {
    aliases: [],
    file: `models/regular/${partial.dexId}.glb`,
    sourceForm: 'regular',
    kb: 300,
    heightm: 1,
    bounds: { min: [0, 0, 0], max: [1, 2, 1] },
    clips: ['idle'],
    triangles: 5000,
    ...partial,
  };
}

const MANIFEST: WorldManifest = {
  ...EMPTY_MANIFEST,
  figures: [
    entry({ dexId: 6, form: 'regular', species: 'Charizard', heightm: 1.7 }),
    entry({ dexId: 4, form: 'regular', species: 'Charmander', heightm: 0.6 }),
    entry({ dexId: 94, form: 'regular', species: 'Gengar', heightm: 1.5 }),
    entry({ dexId: 473, form: 'regular', species: 'Mamoswine', heightm: 2.5 }),
    entry({ dexId: 172, form: 'regular', species: 'Pichu', heightm: 0.3 }),
    entry({ dexId: 25, form: 'regular', species: 'Pikachu', heightm: 0.4, aliases: ['Pikachu-Original'] }),
  ],
};

const INDEX = new FigureIndex(MANIFEST);
const EMPTY_INDEX = new FigureIndex(EMPTY_MANIFEST);

describe('planThemeFigures — roster-driven source', () => {
  it('resolves a participant through the current-form → base chain', () => {
    const plan: ThemeFigurePlan = {
      roster: [{ id: 'player-1', label: 'Mara', species: 'Charizard', baseSpecies: 'Charmander' }],
    };
    const [figure] = planThemeFigures(INDEX, plan);
    expect(figure?.entry?.species).toBe('Charizard');
    expect(figure?.label).toBe('Mara');
    expect(figure?.key).toBe('player-1');
  });

  it('falls back to the base species when the current form has no file', () => {
    const plan: ThemeFigurePlan = {
      roster: [{ id: 'player-2', label: 'Rowan', species: 'Zoroark', baseSpecies: 'Charmander' }],
    };
    const [figure] = planThemeFigures(INDEX, plan);
    expect(figure?.entry?.species).toBe('Charmander');
  });

  it('an unresolvable ace keeps its declaration and degrades to entry null', () => {
    const plan: ThemeFigurePlan = {
      roster: [{ id: 'player-3', label: 'Selin', species: 'Arceus', baseSpecies: null }],
    };
    const [figure] = planThemeFigures(INDEX, plan);
    expect(figure?.entry).toBeNull();
    expect(figure?.species).toBe('Arceus');
    expect(figure?.heightM).toBe(0);
  });
});

describe('planThemeFigures — pool-driven source', () => {
  it('resolves an arbitrary species list in declaration order', () => {
    const plan: ThemeFigurePlan = { pool: ['Pikachu', 'Gengar'] };
    const figures = planThemeFigures(INDEX, plan);
    expect(figures.map((figure) => figure.entry?.species)).toEqual(['Pikachu', 'Gengar']);
    expect(figures.map((figure) => figure.key)).toEqual(['Pikachu', 'Gengar']);
  });

  it('derives colossal / standard / tiny stances from the manifest heights', () => {
    const plan: ThemeFigurePlan = { pool: ['Mamoswine', 'Gengar', 'Pichu'] };
    const figures = planThemeFigures(INDEX, plan);
    // Mamoswine stands at exactly the colossal threshold; Pichu sits under
    // the tiny threshold at its Pokédex height (0.3 m).
    expect(figures[0]?.heightM).toBe(COLOSSAL_M);
    expect(figures[0]?.stance).toBe('colossal');
    expect(figures[1]?.stance).toBe('standard');
    expect(figures[2]?.heightM).toBeLessThan(TINY_M);
    expect(figures[2]?.stance).toBe('tiny');
  });

  it('keys a repeated pool species uniquely — React children keys must not collide', () => {
    // The clouds float row rides four front-rank slots on a three-tiny front
    // pool, so the backfill rotation legitimately repeats a species — and
    // ThemeFigures keys its children by `figure.key`. The second occurrence
    // gets an occurrence suffix; labels keep the bare species.
    const figures = planThemeFigures(INDEX, { pool: ['Pikachu', 'Cosmog', 'Magnemite', 'Pikachu'] });
    const keys = figures.map((figure) => figure.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['Pikachu', 'Cosmog', 'Magnemite', 'Pikachu#1']);
    expect(figures.map((figure) => figure.label)).toEqual(['Pikachu', 'Cosmog', 'Magnemite', 'Pikachu']);
  });
});

describe('planThemeFigures — both sources together', () => {
  it('mounts roster entries first, then the pool, as one plan', () => {
    const plan: ThemeFigurePlan = {
      roster: [{ id: 'player-1', label: 'Mara', species: 'Charizard', baseSpecies: 'Charmander' }],
      pool: ['Pikachu'],
    };
    const figures = planThemeFigures(INDEX, plan);
    expect(figures).toHaveLength(2);
    expect(figures[0]?.key).toBe('player-1');
    expect(figures[1]?.key).toBe('Pikachu');
  });

  it('an empty plan plans nothing', () => {
    expect(planThemeFigures(INDEX, {})).toHaveLength(0);
  });
});

describe('themeFigureLoadSet — the KTX2 preload kick', () => {
  it('carries only resolved figures, deduped, in plan order', () => {
    const plan: ThemeFigurePlan = {
      roster: [{ id: 'a', label: 'A', species: 'Charizard', baseSpecies: null }],
      pool: ['Pichu', 'Arceus', 'Charizard'],
    };
    const figures = planThemeFigures(INDEX, plan);
    const urls = themeFigureLoadSet(figures);
    expect(urls).toEqual(['/models/world/models/regular/6.glb', '/models/world/models/regular/172.glb']);
  });

  it('is empty for an all-billboard plan', () => {
    const urls = themeFigureLoadSet(planThemeFigures(EMPTY_INDEX, { pool: ['Arceus'] }));
    expect(urls).toHaveLength(0);
  });
});
