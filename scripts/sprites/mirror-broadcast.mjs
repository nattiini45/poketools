#!/usr/bin/env node
/**
 * Mirrors the high-resolution "broadcast" Pokémon renders for the `broadcast`
 * sprite style (docs/pkmn.md, "Sprite styles"). Offline maintainer tool; the
 * app never calls the source at runtime.
 *
 *   feed (once) -> stems -> @pkmn species ids (unmapped ones reported)
 *   -> polite GET of each original into scripts/sprites/.cache/broadcast/originals/ (resumable)
 *   -> sharp: {256,full}/{stem}.webp, staged, then moved to {version}/ where the
 *      version is a content hash over every file of the set (scripts/sprites/lib.mjs setVersion)
 *   -> local mirror public/sprites/broadcast/{version}/ (git-ignored; dev reads it through /sprites)
 *   -> src/lib/pkmn/sprite-maps/broadcast.json ({ schema: 2, version, entries: { id: stem } },
 *      names and the version only, no art; deterministic, sorted keys)
 *   -> scripts/sprites/.cache/broadcast/report.json (unmapped, duplicates, missing sources)
 *
 * DOWNLOADS NOTHING unless `--download` is passed, and a download runs only with
 * the maintainer's approval (owner ruling 2026-10-18: one-time download, then
 * self-hosted in the deployment's own Storage bucket). Without `--download` the
 * script rebuilds the variants and the map from the cache alone and refuses to
 * run when the feed is not cached yet.
 *
 * Publishing is a separate, approval-gated step: scripts/sprites/upload-supabase.mjs.
 *
 * Usage:
 *   node scripts/sprites/mirror-broadcast.mjs                 # offline rebuild from the cache
 *   node scripts/sprites/mirror-broadcast.mjs --download      # fetch the feed + missing originals (approval only)
 * Options:
 *   --download             allow network requests (feed and originals)
 *   --refresh-feed         with --download: re-fetch the feed even when it is cached
 *   --limit <n>            process only the first n mapped entries (a trial run: never prunes the
 *                          mirror; writes a map only to an explicit --map file)
 *   --concurrency <1-4>    parallel downloads (default 4, never more than 4)
 *   --delay-ms <ms>        pause per download lane between requests (default 250)
 *   --cache <dir>          download cache (default scripts/sprites/.cache/broadcast)
 *   --mirror <dir>         local mirror (default public/sprites/broadcast)
 *   --map <file>           map output (default src/lib/pkmn/sprite-maps/broadcast.json)
 *
 * Exit codes: 0 ok, 1 failures (feed invalid, downloads failed after retries), 2 usage error or
 * refused (no --download and nothing cached).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BROADCAST_MAP_FILE,
  CACHE_DIR,
  MAP_SCHEMA,
  MIRROR_DIR,
  VERSION_LENGTH,
  log as defaultLog,
  setVersion,
  sha256,
  spriteSpecies,
  stableJson,
  toID,
} from './lib.mjs';

/** The source (PokeOS archive, RK9 broadcast renders) and its metadata feed. Offline use only. */
export const FEED_URL = 'https://api.pokeos.com/api/general/data/pokemon_data';
export const SOURCE_BASE = 'https://s3.pokeos.com/pokeos-uploads/assets/pokemon/home/rk9/broadcast';
export const SOURCE_QUERY = '?v=3';
export const USER_AGENT =
  'PokeTools-sprite-mirror/1.0 (one-time offline mirror for a self-hosted deployment; https://github.com/nattiini45/poketools)';

export const MAX_CONCURRENCY = 4;
export const MAX_ATTEMPTS = 4;
const STEM_RE = /^[0-9]{1,4}(-[a-z0-9]+)*$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A set-version directory of the mirror (`{mirror}/{version}/`). */
const VERSION_DIR_RE = new RegExp(`^[0-9a-f]{${VERSION_LENGTH}}$`);
/** Staging directories (`{mirror}/.staging-{pid}`); one left by a crashed run is pruned by a full run. */
const STAGING_DIR_RE = /^\.staging-([0-9]+)$/;
/** Schema-1 mirror files (`{mirror}/{256|full}/{stem}.{hash}.webp`), pruned by a full run. */
const SCHEMA1_VARIANT_FILE_RE = /^([0-9]{1,4}(?:-[a-z0-9]+)*)\.([0-9a-f]+)\.webp$/;

const USAGE =
  'usage: mirror-broadcast.mjs [--download [--refresh-feed]] [--limit <n>] [--concurrency <1-4>] [--delay-ms <ms>] [--cache <dir>] [--mirror <dir>] [--map <file>]';

/** Parse argv (without node + script). Returns { options } or { error } or { help }. */
export function parseArgs(argv) {
  const options = {
    download: false,
    refreshFeed: false,
    limit: null,
    concurrency: MAX_CONCURRENCY,
    delayMs: 250,
    cache: null,
    mirror: null,
    map: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return null;
      i += 1;
      return next;
    };
    const int = (name, min, max) => {
      const raw = value();
      const n = raw === null ? NaN : Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) return { error: `${name} must be an integer from ${min} to ${max}` };
      return { n };
    };
    if (token === '--download') options.download = true;
    else if (token === '--refresh-feed') options.refreshFeed = true;
    else if (token === '--limit') {
      const r = int('--limit', 1, 100_000);
      if (r.error) return r;
      options.limit = r.n;
    } else if (token === '--concurrency') {
      const r = int('--concurrency', 1, MAX_CONCURRENCY);
      if (r.error) return r;
      options.concurrency = r.n;
    } else if (token === '--delay-ms') {
      const r = int('--delay-ms', 0, 60_000);
      if (r.error) return r;
      options.delayMs = r.n;
    } else if (token === '--cache' || token === '--mirror' || token === '--map') {
      const v = value();
      if (!v) return { error: `${token} needs a path` };
      options[token.slice(2)] = v;
    } else if (token === '--help' || token === '-h') return { help: true };
    else return { error: `unknown argument "${token}"` };
  }
  if (options.refreshFeed && !options.download) return { error: '--refresh-feed needs --download' };
  return { options };
}

// ─── Feed -> stems -> @pkmn ids ────────────────────────────────────

/** The file stem of a feed row: `{number}` or `{number}-{form_identifier}`; null when unusable. */
export function stemOf(row) {
  if (!row || !Number.isInteger(row.number) || row.number <= 0) return null;
  const form = typeof row.form_identifier === 'string' ? row.form_identifier.trim() : '';
  const stem = form ? `${row.number}-${form}` : String(row.number);
  return STEM_RE.test(stem) ? stem : null;
}

/** The feed's rows; throws on a shape the script does not understand (never guesses). */
export function parseFeed(raw) {
  const rows = raw && Array.isArray(raw.data) ? raw.data : null;
  if (!rows) throw new Error('feed: expected { data: [...] }');
  return rows;
}

/**
 * Maps feed rows to @pkmn species ids. A row maps when @pkmn/dex knows its
 * `identifier` with the same national dex number. Several rows on one id: the
 * default form (`is_default`) wins, else the smallest stem; the others are
 * reported as duplicates. Output is sorted (deterministic).
 */
export function mapFeedToSpecies(rows, dex) {
  const known = new Map(spriteSpecies(dex).map((s) => [s.id, s]));
  const chosen = new Map();
  const unmapped = [];
  const invalid = [];
  const duplicates = [];
  for (const row of rows) {
    const stem = stemOf(row);
    if (!stem) {
      invalid.push({ identifier: String(row?.identifier ?? ''), number: row?.number ?? null, form: row?.form_identifier ?? null });
      continue;
    }
    const identifier = typeof row.identifier === 'string' ? row.identifier : '';
    const looked = identifier ? dex.species.get(identifier) : null;
    const species = looked?.exists ? known.get(looked.id) : identifier ? known.get(toID(identifier)) : undefined;
    if (!species || species.num !== row.number) {
      unmapped.push({ identifier: String(row.identifier ?? ''), stem });
      continue;
    }
    const candidate = { id: species.id, stem, isDefault: row.is_default === true };
    const current = chosen.get(species.id);
    if (!current) {
      chosen.set(species.id, candidate);
      continue;
    }
    const better =
      candidate.isDefault !== current.isDefault ? candidate.isDefault : candidate.stem < current.stem;
    duplicates.push({ id: species.id, kept: better ? candidate.stem : current.stem, dropped: better ? current.stem : candidate.stem });
    if (better) chosen.set(species.id, candidate);
  }
  const byStem = (a, b) => (a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0);
  const entries = [...chosen.values()].map(({ id, stem }) => ({ id, stem })).sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    entries,
    unmapped: unmapped.sort(byStem),
    invalid,
    duplicates: duplicates.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

// ─── Polite download ───────────────────────────────────────────────

function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  const seconds = raw ? Number(raw) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, 120) * 1000 : null;
}

/**
 * GET with the identifying User-Agent. 429 / 5xx / network errors retry with
 * exponential backoff (honouring Retry-After) up to MAX_ATTEMPTS; a 404 is a
 * definite "no such file" (not retried). Returns { status, body } or
 * { status: 'error', error }.
 */
export async function politeGet(url, { fetchImpl, sleep, backoffMs = 1000, accept }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let res = null;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } });
      if (res.status === 404) return { status: 404 };
      if (res.status !== 429 && res.status < 500) {
        if (!res.ok) return { status: 'error', error: `HTTP ${res.status}` };
        // The body read is part of the attempt: a stream that breaks mid-body
        // is a network error like a refused connection, so it is retried too.
        return { status: 200, body: Buffer.from(await res.arrayBuffer()) };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      res = null;
    }
    if (attempt < MAX_ATTEMPTS) await sleep((res && retryAfterMs(res)) ?? backoffMs * 2 ** (attempt - 1));
  }
  return { status: 'error', error: lastError ?? 'unknown error' };
}

async function lanes(items, limit, worker) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        await worker(items[index]);
      }
    }),
  );
}

function writeAtomic(file, bytes) {
  const tmp = `${file}.part`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}

// ─── Variants ──────────────────────────────────────────────────────


/** The two WebP variants of one original: 256 px (fit inside, never enlarged) and full size. */
export async function makeVariants(sharp, original) {
  const thumb = await sharp(original)
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 6 })
    .toBuffer();
  const full = await sharp(original).webp({ quality: 90, effort: 6 }).toBuffer();
  return { thumb, full };
}

/**
 * Whether `pid` names a running process. `process.kill(pid, 0)` sends no
 * signal: ESRCH means no such process, EPERM means it runs under another user.
 * Any other error is unexpected and propagates.
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === 'ESRCH') return false;
    if (err && err.code === 'EPERM') return true;
    throw err;
  }
}

/**
 * Deletes what the current set does not use: other set-version directories,
 * staging directories left by a crashed run (`.staging-{pid}` whose process is
 * gone; a live one belongs to a concurrent run and stays) and schema-1 files
 * (`{256|full}/{stem}.{hash}.webp`). Anything else in the mirror is not ours
 * and stays. Only a full run (no --limit) calls this.
 */
function prune(mirrorDir, version, log, isAlive = isProcessAlive) {
  let removed = 0;
  for (const name of readdirSync(mirrorDir)) {
    const staging = STAGING_DIR_RE.exec(name);
    const staleSet = VERSION_DIR_RE.test(name) && name !== version;
    const staleStaging = staging !== null && Number(staging[1]) !== process.pid && !isAlive(Number(staging[1]));
    if (staleSet || staleStaging) {
      rmSync(join(mirrorDir, name), { recursive: true, force: true });
      removed += 1;
    }
  }
  for (const sub of ['256', 'full']) {
    const dir = join(mirrorDir, sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!SCHEMA1_VARIANT_FILE_RE.test(name)) continue;
      rmSync(join(dir, name));
      removed += 1;
    }
  }
  if (removed > 0) log(`pruned ${removed} stale set director(ies) or file(s) from ${mirrorDir}`);
  return removed;
}

// ─── Main ──────────────────────────────────────────────────────────

export async function main(argv = process.argv.slice(2), deps = {}) {
  const log = deps.log ?? defaultLog;
  const parsed = parseArgs(argv);
  if (parsed.help) {
    log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(`mirror-broadcast: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { options } = parsed;
  const cacheDir = resolve(options.cache ?? deps.cacheDir ?? CACHE_DIR);
  const mirrorDir = resolve(options.mirror ?? deps.mirrorDir ?? MIRROR_DIR);
  const mapFile = options.map ? resolve(options.map) : options.limit === null ? resolve(deps.mapFile ?? BROADCAST_MAP_FILE) : null;
  const originalsDir = join(cacheDir, 'originals');
  const feedFile = join(cacheDir, 'feed.json');
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const dex = deps.Dex ?? (await import('@pkmn/dex')).Dex;
  const sharp = deps.sharp ?? (await import('sharp')).default;

  // 1. Feed: cached, or fetched once with --download.
  if (!existsSync(feedFile) || options.refreshFeed) {
    if (!options.download) {
      console.error(
        `mirror-broadcast: REFUSED: ${feedFile} is not cached and --download was not passed. ` +
          'Downloading from the source needs the maintainer\'s approval; rerun with --download once approved.',
      );
      return 2;
    }
    mkdirSync(cacheDir, { recursive: true });
    log(`fetching feed ${FEED_URL}`);
    const got = await politeGet(FEED_URL, { fetchImpl, sleep, backoffMs: deps.backoffMs, accept: 'application/json' });
    if (got.status !== 200) {
      console.error(`mirror-broadcast: feed fetch failed (${got.status === 404 ? 'HTTP 404' : got.error})`);
      return 1;
    }
    let json;
    try {
      json = JSON.parse(got.body.toString('utf8'));
      parseFeed(json);
    } catch (err) {
      console.error(`mirror-broadcast: feed is not the expected JSON: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    writeAtomic(feedFile, `${JSON.stringify(json)}\n`);
  }

  let rows;
  try {
    rows = parseFeed(JSON.parse(readFileSync(feedFile, 'utf8')));
  } catch (err) {
    console.error(`mirror-broadcast: cached feed ${feedFile} is unreadable: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
  const mapped = mapFeedToSpecies(rows, dex);
  const work = options.limit === null ? mapped.entries : mapped.entries.slice(0, options.limit);
  log(`feed: ${rows.length} rows, ${mapped.entries.length} mapped, ${mapped.unmapped.length} unmapped, ${mapped.invalid.length} invalid, ${mapped.duplicates.length} duplicate(s)`);

  // 2. Originals: cached, else (with --download) fetched politely.
  mkdirSync(originalsDir, { recursive: true });
  const missingSource = [];
  const notCached = [];
  const failed = [];
  const toFetch = work.filter((e) => !existsSync(join(originalsDir, `${e.stem}.png`)));
  if (toFetch.length > 0 && !options.download) {
    for (const e of toFetch) notCached.push(e.stem);
    log(`${toFetch.length} original(s) not cached; run with --download (approval only) to fetch them`);
  } else if (toFetch.length > 0) {
    log(`downloading ${toFetch.length} original(s), concurrency ${options.concurrency}`);
    await lanes(toFetch, options.concurrency, async (entry) => {
      const url = `${SOURCE_BASE}/${entry.stem}.png${SOURCE_QUERY}`;
      const got = await politeGet(url, { fetchImpl, sleep, backoffMs: deps.backoffMs, accept: 'image/png' });
      if (got.status === 404) missingSource.push(entry.stem);
      else if (got.status !== 200) failed.push({ stem: entry.stem, error: got.error });
      else if (!got.body.subarray(0, 8).equals(PNG_SIGNATURE)) failed.push({ stem: entry.stem, error: 'not a PNG' });
      else writeAtomic(join(originalsDir, `${entry.stem}.png`), got.body);
      if (options.delayMs > 0) await sleep(options.delayMs);
    });
  }

  // 3. Variants into a staging directory, then the content-versioned set.
  mkdirSync(mirrorDir, { recursive: true });
  const stagingDir = join(mirrorDir, `.staging-${process.pid}`);
  rmSync(stagingDir, { recursive: true, force: true });
  for (const sub of ['256', 'full']) mkdirSync(join(stagingDir, sub), { recursive: true });
  const entries = {};
  const files = [];
  const staged = new Set();
  for (const entry of work) {
    const originalFile = join(originalsDir, `${entry.stem}.png`);
    if (!existsSync(originalFile)) continue;
    let variants;
    try {
      variants = await makeVariants(sharp, readFileSync(originalFile));
    } catch (err) {
      failed.push({ stem: entry.stem, error: `sharp: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    for (const [sub, bytes] of [['256', variants.thumb], ['full', variants.full]]) {
      const logical = `${sub}/${entry.stem}.webp`;
      if (staged.has(logical)) continue; // two ids sharing a stem publish one file
      staged.add(logical);
      writeFileSync(join(stagingDir, logical), bytes);
      files.push({ logical, sha256: sha256(bytes) });
    }
    entries[entry.id] = entry.stem;
  }
  const version = setVersion(files);
  const versionDir = join(mirrorDir, version);
  // Same version = same bytes; replacing the directory keeps a half-written earlier run from surviving.
  rmSync(versionDir, { recursive: true, force: true });
  renameSync(stagingDir, versionDir);
  log(`set ${version}: ${files.length} file(s) -> ${versionDir}`);

  // A --limit trial never prunes: the mirror keeps the full set the committed map names.
  if (options.limit === null) prune(mirrorDir, version, log, deps.isProcessAlive);
  if (mapFile) {
    writeFileSync(mapFile, stableJson({ schema: MAP_SCHEMA, version, entries }));
    log(`map: ${Object.keys(entries).length} entries, version ${version} -> ${mapFile}`);
  }
  if (options.limit !== null) log(`trial run (--limit): nothing pruned${mapFile ? '' : ', no map written'}`);

  const sorted = (list) => [...list].sort();
  const report = {
    feedRows: rows.length,
    mapped: mapped.entries.length,
    processed: Object.keys(entries).length,
    unmapped: mapped.unmapped,
    invalid: mapped.invalid,
    duplicates: mapped.duplicates,
    missingSource: sorted(missingSource),
    notCached: sorted(notCached),
    failed: [...failed].sort((a, b) => (a.stem < b.stem ? -1 : 1)),
  };
  writeFileSync(join(cacheDir, 'report.json'), stableJson(report));
  log(`report: ${join(cacheDir, 'report.json')} (missing at source ${missingSource.length}, not cached ${notCached.length}, failed ${failed.length})`);
  if (failed.length > 0) {
    console.error(`mirror-broadcast: ${failed.length} original(s) failed; rerun to retry (cached files are kept)`);
    return 1;
  }
  return 0;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`mirror-broadcast: FAIL ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
