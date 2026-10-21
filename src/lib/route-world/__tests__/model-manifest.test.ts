/**
 * C-101 — figure-store completion: the FigureIndex fallback chain and the
 * manifest v2 pool coverage.
 *
 * Part 1 pins the chain semantics on a fixture (exact/alias → regional →
 * dash-base → null sprite billboard, never crash). Parts 2-4 load the REAL
 * shipped `public/models/world/manifest.v3.json` (`WORLD_MANIFEST_FILE`, D42
 * commit P) — untracked (a checkout does not include it), so this runs where the
 * file exists and is a named skip elsewhere (CI) — and prove: the baked v2 pool coverage over the 860-entry gen-9
 * universe (recomputed at bake time by `scripts/world-assets/pool-coverage.mjs`;
 * 860 is the author-verified count on the installed @pkmn/dex — a dependency
 * update that moves it fails here on purpose), the 7 v1 missingForms resolved
 * through the chain, and a sampled set of tranche models resolving to the right
 * asset URL. The GLB binaries are NOT tracked (they are published to Supabase
 * Storage), so only the on-disk mirror check is gated — see MIRROR_PRESENT.
 *
 * D42 commit P (ENGINE-ASSET-PLAN §5 D5): the shipped manifest is the material
 * arm d42m's manifest byte for byte, and the published v2 `manifest.json` stays
 * unchanged for the builds deployed before commit P. Both manifests are untracked
 * here: a checkout does not include them.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  clipDuration,
  clipDurations,
  EMPTY_MANIFEST,
  FigureIndex,
  figureHeightM,
  figureScale,
  figureUrl,
  WORLD_MANIFEST_FILE,
  type FigureEntry,
  type WorldManifest,
} from '../model-manifest';
import { readMirrorManifest } from './world-manifest-fixture';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const WORLD_DIR = join(REPO_ROOT, 'public', 'models', 'world');

function entry(partial: Pick<FigureEntry, 'dexId' | 'form' | 'species'> & Partial<FigureEntry>): FigureEntry {
  return {
    aliases: [],
    file: `models/${partial.form}/${partial.dexId}.glb`,
    sourceForm: partial.form,
    kb: 100,
    heightm: 1,
    bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    clips: [],
    triangles: 100,
    ...partial,
  };
}

const FIXTURE: WorldManifest = {
  version: 2,
  generatedAt: '2026-09-19T00:00:00.000Z',
  figures: [
    entry({ dexId: 1, form: 'regular', species: 'Bulbasaur', heightm: 0.7 }),
    // Stand-in: the alolan file is absent upstream, the regular file stands in.
    entry({ dexId: 74, form: 'alolan', species: 'Geodude-Alola', file: 'models/regular/74.glb', sourceForm: 'regular' }),
    // Own-form regional file.
    entry({ dexId: 26, form: 'alolan', species: 'Raichu-Alola' }),
    // Dash-base fallback target (no alias registered — the chain must dash).
    entry({ dexId: 550, form: 'regular', species: 'Basculin' }),
  ],
  props: [],
  environment: [],
  missingForms: [],
  pool: null,
};

describe('FigureIndex fallback chain (fixture manifest v2)', () => {
  const index = new FigureIndex(FIXTURE);

  it('resolves an exact regular species', () => {
    expect(index.find('Bulbasaur')?.file).toBe('models/regular/1.glb');
  });

  it('resolves a regional species to its own file', () => {
    const hit = index.find('Raichu-Alola');
    expect(hit?.file).toBe('models/alolan/26.glb');
    expect(hit?.sourceForm).toBe('alolan');
  });

  it('resolves a stand-in entry (other form file, sourceForm records it)', () => {
    const hit = index.find('Geodude-Alola');
    expect(hit?.form).toBe('alolan');
    expect(hit?.sourceForm).toBe('regular');
    expect(hit?.file).toBe('models/regular/74.glb');
  });

  it('falls back to the dash-base species when the form name is unknown', () => {
    expect(index.find('Basculin-White-Striped')?.species).toBe('Basculin');
  });

  it('returns null for unknown species — the never-crash sprite-billboard path', () => {
    expect(index.find('Impidimp')).toBeNull();
    expect(index.find('Walking-Wake-Whoever')).toBeNull();
    expect(index.find(null)).toBeNull();
    expect(index.find(undefined)).toBeNull();
    expect(index.find('')).toBeNull();
  });

  it('resolve() tries the current form first, then the base pokemon', () => {
    expect(index.resolve('Geodude-Alola', 'Geodude')?.sourceForm).toBe('regular');
    expect(index.resolve('Not-A-Species', 'Bulbasaur')?.species).toBe('Bulbasaur');
    expect(index.resolve(null, null)).toBeNull();
  });

  it('scale/height helpers keep their shapes (heightm drives the uniform scale)', () => {
    const hit = index.find('Bulbasaur');
    expect(hit).not.toBeNull();
    if (hit) {
      // bounds height 1.0 (0..1), heightm 0.7 → scale 0.7 → rendered height 0.7 m.
      expect(figureHeightM(hit)).toBeCloseTo(0.7, 5);
      expect(figureScale(hit)).toBeCloseTo(0.7, 5);
    }
  });

  it('the empty manifest degrades to all-sprite without throwing', () => {
    const empty = new FigureIndex(EMPTY_MANIFEST);
    expect(empty.size).toBe(0);
    expect(empty.find('Bulbasaur')).toBeNull();
    expect(EMPTY_MANIFEST.pool).toBeNull();
  });
});

const MANIFEST_PATH = join(WORLD_DIR, WORLD_MANIFEST_FILE);
// The mirror manifests list a league's figure pool, so they are untracked (a checkout does not
// include them; a maintainer restores them from the private companion overlay that tracks them).
// Every block that reads them is skipped without them (named, never silently absent); with the
// files present every assertion runs. Do NOT run `bake-manifest.mjs --mirror` casually: it rmSyncs this whole directory,
// manifests and ATTRIBUTION.md included.
const SHIPPED_MIRROR = readMirrorManifest(WORLD_MANIFEST_FILE);
const V2_MIRROR = readMirrorManifest('manifest.json');
const HAS_MANIFEST = SHIPPED_MIRROR.present;
const REAL: WorldManifest = SHIPPED_MIRROR.manifest;

/**
 * The GLB binaries are published to Supabase Storage; `public/models/world/` is
 * a LOCAL MIRROR written by `bake-manifest.mjs --mirror`; only its attribution is
 * tracked, and the manifests are untracked (a checkout does not include them). So the
 * manifest assertions run where the manifests exist (maintainer checkouts), and
 * the on-disk binary check only where the mirror binaries exist too. Gated explicitly and named as a skip,
 * rather than silently absent.
 */
const MIRROR_PRESENT = existsSync(join(WORLD_DIR, 'models'));

describe.skipIf(!HAS_MANIFEST)('shipped manifest v2 — baked pool coverage (criterion 2)', () => {
  it('is version 2 or later and carries the pool section', () => {
    expect(REAL.version).toBeGreaterThanOrEqual(2);
    expect(REAL.pool).not.toBeNull();
  });

  it('covers the 860-entry pool universe exactly (glb + standin + sprite = universe)', () => {
    const pool = REAL.pool;
    expect(pool?.universe).toBe(860);
    expect(pool ? pool.glb + pool.standin + pool.sprite : -1).toBe(pool?.universe);
    expect(pool ? pool.glb : -1).toBeGreaterThan(0);
  });

  it('records the GLB source of record', () => {
    expect(REAL.pool?.source).toContain('Pokemon-3D-api/assets');
  });
});

describe.skipIf(!HAS_MANIFEST)('the 7 v1 missingForms resolved (criterion 3)', () => {
  const index = new FigureIndex(REAL);

  it('alolan Geodude line resolves through stand-in entries (sourceForm regular)', () => {
    for (const [name, dexId] of [
      ['Geodude-Alola', 74],
      ['Graveler-Alola', 75],
      ['Golem-Alola', 76],
    ] as const) {
      const hit = index.find(name);
      expect(hit, name).not.toBeNull();
      expect(hit?.dexId).toBe(dexId);
      expect(hit?.form).toBe('alolan');
      expect(hit?.sourceForm).toBe('regular');
      expect(hit?.file).toBe(`models/regular/${dexId}.glb`);
    }
  });

  it('regular 859/860/861/1011 resolve to null — the tested sprite-billboard path', () => {
    expect(index.find('Impidimp')).toBeNull();
    expect(index.find('Morgrem')).toBeNull();
    expect(index.find('Grimmsnarl')).toBeNull();
    expect(index.find('Dipplin')).toBeNull();
  });

  it('records the upstream-absent reason for each of the four', () => {
    const absent = REAL.pool?.spriteAbsent ?? [];
    for (const dexId of [859, 860, 861, 1011]) {
      const row = absent.find((a) => a.dexId === dexId && a.form === 'regular');
      expect(row, `dexId ${dexId}`).toBeDefined();
      expect(row?.reason).toMatch(/not present in the Pokemon-3D-api archive/);
    }
  });
});

describe.skipIf(!HAS_MANIFEST)('sampled tranche models resolve through the pipeline (criterion 4)', () => {
  const index = new FigureIndex(REAL);

  const SAMPLES = [
    { species: 'Vulpix-Alola', form: 'alolan' },
    { species: 'Meowth-Galar', form: 'galarian' },
    { species: 'Growlithe-Hisui', form: 'hisuian' },
    { species: 'Mewtwo', form: 'regular' },
    { species: 'Mew', form: 'regular' },
    { species: 'Furret', form: 'regular' },
  ] as const;

  for (const sample of SAMPLES) {
    it(`${sample.species} resolves through the manifest to its asset URL`, () => {
      const hit = index.find(sample.species);
      expect(hit, sample.species).not.toBeNull();
      expect(hit?.form).toBe(sample.form);
      expect(figureUrl(hit as FigureEntry)).toBe(`/models/world/${hit?.file}`);
    });

    it.skipIf(!MIRROR_PRESENT)(
      `${sample.species} GLB is present in the local asset mirror (skipped where the mirror is absent)`,
      () => {
        const hit = index.find(sample.species);
        expect(hit, sample.species).not.toBeNull();
        expect(existsSync(join(WORLD_DIR, hit?.file ?? 'missing'))).toBe(true);
      },
    );
  }
});

describe.skipIf(!HAS_MANIFEST)('manifest v3 — baked clip metadata and primary type (fidelity S8)', () => {
  it('is version 3 with a duration for every listed clip and a primary type per figure', () => {
    expect(REAL.version).toBe(3);
    for (const figure of REAL.figures) {
      expect(Object.keys(figure.clipMeta ?? {}).sort(), figure.species).toEqual([...figure.clips].sort());
      for (const clip of figure.clips) expect(clipDuration(figure, clip), `${figure.species}/${clip}`).toBeGreaterThan(0);
      expect(typeof figure.primaryType, figure.species).toBe('string');
    }
  });

  it('falls back gracefully on entries baked before v3', () => {
    const legacy = entry({ dexId: 183, form: 'regular', species: 'Marill', clips: ['idle', 'walk'] });
    expect(clipDuration(legacy, 'idle')).toBeNull();
    expect(clipDurations(legacy)).toEqual({});
    expect(legacy.primaryType).toBeUndefined();
  });

  it('ignores unusable recorded durations', () => {
    const odd = entry({
      dexId: 183,
      form: 'regular',
      species: 'Marill',
      clips: ['idle', 'walk'],
      clipMeta: { idle: { duration: 2 }, walk: { duration: 0 } },
    });
    expect(clipDurations(odd)).toEqual({ idle: 2 });
    expect(clipDuration(odd, 'run')).toBeNull();
  });
});

/**
 * D42 commit P (ENGINE-ASSET-PLAN §5 D5): the shipped manifest's bytes equal
 * the frozen material arm's (`public/models/world/d42m/manifest.json`, listed
 * in `d42m.sha256`). The arm is gitignored, so this runs where the mirror
 * exists and is a named skip elsewhere (CI). `WORLD_D42M_DIR` points it at
 * another checkout's arm (a worktree without the mirror).
 */
const D42M_DIR = process.env.WORLD_D42M_DIR ?? join(WORLD_DIR, 'd42m');
const D42M_MANIFEST = join(D42M_DIR, 'manifest.json');
const D42M_PRESENT = existsSync(D42M_MANIFEST);

describe.skipIf(!HAS_MANIFEST)('the shipped manifest is the d42m material arm (D42 commit P)', () => {
  it.skipIf(!D42M_PRESENT)(
    `${WORLD_MANIFEST_FILE} is byte-identical to d42m/manifest.json${D42M_PRESENT ? '' : ' (SKIPPED: the gitignored d42m arm is absent here, e.g. CI)'}`,
    () => {
      const shipped = readFileSync(MANIFEST_PATH);
      expect(shipped.equals(readFileSync(D42M_MANIFEST))).toBe(true);
      const list = join(D42M_DIR, '..', 'd42m.sha256');
      if (existsSync(list)) {
        const line = readFileSync(list, 'utf8')
          .split(/\r?\n/)
          .find((l) => /[ *]\.\/manifest\.json$/.test(l));
        expect(line, 'd42m.sha256 lists ./manifest.json').toBeDefined();
        expect(line?.split(/\s+/)[0]).toBe(createHash('sha256').update(shipped).digest('hex'));
      }
    },
  );

  it('carries the frozen d42 block (metrics frozen, encode nqx) and castKb on every figure', () => {
    const d42 = (REAL as WorldManifest & { d42?: { metrics?: string; encode?: { recipe?: string } } }).d42;
    expect(d42?.metrics).toBe('frozen');
    expect(d42?.encode?.recipe).toBe('nqx');
    expect(REAL.figures.every((f) => typeof f.castKb === 'number')).toBe(true);
  });
});

/**
 * v2 compatibility: `manifest.json` stays unchanged (untracked, like the v3
 * manifest), because the
 * published live `manifest.json` is what builds deployed before commit P read
 * (it is never written; the v3 set is published as `manifest.v3.json`). The
 * v3 manifest lists the same files with castKb frozen at v2's kb, so the cast
 * does not move (cast-kb.test.ts).
 */
describe.skipIf(!HAS_MANIFEST || !V2_MIRROR.present)('the v2 manifest.json stays for builds before commit P', () => {
  const V2_PATH = join(WORLD_DIR, 'manifest.json');

  it('sits beside the shipped manifest and is not it', () => {
    expect(WORLD_MANIFEST_FILE).not.toBe('manifest.json');
    expect(existsSync(V2_PATH)).toBe(true);
  });

  it('lists the same figures, props and env files; v3 castKb equals v2 kb', () => {
    const v2 = JSON.parse(readFileSync(V2_PATH, 'utf8')) as WorldManifest;
    expect(v2.figures.some((f) => f.castKb !== undefined)).toBe(false);
    const key = (f: FigureEntry) => `${f.file}|${f.species}|${f.form}`;
    expect(REAL.figures.map(key)).toEqual(v2.figures.map(key));
    expect(REAL.props.map((p) => p.file)).toEqual(v2.props.map((p) => p.file));
    expect(REAL.environment).toEqual(v2.environment);
    const v2Kb = new Map(v2.figures.map((f) => [f.file, f.kb]));
    for (const f of REAL.figures) expect(f.castKb, f.file).toBe(v2Kb.get(f.file));
  });
});
