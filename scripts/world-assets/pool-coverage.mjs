#!/usr/bin/env node
/**
 * C-101 — pool-universe coverage tool (manifest v2).
 *
 * The draft/point-buy pools draw from the app's own gen-9 dex enumeration
 * (src/lib/pkmn/dex.ts `listAllSpeciesRich` semantics: `battleOnly ||
 * isNonstandard` excluded → 860 usable entries on the installed @pkmn/dex).
 * This tool enumerates that universe, classifies every entry against the
 * committed manifest through the runtime fallback chain
 * (own-form GLB → stand-in/base-species GLB → sprite billboard), and can land
 * the downloadable tranche through the existing pipeline:
 *
 *   download raw → transform.mjs --only <keys> → bake manifest v2 → mirror
 *
 * Modes (composable):
 *   --dry-run            print the coverage table only (no writes) [default]
 *   --download           fetch the tranche's raw GLBs into .cache/raw
 *                        (idempotent: existing files are skipped; resumable:
 *                        re-run continues where the last run stopped)
 *   --transform          run transform.mjs --only on the downloaded keys
 *   --bake               merge new figures into public/models/world/manifest.json
 *                        (version 2 + baked `pool` coverage section) and copy
 *                        the new out/models files into the local mirror
 *   --all                download + transform + bake
 *   --base-limit N       tranche: first N (by dex num) unresolved base species
 *                        whose upstream file exists [default 60; the rest are a
 *                        disclosed phased follow-up]
 *
 * Form→directory spelling (archive `models/opt` uses `alolan`/`galar`/
 * `hisuian`; the app FigureForm is `alolan`/`galarian`/`hisuian`/`paldean`;
 * there is NO paldean directory upstream): raw files are cached under the APP
 * category so transform.mjs keys line up, while the fetch URL uses the ARCHIVE
 * spelling.
 *
 * Usage: node scripts/world-assets/pool-coverage.mjs [--dry-run|--all|...]
 */

import { execFile } from 'node:child_process';
import { existsSync, cpSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import { Generations } from '@pkmn/data';
import { registerMeshoptDecoder } from './meshopt-codec.mjs';

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CACHE_DIR = join(__dirname, '.cache');
const RAW_DIR = join(CACHE_DIR, 'raw');
const OUT_DIR = join(__dirname, 'out');
const OUT_MODELS_DIR = join(OUT_DIR, 'models');
const MIRROR_DIR = join(ROOT, 'public', 'models', 'world');
const MIRROR_MANIFEST = join(MIRROR_DIR, 'manifest.json');
const HEIGHTS_CACHE = join(CACHE_DIR, 'heights.json');
const TREE_CACHE = join(CACHE_DIR, 'archive-tree.json');

const SOURCE_BASE = 'https://raw.githubusercontent.com/Pokemon-3D-api/assets/main/models/opt';
const SOURCE_REPO = 'Pokemon-3D-api/assets';
const SOURCE_TREE_URL = `https://api.github.com/repos/${SOURCE_REPO}/git/trees/main?recursive=1`;
const POKEAPI = 'https://pokeapi.co/api/v2/pokemon';
const DELAY_MS = 200; // polite fetch pacing between lanes
const DOWNLOAD_CONCURRENCY = 4;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const DOWNLOAD = flag('--download');
const TRANSFORM = flag('--transform');
const BAKE = flag('--bake');
const ALL = flag('--all');
const PROBE = flag('--probe');
const probeIndex = args.indexOf('--probe');
const PROBE_N =
  probeIndex !== -1 && Number.isFinite(Number(args[probeIndex + 1]))
    ? Math.max(1, Number(args[probeIndex + 1]))
    : 8;
const DRY_RUN = flag('--dry-run') || (!DOWNLOAD && !TRANSFORM && !BAKE && !ALL && !PROBE);
const baseLimitIndex = args.indexOf('--base-limit');
const BASE_LIMIT =
  baseLimitIndex !== -1 && Number.isFinite(Number(args[baseLimitIndex + 1]))
    ? Math.max(0, Number(args[baseLimitIndex + 1]))
    : 60;

const log = (...a) => console.log(...a);

/** App FigureForm → archive `models/opt` directory (spelling trap: `galar`). */
const FORM_TO_ARCHIVE = {
  regular: 'regular',
  alolan: 'alolan',
  galarian: 'galar',
  hisuian: 'hisuian',
  paldean: null, // no upstream directory exists
};

/** @pkmn forme prefix → app FigureForm. */
const FORME_TO_FORM = {
  Alola: 'alolan',
  Galar: 'galarian',
  Hisui: 'hisuian',
  Paldea: 'paldean',
};

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * The mirror manifest (public/models/world/manifest.json). It is untracked (a checkout does not
 * include it), so it is read lazily, only by the modes that need it, with a clear error when absent.
 */
function readMirrorManifest() {
  if (!existsSync(MIRROR_MANIFEST)) {
    throw new Error(
      `${MIRROR_MANIFEST} is missing. The world manifests are untracked: a maintainer restores them from the private companion overlay that tracks them (git --git-dir=<overlay> checkout -- public/models/world/manifest.json public/models/world/manifest.v3.json), or bake your own world-assets set first (scripts/world-assets/README.md).`,
    );
  }
  return JSON.parse(readFileSync(MIRROR_MANIFEST, 'utf8'));
}

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The pool universe, enumerated exactly like src/lib/pkmn/dex.ts (gen 9). */
export function enumeratePoolUniverse() {
  const gens = new Generations(Dex);
  const gen = gens.get(9);
  const species = [];
  for (const sp of Array.from(gen.species)) {
    if (sp.battleOnly || sp.isNonstandard) continue;
    const forme = sp.forme || '';
    species.push({
      name: sp.name,
      dexId: sp.num,
      form: FORME_TO_FORM[forme.split('-')[0]] ?? 'regular',
      isForme: forme !== '',
    });
  }
  return species;
}

/**
 * Runtime fallback-chain resolution (FigureIndex semantics): exact species or
 * alias → dash-base species. Returns the resolved FigureEntry or null.
 */
function resolveByName(bySpeciesIndex, name) {
  const hit = bySpeciesIndex.get(normalizeName(name));
  if (hit) return hit;
  const dash = name.indexOf('-');
  if (dash > 0) return bySpeciesIndex.get(normalizeName(name.slice(0, dash))) ?? null;
  return null;
}

function buildSpeciesIndex(figures) {
  const index = new Map();
  for (const f of figures) {
    const key = normalizeName(f.species);
    if (!index.has(key) || f.form === 'regular') index.set(key, f);
    for (const alias of f.aliases ?? []) {
      const aliasKey = normalizeName(alias);
      if (!index.has(aliasKey)) index.set(aliasKey, f);
    }
  }
  return index;
}

/**
 * Classify one universe entry through the fallback chain:
 *   glb     — resolves to a figure whose form matches the requested form
 *   standin — resolves to a file standing in for it (different form/sourceForm)
 *   sprite  — no resolution; the caller renders the HOME sprite billboard
 */
function classify(name, form, index) {
  const entry = resolveByName(index, name);
  if (!entry) return { resolution: 'sprite', entry: null };
  if (entry.form === form && entry.sourceForm === form) return { resolution: 'glb', entry };
  return { resolution: 'standin', entry };
}

// set by loadManifest() for classify()'s convenience
let figures_ = [];

async function fetchArchiveTree() {
  const cached = readJson(TREE_CACHE, null);
  if (cached && Array.isArray(closedTreePaths(cached))) return cached;
  log('  fetching archive tree listing (GitHub git-trees API)…');
  const res = await fetch(SOURCE_TREE_URL);
  if (!res.ok) throw new Error(`archive tree HTTP ${res.status}`);
  const json = await res.json();
  if (json.truncated) throw new Error('archive tree listing truncated');
  writeFileSync(TREE_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), tree: json.tree }));
  return { fetchedAt: new Date().toISOString(), tree: json.tree };
}

// tree cache shape guard (avoid trusting a stale/partial cache)
function closedTreePaths(cached) {
  return cached && cached.tree ? cached.tree : null;
}

function treePaths(tree) {
  return new Set(tree.tree.map((e) => e.path));
}

function treeSizes(tree) {
  return new Map(tree.tree.map((e) => [e.path, e.size ?? 0]));
}

/**
 * The tranche: every unresolved universe entry with an upstream file.
 * Regional forms always; base species capped at --base-limit (by dex num).
 */
export function planTranche(universe, index, paths) {
  const regional = [];
  const base = [];
  for (const sp of universe) {
    if (resolveByName(index, sp.name)) continue; // already resolves (glb or standin)
    const archiveDir = FORM_TO_ARCHIVE[sp.form];
    if (!archiveDir) continue; // paldean: no upstream directory at all
    const upstream = `models/opt/${archiveDir}/${sp.dexId}.glb`;
    if (!paths.has(upstream)) continue; // upstream-absent structural hole
    if (sp.form === 'regular') base.push(sp);
    else regional.push(sp);
  }
  base.sort((a, b) => a.dexId - b.dexId);
  return { regional, base: base.slice(0, BASE_LIMIT), baseRest: base.length - base.slice(0, BASE_LIMIT).length };
}

async function downloadTranche(plan) {
  const jobs = [];
  for (const sp of [...plan.regional, ...plan.base]) {
    const archiveDir = FORM_TO_ARCHIVE[sp.form];
    jobs.push({ sp, url: `${SOURCE_BASE}/${archiveDir}/${sp.dexId}.glb`, rawPath: join(RAW_DIR, sp.form, `${sp.dexId}.glb`) });
  }
  let ok = 0;
  let cached = 0;
  let bytes = 0;
  const failed = [];
  let next = 0;
  const lanes = Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (existsSync(job.rawPath) && statSync(job.rawPath).size > 0) {
        cached++;
        bytes += statSync(job.rawPath).size;
        continue;
      }
      mkdirSync(dirname(job.rawPath), { recursive: true });
      try {
        const res = await fetch(job.url);
        if (res.status === 404) {
          failed.push(`${job.sp.form}/${job.sp.dexId} ${job.sp.name}: upstream absent`);
          continue;
        }
        if (!res.ok) {
          failed.push(`${job.sp.form}/${job.sp.dexId} ${job.sp.name}: HTTP ${res.status}`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(job.rawPath, buffer);
        ok++;
        bytes += buffer.length;
        log(`  [ok] ${job.sp.form}/${job.sp.dexId} ${job.sp.name} (${Math.round(buffer.length / 1024)} KB)`);
      } catch (err) {
        failed.push(`${job.sp.form}/${job.sp.dexId} ${job.sp.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  });
  await Promise.all(lanes);
  return { ok, cached, bytes, failed, jobs };
}

async function runTransform(plan) {
  const keys = [...plan.regional, ...plan.base].map((sp) => `${sp.form}/${sp.dexId}`);
  if (keys.length === 0) return;
  log(`  transform.mjs --only ${keys.length} keys…`);
  // execFile (no shell): AGENTS.md forbids child_process.exec specifically.
  const { stdout } = await execFileP(process.execPath, [join(__dirname, 'transform.mjs'), '--only', keys.join(',')], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const tail = stdout.trim().split(/\r?\n/).slice(-12).join('\n');
  log(tail);
}

async function fetchHeight(slug, cache) {
  if (slug in cache) return cache[slug];
  try {
    const res = await fetch(`${POKEAPI}/${slug}`);
    if (!res.ok) {
      log(`  PokéAPI ${slug}: HTTP ${res.status}`);
      cache[slug] = null;
      return null;
    }
    const data = await res.json();
    cache[slug] = typeof data.height === 'number' ? data.height / 10 : null;
  } catch {
    cache[slug] = null;
  }
  return cache[slug];
}

function countTriangles(document) {
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : primitive.getAttribute('POSITION')?.getCount() ?? 0;
      triangles += Math.floor(count / 3);
    }
  }
  return triangles;
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function bake(universe, plan, tree) {
  const require = createRequire(import.meta.url);
  const { NodeIO } = require('@gltf-transform/core');
  const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
  const { getBounds } = require('@gltf-transform/core');

  const io = await registerMeshoptDecoder(new NodeIO().registerExtensions(ALL_EXTENSIONS));
  const heights = readJson(HEIGHTS_CACHE, {});
  const manifest = readMirrorManifest();
  const existingKeys = new Set(manifest.figures.map((f) => `${f.form}/${f.dexId}`));

  const newDescs = [...plan.regional, ...plan.base].filter((sp) => !existingKeys.has(`${sp.form}/${sp.dexId}`));

  // Universe grouping: aliases for cosmetic formes sharing a (form, dexId).
  const groups = new Map();
  for (const sp of universe) {
    const key = `${sp.form}/${sp.dexId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(sp);
  }

  const baked = [];
  const pendingHeights = new Set();
  for (const sp of newDescs) {
    const resolved = join(OUT_MODELS_DIR, sp.form, `${sp.dexId}.glb`);
    if (!existsSync(resolved)) {
      log(`  [bake-skip] out/models/${sp.form}/${sp.dexId}.glb missing (transform failed?)`);
      continue;
    }
    const group = groups.get(`${sp.form}/${sp.dexId}`) ?? [sp];
    // Primary name: the forme-less member for regular; the regional name otherwise.
    const primary = sp.form === 'regular' ? (group.find((g) => !g.isForme) ?? sp).name : sp.name;
    const aliases =
      sp.form === 'regular' ? group.filter((g) => g.name !== primary).map((g) => g.name) : [];
    const pokeapi =
      sp.form === 'regular' ? String(sp.dexId) : `${normalizeName(primary.split('-')[0])}-${{ alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' }[sp.form]}`;
    const document = await io.read(resolved);
    const root = document.getRoot();
    const scene = root.getDefaultScene() ?? root.listScenes()[0];
    const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    pendingHeights.add(pokeapi);
    baked.push({
      dexId: sp.dexId,
      form: sp.form,
      species: primary,
      aliases,
      file: `models/${sp.form}/${sp.dexId}.glb`,
      sourceForm: sp.form,
      kb: Math.round(statSync(resolved).size / 1024),
      heightm: null, // filled after the PokéAPI pass below
      bounds: { min: bounds.min.map((v) => round(v)), max: bounds.max.map((v) => round(v)) },
      clips: root.listAnimations().map((a) => a.getName()),
      triangles: countTriangles(document),
      __pokeapi: pokeapi,
    });
  }

  for (const entry of baked) {
    entry.heightm = await fetchHeight(entry.__pokeapi, heights);
    delete entry.__pokeapi;
  }
  writeFileSync(HEIGHTS_CACHE, JSON.stringify(heights, null, 2));

  // Merge + sort (existing entries preserved verbatim).
  const figures = [...manifest.figures, ...baked].sort(
    (a, b) => a.dexId - b.dexId || a.form.localeCompare(b.form),
  );

  // Coverage section over the MERGED figure list.
  const index = buildSpeciesIndex(figures);
  const paths = treePaths(tree);
  const counts = { glb: 0, standin: 0, sprite: 0 };
  const spriteAbsent = [];
  let spriteDeferred = 0;
  for (const sp of universe) {
    const { resolution } = classify(sp.name, sp.form, index);
    counts[resolution]++;
    if (resolution !== 'sprite') continue;
    const archiveDir = FORM_TO_ARCHIVE[sp.form];
    const upstream = archiveDir && paths.has(`models/opt/${archiveDir}/${sp.dexId}.glb`);
    if (upstream) {
      spriteDeferred++;
    } else {
      spriteAbsent.push({
        species: sp.name,
        dexId: sp.dexId,
        form: sp.form,
        reason:
          archiveDir === null
            ? 'Pokemon-3D-api archive has no paldean directory'
            : `not present in the Pokemon-3D-api archive (models/opt/${archiveDir ?? 'regular'}/${sp.dexId}.glb)`,
      });
    }
  }

  const v2 = {
    version: 2,
    generatedAt: new Date().toISOString(),
    figures,
    props: manifest.props ?? [],
    environment: manifest.environment ?? [],
    missingForms: manifest.missingForms ?? [],
    pool: {
      source: `${SOURCE_REPO} models/opt (Draco+WebP)`,
      universe: universe.length,
      glb: counts.glb,
      standin: counts.standin,
      sprite: counts.sprite,
      spriteDeferred,
      spriteAbsent,
    },
  };
  writeFileSync(MIRROR_MANIFEST, JSON.stringify(v2));

  // Copy the new transformed files into the local mirror (existing files untouched).
  let copied = 0;
  let copiedBytes = 0;
  for (const entry of baked) {
    const src = join(OUT_MODELS_DIR, entry.form, `${entry.dexId}.glb`);
    const dst = join(MIRROR_DIR, entry.file);
    mkdirSync(dirname(dst), { recursive: true });
    if (existsSync(dst)) rmSync(dst);
    cpSync(src, dst);
    copied++;
    copiedBytes += statSync(dst).size;
  }

  log(
    `baked manifest v2: +${baked.length} figures (${figures.length} total), pool coverage glb=${counts.glb} standin=${counts.standin} sprite=${counts.sprite} (deferred ${spriteDeferred}, absent ${spriteAbsent.length})`,
  );
  log(`mirrored ${copied} new GLBs (${(copiedBytes / 1024 / 1024).toFixed(1)} MB transformed)`);
}

async function printCoverageTable(label) {
  const manifest = readMirrorManifest();
  figures_ = manifest.figures;
  const index = buildSpeciesIndex(figures_);
  const universe = enumeratePoolUniverse();
  const tree = await fetchArchiveTree();
  const paths = treePaths(tree);
  const sizes = treeSizes(tree);

  const counts = { glb: 0, standin: 0, sprite: 0 };
  const absent = [];
  let deferred = 0;
  let deferredBytes = 0;
  for (const sp of universe) {
    const { resolution } = classify(sp.name, sp.form, index);
    counts[resolution]++;
    if (resolution !== 'sprite') continue;
    const archiveDir = FORM_TO_ARCHIVE[sp.form];
    const up = archiveDir && paths.has(`models/opt/${archiveDir}/${sp.dexId}.glb`);
    if (up) {
      deferred++;
      deferredBytes += sizes.get(`models/opt/${archiveDir}/${sp.dexId}.glb`) ?? 0;
    } else {
      absent.push(`${sp.form}/${sp.dexId} ${sp.name}`);
    }
  }

  const storeKb = figures_.reduce((a, f) => a + f.kb, 0);
  const plan = planTranche(universe, index, paths);
  log(`\n── Coverage table ${label} ─────────────────────────────`);
  log(`  pool universe (gen 9, battleOnly/isNonstandard excluded): ${universe.length}`);
  log(`  glb-resolved (own form):        ${counts.glb}`);
  log(`  stand-in (other form's file):   ${counts.standin}`);
  log(`  sprite-fallback (never crash):  ${counts.sprite}`);
  log(`    ├ upstream-absent (permanent): ${absent.length}`);
  log(`    └ upstream-available (deferred): ${deferred} ≈ ${(deferredBytes / 1024 / 1024).toFixed(1)} MB raw`);
  log(`  store: ${figures_.length} figures ≈ ${(storeKb / 1024).toFixed(1)} MB (manifest kb)`);
  log(`  tranche this round: ${plan.regional.length} regional + ${plan.base.length} base (--base-limit ${BASE_LIMIT}); ${plan.baseRest} base deferred`);
  if (absent.length > 0) {
    log(`  upstream-absent list:`);
    for (const a of absent) log(`    · ${a}`);
  }
  return { counts, absent, deferred };
}

/**
 * Load-time probe (criterion 1): for N mirrored figures, time
 *   local  — readFileSync of the committed mirror file (the local-full floor),
 *   cdn    — cold fetch ({cache:'no-store'}) of the same figure from the
 *            archive's CDN-class origin (raw.githubusercontent, the serving
 *            path any bucket/CDN base would approximate),
 * and report ms + bytes. Needs no dev server; upstream bytes are the
 * pre-transform raws (the transformed mirrors are not on any public origin
 * until pushed), disclosed in the round return.
 */
async function runProbe(n, paths) {
  const candidates = figures_.filter((f) => {
    const archiveDir = FORM_TO_ARCHIVE[f.sourceForm];
    return Boolean(archiveDir) && paths.has(`models/opt/${archiveDir}/${f.dexId}.glb`) && existsSync(join(MIRROR_DIR, f.file));
  });
  if (candidates.length === 0) {
    log('probe: no mirrored figures with an upstream counterpart');
    return;
  }
  const step = Math.max(1, Math.floor(candidates.length / n));
  const sample = candidates.filter((_, i) => i % step === 0).slice(0, n);
  log(`\n── Load probe (${sample.length} figures, cold fetch vs local disk) ──`);
  const rows = [];
  for (const f of sample) {
    const archiveDir = FORM_TO_ARCHIVE[f.sourceForm];
    const url = `${SOURCE_BASE}/${archiveDir}/${f.dexId}.glb`;
    const local = join(MIRROR_DIR, f.file);
    let cdn = { ok: false, status: 0, ttfb: 0, total: 0, bytes: 0 };
    try {
      const t0 = performance.now();
      const res = await fetch(url, { cache: 'no-store' });
      const ttfb = performance.now() - t0;
      const buf = Buffer.from(await res.arrayBuffer());
      cdn = { ok: res.ok, status: res.status, ttfb, total: performance.now() - t0, bytes: buf.length };
    } catch (err) {
      cdn = { ok: false, status: -1, ttfb: 0, total: 0, bytes: 0, error: err instanceof Error ? err.message : String(err) };
    }
    const t1 = performance.now();
    const localBytes = statSync(local).size;
    const localMs = performance.now() - t1;
    rows.push({ f, url, cdn, localMs, localBytes });
    log(
      `  ${f.file.padEnd(26)} ${(localBytes / 1024).toFixed(0).padStart(5)} KB  ` +
        `local ${localMs.toFixed(2).padStart(6)} ms  ` +
        (cdn.ok
          ? `cdn ${cdn.total.toFixed(0).padStart(5)} ms (ttfb ${cdn.ttfb.toFixed(0)} ms, ${(cdn.bytes / 1024).toFixed(0)} KB raw)`
          : `cdn FAIL HTTP ${cdn.status}`),
    );
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  const okRows = rows.filter((r) => r.cdn.ok);
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s[Math.floor(s.length / 2)];
  };
  const cdnKbps = okRows.map((r) => (r.cdn.bytes / 1024) / (r.cdn.total / 1000));
  const cdnMs = okRows.map((r) => r.cdn.total);
  const cdnTtfb = okRows.map((r) => r.cdn.ttfb);
  log(`  cdn: n=${okRows.length}/${rows.length} ok · median ${median(cdnMs).toFixed(0)} ms · ttfb median ${median(cdnTtfb).toFixed(0)} ms · median ${(median(cdnKbps) / 1024).toFixed(2)} MB/s`);
  log(`  local disk: median ${median(rows.map((r) => r.localMs)).toFixed(2)} ms — same-origin static in production adds HTTP but no origin fetch`);
}

async function main() {
  const universe = enumeratePoolUniverse();
  const tree = await fetchArchiveTree();
  const paths = treePaths(tree);

  if (PROBE) {
    figures_ = readMirrorManifest().figures;
    await runProbe(PROBE_N, paths);
    return;
  }

  if (DRY_RUN) {
    await printCoverageTable('(dry run — no writes)');
    return;
  }

  let plan = { regional: [], base: [], baseRest: 0 };
  if (DOWNLOAD || ALL || TRANSFORM || BAKE) {
    figures_ = readMirrorManifest().figures;
    const index = buildSpeciesIndex(figures_);
    plan = planTranche(universe, index, paths);
    log(`tranche: ${plan.regional.length} regional + ${plan.base.length} base species (${plan.baseRest} base deferred beyond --base-limit ${BASE_LIMIT})`);
  }

  if (DOWNLOAD || ALL) {
    const result = await downloadTranche(plan);
    log(`download: ok=${result.ok} cached=${result.cached} failed=${result.failed.length} bytes=${(result.bytes / 1024 / 1024).toFixed(2)} MB`);
    for (const f of result.failed) log(`  [fail] ${f}`);
  }

  if (TRANSFORM || ALL) {
    await runTransform(plan);
  }

  if (BAKE || ALL) {
    await bake(universe, plan, tree);
    await printCoverageTable('(post-bake)');
  }
}

main().catch((err) => {
  console.error(err instanceof Error && /is missing. The world manifests/.test(err.message) ? err.message : err);
  process.exit(1);
});
