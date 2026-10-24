/**
 * World-asset manifest loader (ADR-0002).
 *
 * The plaza's Pokémon figures, KTX2 texture sets, kit pieces and HDRIs live in
 * the `world-assets` Supabase Storage bucket, described by a generated
 * manifest (`scripts/world-assets/bake-manifest.mjs`; shipped under
 * `WORLD_MANIFEST_FILE`). This module
 * fetches that manifest once, indexes figures by species, and turns entries
 * into URLs and real-world scales. Nothing here is hand-maintained.
 *
 * Pure data + fetch — no three.js imports, safe from server components. The
 * React hook lives at the bottom and is client-only by nature of `use()`.
 */

import { use } from 'react';
import { ROUTE_ASSET_ARM_MANIFEST_FILE, routeAssetBaseOverride } from './asset-base-override';

export type FigureForm = 'regular' | 'alolan' | 'galarian' | 'hisuian' | 'paldean';

export interface FigureBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface FigureEntry {
  dexId: number;
  form: FigureForm;
  /** Display species name as `@pkmn/dex` spells the base species. */
  species: string;
  /** Cosmetic formes that share this file (e.g. `Toxtricity-Low-Key`). */
  aliases: string[];
  /** Bucket-relative path, e.g. `models/regular/4.glb`. */
  file: string;
  /** `regular` when a regional file was missing upstream and the base file stands in. */
  sourceForm: FigureForm;
  /** Wire size of the file in this mirror's encoding (truthful in every arm). */
  kb: number;
  /**
   * D42 additive: the cast currency, the file's size in the ORIGINAL (A)
   * encoding, so a re-encode (meshopt) never reshuffles the cast and only a
   * real geometry reduction (decimation) changes it. Absent on manifests
   * baked before D42: every budget and sort then reads `kb` (`castKbOf`).
   */
  castKb?: number;
  /**
   * D42 additive: decoded and promoted vertex + index bytes (the GPU cost,
   * by the `vertex-formats.ts` rules). Reported and gated by the cast flip;
   * no runtime consumer.
   */
  gpuKb?: number;
  /** Pokédex height in metres (PokéAPI); `null` when unknown. */
  heightm: number | null;
  /** Rest-pose bounds in model units. */
  bounds: FigureBounds;
  /** Canonical clip names present: any of `idle`, `idle2`, `walk`, `run`. */
  clips: string[];
  /**
   * v3 (fidelity pass): loop length per clip in seconds, read at bake time
   * from the glTF animation samplers. Absent on v0–v2 manifests — every
   * consumer must fall back (see `clipDuration`), never assume it.
   */
  clipMeta?: Readonly<Record<string, ClipMeta>>;
  /**
   * v3 (fidelity pass): the species' primary type, looked up in @pkmn/dex at
   * BAKE time so the client bundle never carries the dex. Absent on older
   * manifests and for species the dex cannot resolve.
   */
  primaryType?: string;
  triangles: number;
  /**
   * v3 additive (D35 core round, Q1): every type of the species, primary
   * first, baked from @pkmn/dex (`types[0] === primaryType`). Absent on
   * manifests baked before the core round; casting treats absence as
   * primary-only (habitat-types.ts `entryTypes`).
   */
  types?: string[];
  /**
   * v3 additive (D35 core round, Q2): species-identity roles a type cannot
   * express (e.g. `nurse`), baked from the bake-side role table so the app
   * never names the species. Absent when the entry has no role.
   */
  roles?: string[];
}

/** Baked metadata for one clip (manifest v3). */
export interface ClipMeta {
  /** Loop length in seconds. */
  duration: number;
}

export interface EnvironmentEntry {
  file: string;
  kb: number;
}

/**
 * Hero prop: a Meshy text-to-3D generation. Meshy normalizes the
 * GLB to its own box (~1.9 units on the longest axis), so placement scales
 * from the recorded `bounds`, not from 1 m = 1 unit.
 */
export interface PropEntry {
  /** Slug stations request, e.g. `haussmann-lamp-post`. */
  name: string;
  /** Bucket-relative path, e.g. `props/haussmann-lamp-post.glb`. */
  file: string;
  kb: number;
  /** Bar after transform: ≤ 40 000. */
  triangles: number;
  /** Rest bounds in model units. */
  bounds: FigureBounds;
}

export interface WorldManifest {
  version: number;
  generatedAt: string;
  figures: FigureEntry[];
  /** Hero props; `[]` until the Meshy batch has run (bake-manifest always writes the key). */
  props: PropEntry[];
  environment: EnvironmentEntry[];
  missingForms: string[];
  /**
   * v2 (C-101): baked pool-universe coverage; `null` on v0/v1 manifests.
   * v3 (fidelity pass) keeps it and adds per-figure `clipMeta`/`primaryType`.
   */
  pool: PoolCoverage | null;
}

/** One sprite-fallback universe entry whose GLB is permanently unavailable upstream. */
export interface PoolCoverageEntry {
  species: string;
  dexId: number;
  form: FigureForm;
  /** Why no GLB can resolve (upstream archive absence), for disclosure. */
  reason: string;
}

/**
 * Pool-universe coverage section baked by `scripts/world-assets/pool-coverage.mjs`
 * (manifest v2): how the 860-entry gen-9 pool universe resolves through the
 * FigureIndex fallback chain — own-form GLB, stand-in file, or the never-crash
 * sprite billboard.
 */
export interface PoolCoverage {
  /** The GLB source of record, e.g. `Pokemon-3D-api/assets models/opt (Draco+WebP)`. */
  source: string;
  /** Usable gen-9 entries enumerated from the app's dex (`battleOnly`/`isNonstandard` excluded). */
  universe: number;
  /** Resolved to a figure whose form matches the request. */
  glb: number;
  /** Resolved to another form's file (regional stand-in / base-species dash fallback). */
  standin: number;
  /** No resolution — the caller renders the HOME sprite billboard. */
  sprite: number;
  /** Sprite-fallback entries whose GLB still exists upstream (future download tranche). */
  spriteDeferred: number;
  /** Sprite-fallback entries whose GLB is permanently absent upstream, with reasons. */
  spriteAbsent: PoolCoverageEntry[];
}

export const EMPTY_MANIFEST: WorldManifest = {
  version: 0,
  generatedAt: '',
  figures: [],
  props: [],
  environment: [],
  missingForms: [],
  pool: null,
};

/** Local mirror written by `bake-manifest.mjs --mirror`; used when the bucket URL is unset. */
const LOCAL_BASE = '/models/world';

/**
 * D42 commit P (ENGINE-ASSET-PLAN §5 D5, §7): the shipped world manifest's
 * file name on the configured base (the bucket in production, the local
 * mirror in dev). The meshopt asset set is published under this name only
 * (`upload-supabase.mjs --manifest-name manifest.v3.json`); the published
 * `manifest.json` stays the v2 descriptor that builds before commit P read,
 * so it is never written, and this code never reads it. A routeDebug mirror
 * arm keeps the bake's `manifest.json` (`worldManifestFile`).
 */
export const WORLD_MANIFEST_FILE = 'manifest.v3.json';

/**
 * The manifest file of this page's asset base: `WORLD_MANIFEST_FILE` on the
 * configured base (production, the server render, dev, and the `a` arm), and
 * `ROUTE_ASSET_ARM_MANIFEST_FILE` (`manifest.json`) on a `?routeAssetBase=`
 * mirror arm (`d42`, `d42c`, `d42m`, `cand-*`), whose frozen directories
 * hold the bake's name.
 */
export function worldManifestFile(): string {
  return routeAssetBaseOverride(LOCAL_BASE) !== null ? ROUTE_ASSET_ARM_MANIFEST_FILE : WORLD_MANIFEST_FILE;
}

/**
 * A usable asset base is an absolute http(s) URL or a root-relative path.
 * Anything else (e.g. a Windows drive path that Git Bash's MSYS path
 * conversion baked in for `/models/world` → `C:/Program Files/Git/models/world`)
 * would send every world fetch to `file:///` and drop the route to Lite.
 */
export function isUsableAssetBase(value: string): boolean {
  return /^https?:\/\//i.test(value) || (value.startsWith('/') && !value.startsWith('//'));
}

let warnedBadBase = false;

/**
 * Base URL every manifest `file` is resolved against. D42: a `?routeDebug=1`
 * page may select an asset mirror arm (`asset-base-override.ts`, client-side
 * only); the server render and production always use the configured base.
 */
export function getWorldAssetBase(): string {
  const override = routeAssetBaseOverride(LOCAL_BASE);
  if (override !== null) return override;
  const configured = process.env.NEXT_PUBLIC_WORLD_ASSETS_URL?.trim();
  if (configured && configured.length > 0 && !isUsableAssetBase(configured)) {
    if (!warnedBadBase) {
      warnedBadBase = true;
      console.warn(`[route-world] ignoring unusable NEXT_PUBLIC_WORLD_ASSETS_URL "${configured}"; using ${LOCAL_BASE}`);
    }
    return LOCAL_BASE;
  }
  return (configured && configured.length > 0 ? configured : LOCAL_BASE).replace(/\/+$/, '');
}

export function worldAssetUrl(file: string): string {
  return `${getWorldAssetBase()}/${file.replace(/^\/+/, '')}`;
}

export function figureUrl(entry: FigureEntry): string {
  return worldAssetUrl(entry.file);
}

export function propUrl(entry: PropEntry): string {
  return worldAssetUrl(entry.file);
}

/** Path to the self-hosted Basis Universal transcoder (KTX2 textures). */
export const BASIS_TRANSCODER_PATH = '/basis/';

/** Normalize for lookup: accents, hyphens and spacing all vary by source. */
export function normalizeSpecies(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Baked loop length of `clip` in seconds, or null when the manifest predates
 * v3, the clip is absent, or the recorded value is unusable. Callers treat
 * null as "unknown" (stride matching off, default fidget length) rather than
 * guessing a duration.
 */
export function clipDuration(entry: FigureEntry, clip: string): number | null {
  const duration = entry.clipMeta?.[clip]?.duration;
  return typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null;
}

/** Every baked clip duration of an entry as a plain map (empty pre-v3). */
export function clipDurations(entry: FigureEntry): Record<string, number> {
  const out: Record<string, number> = {};
  for (const clip of entry.clips) {
    const duration = clipDuration(entry, clip);
    if (duration !== null) out[clip] = duration;
  }
  return out;
}

/**
 * D42: the size every cast budget and roster sort reads: `castKb` (the
 * A-encoding bytes) when the manifest bakes it, else `kb`. The fallback
 * reproduces the pre-D42 cast exactly.
 */
export function castKbOf(entry: Pick<FigureEntry, 'kb' | 'castKb'>): number {
  const cast = entry.castKb;
  return typeof cast === 'number' && Number.isFinite(cast) ? cast : entry.kb;
}

/** Height of the rest-pose bounds in model units; never zero. */
export function boundsHeight(entry: FigureEntry): number {
  return Math.max(entry.bounds.max[1] - entry.bounds.min[1], 1e-3);
}

/**
 * Uniform scale that puts the figure at its Pokédex height (1 unit = 1 m).
 * Figures without a known height keep their authored size, clamped to a
 * plausible range so a mis-exported file can never fill the plaza.
 */
export function figureScale(entry: FigureEntry): number {
  const height = boundsHeight(entry);
  const target = entry.heightm ?? Math.min(Math.max(height, 0.3), 2);
  return target / height;
}

/** Real-world height the figure will have on the plaza after `figureScale`. */
export function figureHeightM(entry: FigureEntry): number {
  return boundsHeight(entry) * figureScale(entry);
}

/**
 * Species → figure index with the fallback chain the spec prescribes:
 * exact species (incl. cosmetic aliases) → regional file → base species file →
 * `null` (caller renders a HOME sprite billboard).
 */
export class FigureIndex {
  private readonly bySpecies = new Map<string, FigureEntry>();
  private readonly byDex = new Map<number, FigureEntry>();

  constructor(readonly manifest: WorldManifest) {
    for (const entry of manifest.figures) {
      const key = normalizeSpecies(entry.species);
      // Regional entries carry the regional name (`Geodude-Alola`); the plain
      // base name maps to the regular file.
      if (!this.bySpecies.has(key) || entry.form === 'regular') this.bySpecies.set(key, entry);
      for (const alias of entry.aliases) {
        const aliasKey = normalizeSpecies(alias);
        if (!this.bySpecies.has(aliasKey)) this.bySpecies.set(aliasKey, entry);
      }
      if (entry.form === 'regular') this.byDex.set(entry.dexId, entry);
    }
  }

  get size(): number {
    return this.manifest.figures.length;
  }

  find(species: string | null | undefined): FigureEntry | null {
    if (!species) return null;
    const exact = this.bySpecies.get(normalizeSpecies(species));
    if (exact) return exact;
    const dash = species.indexOf('-');
    if (dash > 0) {
      const base = this.bySpecies.get(normalizeSpecies(species.slice(0, dash)));
      if (base) return base;
    }
    return null;
  }

  /** Resolve a roster slot: current form first, then the base Pokémon. */
  resolve(currentForm: string | null | undefined, basePokemon: string | null | undefined): FigureEntry | null {
    return this.find(currentForm) ?? this.find(basePokemon);
  }

  byDexId(dexId: number): FigureEntry | null {
    return this.byDex.get(dexId) ?? null;
  }
}

let manifestPromise: Promise<WorldManifest> | null = null;

/** A failed manifest load (ELF-2): the URL asked for and why. */
export interface WorldManifestLoadFailure {
  url: string;
  message: string;
}

let manifestFailure: WorldManifestLoadFailure | null = null;

/**
 * D42 (ELF-2): the page's failed manifest load, or null. The empty-manifest
 * fallback below keeps the page up but renders a world without figures or
 * props; the figure loader folds this into `renderPath.failedFigureLoads`
 * (gated at 0 on every capture), so a wrong tree, a mirror without its
 * manifest, or a missing published manifest is never silent.
 */
export function worldManifestLoadFailure(): WorldManifestLoadFailure | null {
  return manifestFailure ? { ...manifestFailure } : null;
}

function isManifest(value: unknown): value is WorldManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<WorldManifest>;
  return typeof candidate.version === 'number' && Array.isArray(candidate.figures);
}

/**
 * Fetch the manifest once per page. A missing bucket or mirror degrades to an
 * empty manifest (every figure becomes a billboard) instead of throwing into
 * the canvas boundary — the world must never take the page down with it.
 */
export function loadWorldManifest(): Promise<WorldManifest> {
  if (manifestPromise) return manifestPromise;
  const url = worldAssetUrl(worldManifestFile());
  manifestPromise = fetch(url, { cache: 'no-cache' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`manifest ${res.status}`);
      const json: unknown = await res.json();
      if (!isManifest(json)) throw new Error('manifest shape');
      // Manifests baked before C-030 have no `props` key (e.g. a bucket copy);
      // manifests baked before C-101 have no `pool` section.
      return { ...json, props: json.props ?? [], pool: json.pool ?? null };
    })
    .catch((err: unknown) => {
      console.warn(`[route-world] world-assets manifest unavailable at ${url}:`, err);
      manifestFailure = { url, message: err instanceof Error ? err.message : String(err) };
      return EMPTY_MANIFEST;
    });
  return manifestPromise;
}

/** Test seam: replace the cached manifest. */
export function __setWorldManifestForTests(manifest: WorldManifest | null): void {
  manifestPromise = manifest ? Promise.resolve(manifest) : null;
  manifestFailure = null;
}

let indexCache: { manifest: WorldManifest; index: FigureIndex } | null = null;

export function indexFor(manifest: WorldManifest): FigureIndex {
  if (indexCache && indexCache.manifest === manifest) return indexCache.index;
  const index = new FigureIndex(manifest);
  indexCache = { manifest, index };
  return index;
}

/** Suspends until the manifest is loaded. Client components inside a Suspense boundary only. */
export function useWorldManifest(): WorldManifest {
  return use(loadWorldManifest());
}

export function useFigureIndex(): FigureIndex {
  return indexFor(useWorldManifest());
}
