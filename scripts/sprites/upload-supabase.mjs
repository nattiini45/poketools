#!/usr/bin/env node
/**
 * Publishes the broadcast sprite renders to the Supabase Storage public bucket
 * `sprites` (docs/pkmn.md, "Sprite styles"). Modelled on
 * scripts/world-assets/upload-supabase.mjs.
 *
 * DRY RUN BY DEFAULT. Nothing is uploaded, no env is read and no client is
 * created unless `--live` is passed, and a live publish runs only with the
 * maintainer's approval at upload time (AGENTS.md: automation never spends the
 * Supabase quota; no Storage publishing without a maintainer's approval).
 *
 * The publish set is every object the committed map names
 * (src/lib/pkmn/sprite-maps/broadcast.json, schema 2), read from the local
 * mirror (public/sprites/broadcast/{version}/, written by mirror-broadcast.mjs):
 *   broadcast/{version}/256/{stem}.webp and broadcast/{version}/full/{stem}.webp
 * The version is a content hash over the whole set: the mirror files must
 * hash to the map's version (scripts/sprites/lib.mjs setVersion), or nothing is
 * published. Objects are uploaded with cacheControl 31536000 (1 year) and
 * upsert: false: an object that already exists under a version path already
 * holds those bytes, so it is never overwritten. The bucket must be public (an
 * existing private bucket is refused). After the upload every mapped object is
 * listed back and one is fetched through its public URL; set versions other
 * than the map's are reported (not deleted: removing them is the maintainer's
 * call once no deployment serves them).
 *
 * Usage:
 *   node scripts/sprites/upload-supabase.mjs --plan-dir <R1>                  # R1 dry run: writes publish-plan.json
 *   node scripts/sprites/upload-supabase.mjs --live --expect-plan <R1>        # R2, maintainer approval only
 * Options:
 *   --map <file>         the map (default src/lib/pkmn/sprite-maps/broadcast.json)
 *   --mirror <dir>       the local mirror (default public/sprites/broadcast)
 *   --plan-dir <dir>     where the dry run writes publish-plan.json (default scripts/sprites/.cache/publish)
 *   --expect-plan <dir>  R2 is bound to R1: refuse unless the recomputed set equals <dir>/publish-plan.json
 *                        (paths, sizes and sha256). Required for every --live run.
 *   --dry-run            the default; accepted for clarity
 *   --live               really upload (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local)
 *
 * Exit codes: 0 ok, 1 nothing to publish / missing or mismatched files / failed uploads or verification,
 * 2 usage error.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROADCAST_MAP_FILE,
  BROADCAST_PREFIX,
  BUCKET,
  MAP_SCHEMA,
  MIRROR_DIR,
  SCRIPT_DIR,
  VARIANTS,
  log as defaultLog,
  setVersion,
  sha256,
  stableJson,
} from './lib.mjs';

export const CACHE_CONTROL = '31536000';
export const CONTENT_TYPE = 'image/webp';
const DEFAULT_PLAN_DIR = join(SCRIPT_DIR, '.cache', 'publish');
const USAGE =
  'usage: upload-supabase.mjs [--map <file>] [--mirror <dir>] [--plan-dir <dir>] [--expect-plan <dir>] [--dry-run | --live]';

/** Parse argv (without node + script). Returns { options } or { error } or { help }. */
export function parseArgs(argv) {
  const options = { live: false, dryRunFlag: false, map: null, mirror: null, planDir: null, expectPlan: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i += 1;
      return next;
    };
    if (token === '--live') options.live = true;
    else if (token === '--dry-run') options.dryRunFlag = true;
    else if (token === '--map' || token === '--mirror' || token === '--plan-dir' || token === '--expect-plan') {
      const v = value();
      if (!v) return { error: `${token} needs a path` };
      if (token === '--map') options.map = v;
      else if (token === '--mirror') options.mirror = v;
      else if (token === '--plan-dir') options.planDir = v;
      else options.expectPlan = v;
    } else if (token === '--help' || token === '-h') return { help: true };
    else return { error: `unknown argument "${token}"` };
  }
  if (options.live && options.dryRunFlag) return { error: '--live and --dry-run are mutually exclusive' };
  if (options.live && !options.expectPlan) return { error: '--live needs --expect-plan <R1 plan dir> (R2 is bound to R1\'s plan)' };
  return { options };
}

// The same shape rules as `parseBroadcastMap` in src/lib/pkmn/sprite-styles.ts:
// the version and the stems become Storage path segments, so nothing else may pass.
const KEY = /^[a-z0-9]+$/;
const STEM = /^[0-9]{1,4}(-[a-z0-9]+(-[a-z0-9]+)*)?$/;
const VERSION = /^[0-9a-f]{8,64}$/;

/** Validates the map file: schema, version and every entry's key and stem. */
export function readMap(text) {
  const map = JSON.parse(text);
  if (!map || map.schema !== MAP_SCHEMA || typeof map.entries !== 'object' || map.entries === null || Array.isArray(map.entries)) {
    throw new Error(`expected { "schema": ${MAP_SCHEMA}, "version": "<hex>", "entries": { ... } }`);
  }
  if (typeof map.version !== 'string' || !VERSION.test(map.version)) throw new Error('malformed map version');
  for (const [key, stem] of Object.entries(map.entries)) {
    if (!KEY.test(key) || typeof stem !== 'string' || !STEM.test(stem)) {
      throw new Error(`malformed map entry "${key}"`);
    }
  }
  return map;
}

/**
 * The publish set of a map: one entry per (stem, variant), sorted by path.
 * `logical` is the mirror-relative file (`{version}/{variant}/{stem}.webp`).
 * `missing`: mapped files absent from the mirror; `mismatched`: the mirror's
 * files do not hash to the map's version (a stale or edited mirror).
 */
export function buildPublishSet({ map, readFile, exists }) {
  const byPath = new Map();
  const missing = [];
  for (const [id, stem] of Object.entries(map.entries)) {
    for (const variant of VARIANTS) {
      const setRelative = `${variant}/${stem}.webp`;
      const path = `${BROADCAST_PREFIX}/${map.version}/${setRelative}`;
      if (byPath.has(path)) continue; // two ids sharing a stem publish one object
      const logical = `${map.version}/${setRelative}`;
      if (!exists(logical)) {
        missing.push(`${logical} (${id})`);
        continue;
      }
      const bytes = readFile(logical);
      byPath.set(path, {
        path,
        logical,
        setRelative,
        bytes: bytes.length,
        sha256: sha256(bytes),
        contentType: CONTENT_TYPE,
        cacheControl: CACHE_CONTROL,
      });
    }
  }
  const all = [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
  const mismatched = [];
  if (missing.length === 0) {
    const computed = setVersion(all.map((e) => ({ logical: e.setRelative, sha256: e.sha256 })));
    if (computed !== map.version) {
      mismatched.push(`the mirror's files hash to set version ${computed}, the map names ${map.version}`);
    }
  }
  const entries = all.map(({ setRelative: _setRelative, ...entry }) => entry);
  return { entries, missing: missing.sort(), mismatched };
}

/** Differences between a recomputed set and R1's plan (empty = equal). */
export function comparePlans(entries, plan) {
  const why = [];
  if (plan.bucket !== BUCKET) why.push(`plan bucket ${plan.bucket} is not ${BUCKET}`);
  const key = (e) => `${e.path} ${e.bytes} ${e.sha256}`;
  const now = new Set(entries.map(key));
  const then = new Set((plan.entries ?? []).map(key));
  for (const k of now) if (!then.has(k)) why.push(`not in R1's plan: ${k}`);
  for (const k of then) if (!now.has(k)) why.push(`in R1's plan but not in this set: ${k}`);
  return why;
}

function isAlreadyExists(error) {
  const status = String(error?.statusCode ?? error?.status ?? '');
  return status === '409' || /already exists|duplicate/i.test(error?.message ?? '');
}

/**
 * The bucket must exist and be public: a private `sprites` bucket would pass
 * the upload and the listing, then every broadcast sprite would 4xx and fall
 * back to HOME without a signal. An existing private bucket is refused (making
 * it public is the maintainer's decision, in the dashboard).
 */
export async function ensureBucket(client, log) {
  const { data, error } = await client.storage.getBucket(BUCKET);
  if (data) {
    if (data.public !== true) {
      throw new Error(`bucket ${BUCKET} exists but is not public; make it public (dashboard) or delete it, then rerun`);
    }
    return;
  }
  if (error && !/not found/i.test(error.message)) throw error;
  const created = await client.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: '2MB',
    allowedMimeTypes: [CONTENT_TYPE],
  });
  if (created.error) throw created.error;
  log(`created public bucket ${BUCKET}`);
}

/** Lists every object name under a prefix (paged). */
async function listNames(client, prefix) {
  const names = new Set();
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    for (const item of data ?? []) names.add(`${prefix}/${item.name}`);
    if (!data || data.length < limit) return names;
  }
}

/** Set versions under `broadcast/` other than `version` (folders in the listing). */
async function staleVersions(client, version) {
  const { data, error } = await client.storage.from(BUCKET).list(BROADCAST_PREFIX, { limit: 1000, offset: 0 });
  if (error) throw error;
  return (data ?? []).map((item) => item.name).filter((name) => name !== version).sort();
}

/**
 * Uploads the set (upsert: false), then verifies: every entry is listed back,
 * and one object answers through its public URL (a GET of the first byte
 * range, so a private bucket or a wrong policy cannot pass). Returns an exit code.
 */
export async function uploadLive(entries, { client, readFile, log, version, fetchImpl = globalThis.fetch, concurrency = 4 }) {
  await ensureBucket(client, log);
  const failures = [];
  let uploaded = 0;
  let existing = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
      while (next < entries.length) {
        const entry = entries[next];
        next += 1;
        const { error } = await client.storage.from(BUCKET).upload(entry.path, readFile(entry.logical), {
          contentType: entry.contentType,
          cacheControl: entry.cacheControl,
          upsert: false,
        });
        if (!error) uploaded += 1;
        else if (isAlreadyExists(error)) existing += 1;
        else {
          failures.push(entry.path);
          console.error(`  FAILED ${entry.path}: ${error.message}`);
        }
      }
    }),
  );
  log(`uploaded ${uploaded}, already present ${existing}, failed ${failures.length}`);
  if (failures.length > 0) return 1;

  const present = new Set();
  for (const variant of VARIANTS) {
    for (const name of await listNames(client, `${BROADCAST_PREFIX}/${version}/${variant}`)) present.add(name);
  }
  const absent = entries.filter((e) => !present.has(e.path)).map((e) => e.path);
  if (absent.length > 0) {
    console.error(`upload-supabase: verification failed: ${absent.length} mapped object(s) are not in the bucket:\n${absent.slice(0, 20).map((p) => `  ${p}`).join('\n')}`);
    return 1;
  }
  log(`verified: all ${entries.length} mapped objects are in bucket ${BUCKET}`);

  const probe = entries[0];
  const publicUrl = client.storage.from(BUCKET).getPublicUrl(probe.path).data.publicUrl;
  let res;
  try {
    res = await fetchImpl(publicUrl, { headers: { Range: 'bytes=0-0' } });
  } catch (err) {
    console.error(`upload-supabase: verification failed: ${publicUrl} is not reachable: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  if (!res.ok) {
    console.error(`upload-supabase: verification failed: ${publicUrl} answered HTTP ${res.status}; the bucket must serve public reads`);
    return 1;
  }
  log(`verified: ${probe.path} is publicly readable`);

  const stale = await staleVersions(client, version);
  if (stale.length > 0) {
    log(`note: ${stale.length} other set version(s) remain under ${BROADCAST_PREFIX}/ (${stale.join(', ')}); delete them in the dashboard once no deployment serves them`);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? defaultLog;
  const parsed = parseArgs(argv);
  if (parsed.help) {
    log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(`upload-supabase: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  const mapFile = resolve(options.map ?? deps.mapFile ?? BROADCAST_MAP_FILE);
  const mirrorDir = resolve(options.mirror ?? deps.mirrorDir ?? MIRROR_DIR);

  let map;
  try {
    map = readMap(readFileSync(mapFile, 'utf8'));
  } catch (err) {
    console.error(`upload-supabase: ${mapFile}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  // `logical` = `{version}/{variant}/{stem}.webp`, relative to the mirror.
  const readFile = (logical) => readFileSync(join(mirrorDir, logical));
  const set = buildPublishSet({ map, readFile, exists: (logical) => existsSync(join(mirrorDir, logical)) });
  if (set.missing.length > 0 || set.mismatched.length > 0) {
    for (const m of set.missing.slice(0, 20)) console.error(`  missing ${m}`);
    for (const m of set.mismatched) console.error(`  version mismatch: ${m}`);
    console.error(`upload-supabase: ${set.missing.length} missing and ${set.mismatched.length} mismatched file(s) in ${mirrorDir}; rerun mirror-broadcast.mjs`);
    return 1;
  }
  if (set.entries.length === 0) {
    console.error(`upload-supabase: the map names no objects (${mapFile}); refusing to publish an empty set`);
    return 1;
  }

  if (options.expectPlan) {
    const planFile = join(resolve(options.expectPlan), 'publish-plan.json');
    if (!existsSync(planFile)) {
      console.error(`upload-supabase: --expect-plan: ${planFile} does not exist`);
      return 1;
    }
    const why = comparePlans(set.entries, JSON.parse(readFileSync(planFile, 'utf8')));
    if (why.length > 0) {
      console.error(`upload-supabase: REFUSED: the recomputed publish set differs from R1's plan:\n${why.slice(0, 40).map((w) => `  - ${w}`).join('\n')}`);
      return 1;
    }
    log(`--expect-plan: the publish set equals R1's plan (${set.entries.length} objects, by sha256)`);
  }

  const totalBytes = set.entries.reduce((sum, e) => sum + e.bytes, 0);
  log(`publish set from ${mirrorDir} -> bucket ${BUCKET} (${options.live ? 'LIVE' : 'dry run'}): ${set.entries.length} objects, ${(totalBytes / 1024 / 1024).toFixed(1)} MB, max-age=${CACHE_CONTROL}`);

  if (!options.live) {
    const planDir = resolve(options.planDir ?? deps.planDir ?? DEFAULT_PLAN_DIR);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'publish-plan.json'), stableJson({ bucket: BUCKET, entries: set.entries }));
    log(`dry run: nothing uploaded. Plan written to ${join(planDir, 'publish-plan.json')}`);
    log(`a real upload (R2) needs --live --expect-plan ${planDir} and a maintainer's approval (AGENTS.md: no Storage publishing without it)`);
    return 0;
  }

  let client = deps.client ?? null;
  if (!client) {
    const { loadEnvLocal } = await import('../world-assets/lib.mjs');
    loadEnvLocal();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local) for --live');
      return 1;
    }
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    log(`NEXT_PUBLIC_SPRITES_URL=${url}/storage/v1/object/public/${BUCKET}`);
  }
  return uploadLive(set.entries, { client, readFile, log, version: map.version, fetchImpl: deps.fetch ?? globalThis.fetch });
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`upload-supabase: FAIL ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
