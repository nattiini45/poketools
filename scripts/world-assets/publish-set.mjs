/**
 * The world-assets PUBLISH SET (DATA-PLAN fix 7, design decision D37).
 *
 * The local mirror (`public/models/world`) and the dev loop keep logical names
 * (`models/regular/4.glb`, `env/hdri/gold.jpg`). Only what goes to the
 * `world-assets` bucket is renamed: every asset the manifest references is
 * published under a content-hashed name (`models/regular/4.<hash>.glb`) with
 * a one-year cache, and a rewritten manifest points at those names. A
 * republish therefore never serves a stale asset, and a repeat visit needs no
 * asset request at all. The manifest itself keeps its fixed name and is
 * published with `max-age=0`, so the client (`cache: 'no-cache'`) revalidates
 * it by ETag on every page.
 *
 * What the app resolves how (read before changing the rewrite rules):
 *  - figures[].file and props[].file go through `figureUrl` / `propUrl`
 *    (`src/lib/route-world/model-manifest.ts`), which use `entry.file` as is.
 *    The published manifest rewrites them to the hashed names.
 *  - environment[] files are looked up BY LOGICAL NAME in
 *    `src/lib/route-world/world-env.ts` (`env/hdri/gold.jpg`,
 *    `env/tex/<role>/diff.webp`, `env/kit/<bay>.glb`, ...). Their `file`
 *    stays logical, and each env file is ALSO published under its logical
 *    name with the old one-day cache (a "compat" copy) until world-env
 *    resolves through the manifest's `files` map. `envCompat: false` drops
 *    those copies once it does.
 *  - `files` (new, additive) maps each ENVIRONMENT file's logical name to its
 *    hashed name (figures and props already carry theirs in `file`, so they
 *    stay out of the map and the manifest stays small). `isManifest` in the
 *    app only checks `version` and `figures`, so older clients ignore it.
 *  - The published manifest is compact JSON (it is fetched on every world
 *    visit; about 140 KB against 280 KB indented).
 *
 * Pure functions only: no fs, no network. `upload-supabase.mjs` feeds them.
 */

import { createHash } from 'node:crypto';

/** One year: hashed names never change content, so they never need revalidation. */
export const HASHED_CACHE_CONTROL = '31536000';
/** The manifest keeps its name: max-age=0 forces an ETag revalidation. */
export const MANIFEST_CACHE_CONTROL = '0';
/** Logical-name copies (env compat, attribution): the pre-D37 one-day cache. */
export const LOGICAL_CACHE_CONTROL = '86400';
/** Hex characters of the sha256 kept in a published name (48 bits). */
export const HASH_LENGTH = 12;

export const MANIFEST_FILE = 'manifest.json';

const CONTENT_TYPES = {
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.json': 'application/json',
  '.hdr': 'image/vnd.radiance',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.exr': 'image/x-exr',
  '.md': 'text/markdown; charset=utf-8',
};

function extensionOf(path) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash + 1 ? path.slice(dot) : '';
}

export function contentTypeFor(path) {
  return CONTENT_TYPES[extensionOf(path).toLowerCase()] ?? 'application/octet-stream';
}

export function contentHash(bytes, length = HASH_LENGTH) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, length);
}

/**
 * `models/regular/4.glb` + hash → `models/regular/4.<hash>.glb`. The folder
 * and the extension stay (loaders pick by extension), the hash goes before it.
 */
export function hashedPath(logical, hash) {
  const ext = extensionOf(logical);
  const stem = ext ? logical.slice(0, -ext.length) : logical;
  return `${stem}.${hash}${ext}`;
}

/** Every file the manifest makes the app load, in manifest order, de-duplicated. */
export function manifestAssetFiles(manifest) {
  const seen = new Set();
  const out = [];
  const add = (section, entry) => {
    const file = typeof entry?.file === 'string' ? entry.file : null;
    if (!file || seen.has(file)) return;
    seen.add(file);
    out.push({ file, section });
  };
  for (const entry of manifest?.figures ?? []) add('figures', entry);
  for (const entry of manifest?.props ?? []) add('props', entry);
  for (const entry of manifest?.environment ?? []) add('environment', entry);
  return out;
}

/** `--only` filter: which logical files a partial publish keeps. */
export const ONLY_SCOPES = ['models', 'props', 'env', 'manifest'];

function inScope(file, only) {
  if (!only) return true;
  if (only === 'manifest') return false;
  return file.startsWith(`${only}/`);
}

/**
 * Build the publish set.
 *
 * @param {object} input
 * @param {object} input.manifest  the source manifest (logical names)
 * @param {string[]} input.files   every file under the source dir, POSIX-relative
 * @param {(file: string) => Uint8Array} input.readBytes  bytes of a source file
 * @param {boolean} [input.envCompat=true]  also publish env files under their logical names
 * @param {string|null} [input.only=null]    one of ONLY_SCOPES
 * @param {string[]} [input.extraLogical=['ATTRIBUTION.md']]  unreferenced files published as is
 * @param {string} [input.sourceManifest=MANIFEST_FILE]  the source manifest's file name (D42 commit P: manifest.v3.json
 *   in the promoted mirror); it and manifest.json are descriptors, never published or listed as skipped
 * @returns {{ entries: object[], manifest: object, manifestBytes: Uint8Array, missing: string[], skipped: string[], files: Record<string,string> }}
 */
export function buildPublishSet({ manifest, files, readBytes, envCompat = true, only = null, extraLogical = ['ATTRIBUTION.md'], sourceManifest = MANIFEST_FILE }) {
  if (only !== null && !ONLY_SCOPES.includes(only)) throw new Error(`unknown --only scope "${only}" (use ${ONLY_SCOPES.join('|')})`);
  const present = new Set(files);
  const assets = manifestAssetFiles(manifest);
  const missing = assets.filter((a) => !present.has(a.file)).map((a) => a.file);

  const map = {};
  const envFiles = new Set(assets.filter((a) => a.section === 'environment').map((a) => a.file));
  const entries = [];
  for (const { file, section } of assets) {
    if (!present.has(file)) continue;
    const bytes = readBytes(file);
    const path = hashedPath(file, contentHash(bytes));
    map[file] = path;
    if (!inScope(file, only)) continue;
    entries.push({ logical: file, path, section, kind: 'hashed', bytes: bytes.length, contentType: contentTypeFor(file), cacheControl: HASHED_CACHE_CONTROL });
    if (envCompat && section === 'environment') {
      entries.push({ logical: file, path: file, section, kind: 'compat', bytes: bytes.length, contentType: contentTypeFor(file), cacheControl: LOGICAL_CACHE_CONTROL });
    }
  }

  const referenced = new Set(assets.map((a) => a.file));
  const skipped = [];
  for (const file of files) {
    if (file === MANIFEST_FILE || file === sourceManifest || referenced.has(file)) continue;
    if (extraLogical.includes(file)) {
      if (only === null) {
        entries.push({ logical: file, path: file, section: null, kind: 'doc', bytes: readBytes(file).length, contentType: contentTypeFor(file), cacheControl: LOGICAL_CACHE_CONTROL });
      }
      continue;
    }
    skipped.push(file);
  }

  const rewrite = (entry) => (entry && typeof entry.file === 'string' && map[entry.file] ? { ...entry, file: map[entry.file] } : entry);
  const published = {
    ...manifest,
    figures: (manifest?.figures ?? []).map(rewrite),
    props: (manifest?.props ?? []).map(rewrite),
    // Logical on purpose: world-env.ts matches env files by logical name.
    environment: manifest?.environment ?? [],
    files: Object.fromEntries(Object.entries(map).filter(([file]) => envFiles.has(file))),
    publish: { hashed: true, hashLength: HASH_LENGTH, envCompat },
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(published));
  if (only === null || only === 'manifest') {
    entries.push({ logical: MANIFEST_FILE, path: MANIFEST_FILE, section: null, kind: 'manifest', bytes: manifestBytes.length, contentType: contentTypeFor(MANIFEST_FILE), cacheControl: MANIFEST_CACHE_CONTROL });
  }
  return { entries, manifest: published, manifestBytes, missing, skipped, files: map };
}

/**
 * Upload order for a live publish: immutable hashed assets first, then the
 * logical copies, and the manifest LAST, so a published manifest never names
 * an object that is not there yet.
 */
export function uploadPhases(entries) {
  return {
    assets: entries.filter((e) => e.kind === 'hashed'),
    logical: entries.filter((e) => e.kind === 'compat' || e.kind === 'doc'),
    manifest: entries.filter((e) => e.kind === 'manifest'),
  };
}
