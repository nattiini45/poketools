#!/usr/bin/env node
/**
 * fetch-private-assets.mjs
 *
 * Three folders are not distributed by this repository: two of third-party art (see NOTICE.md),
 * `public/avatar/` (trainer sprite layers) and `public/models/draft-room/` (Pokémon GLBs), and
 * the private format pack `src/format-packs/private/` (a league's tuning; docs/format-packs.md).
 * A public checkout builds with generated placeholder avatars
 * (scripts/generate-placeholder-avatars.mjs) and the public example format pack instead. A
 * deployment that holds the real files in a private GitHub repository can fetch them at build
 * time (the pack's `__tests__/` are never extracted: a build does not need them):
 *
 *   PRIVATE_ASSETS_REPO      owner/name of the private repo that holds the three folders
 *                            at the same paths. Empty (the default) = skip.
 *   PRIVATE_ASSETS_REF       branch, tag or commit SHA to fetch (default: main).
 *   PRIVATE_ASSETS_TOKEN     GitHub token with read access to that repo's contents.
 *                            Never logged.
 *   ALLOW_PLACEHOLDER_ASSETS set to 1 to let a Vercel production build
 *                            (VERCEL_ENV=production) ship placeholders.
 *
 * Behaviour:
 *   - no token, not a Vercel production build      -> notice, skip (exit 0)
 *   - no token, Vercel production build            -> fail (exit 1) unless ALLOW_PLACEHOLDER_ASSETS=1
 *   - token set, repo empty or malformed / bad ref -> fail (exit 1)
 *   - token set, download or extraction fails, or
 *     any folder is absent from the tarball        -> fail (exit 1)
 *   - token set, success                           -> the folders written into the build tree
 *
 * It downloads the repo tarball through the GitHub REST API and extracts ONLY
 * regular files under the three folders (pure Node: zlib + a minimal tar reader; no
 * shell, no child processes). Existing files at those paths are replaced.
 * Runs first in `prebuild`, before the placeholder step and before `next build` evaluates
 * next.config.mjs, which picks the private format pack when its entry file exists
 * (FORMAT_PACK=private makes a missing pack a hard error there).
 *
 * Usage: node scripts/fetch-private-assets.mjs
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ASSET_PREFIXES = ['public/avatar/', 'public/models/draft-room/', 'src/format-packs/private/'];
/** Paths under an asset prefix that are never extracted (the pack's companion tests). */
export const EXCLUDED_PREFIXES = ['src/format-packs/private/__tests__/'];
/** Cap on the downloaded (compressed) tarball, enforced while streaming the body. */
export const MAX_TARBALL_BYTES = 512 * 1024 * 1024;
export const MAX_DOWNLOAD_BYTES = MAX_TARBALL_BYTES;
/** Cap on the gunzipped tarball, enforced by zlib (maxOutputLength). */
export const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;

/** A size cap was exceeded; its message is fixed text and never carries the token. */
export class SizeLimitError extends Error {}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9._/-]+$/;

function flagOn(value) {
  return value === '1' || String(value ?? '').toLowerCase() === 'true';
}

/**
 * Decide what to do from the environment alone.
 * Returns { action: 'skip' | 'fetch' | 'fail', message, repo?, ref? }.
 */
export function decide(env) {
  const token = (env.PRIVATE_ASSETS_TOKEN ?? '').trim();
  const repo = (env.PRIVATE_ASSETS_REPO ?? '').trim();
  const ref = (env.PRIVATE_ASSETS_REF ?? '').trim() || 'main';
  const vercelProd = env.VERCEL_ENV === 'production';
  const allowPlaceholders = flagOn(env.ALLOW_PLACEHOLDER_ASSETS);

  if (!token) {
    if (vercelProd && !allowPlaceholders) {
      return {
        action: 'fail',
        message:
          'production build without PRIVATE_ASSETS_TOKEN: set PRIVATE_ASSETS_REPO and PRIVATE_ASSETS_TOKEN to ship the real assets, or ALLOW_PLACEHOLDER_ASSETS=1 to ship placeholders',
      };
    }
    return {
      action: 'skip',
      message: repo
        ? 'PRIVATE_ASSETS_REPO is set but PRIVATE_ASSETS_TOKEN is not; skipping (placeholder avatar layers and the example format pack will be used)'
        : 'no private asset source configured; skipping (placeholder avatar layers and the example format pack will be used)',
    };
  }
  if (!repo) return { action: 'fail', message: 'PRIVATE_ASSETS_TOKEN is set but PRIVATE_ASSETS_REPO is empty (expected owner/name)' };
  if (!REPO_RE.test(repo)) return { action: 'fail', message: 'PRIVATE_ASSETS_REPO must look like owner/name' };
  if (!REF_RE.test(ref) || ref.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return { action: 'fail', message: 'PRIVATE_ASSETS_REF is not a valid branch, tag or SHA' };
  }
  return { action: 'fetch', message: `fetching private assets from ${repo}@${ref}`, repo, ref };
}

/**
 * Map a tarball entry name ("<owner>-<repo>-<sha>/public/avatar/x.png") to its
 * repo-relative path, or null when it is outside the allowed folders, excluded or unsafe.
 */
export function assetPathFor(entryName) {
  if (typeof entryName !== 'string' || entryName.includes('\0') || entryName.includes('\\')) return null;
  const parts = entryName.split('/');
  if (parts.length < 2) return null;
  const rest = parts.slice(1);
  if (rest.some((s) => s === '' || s === '.' || s === '..')) return null;
  const rel = rest.join('/');
  if (/^[A-Za-z]:/.test(rel)) return null;
  if (EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) return null;
  return ASSET_PREFIXES.some((p) => rel.startsWith(p)) ? rel : null;
}

function readString(buf, start, len) {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function readOctal(buf, start, len) {
  const text = readString(buf, start, len).trim();
  if (!/^[0-7]*$/.test(text)) throw new Error('tarball has an unsupported size field');
  return text === '' ? 0 : parseInt(text, 8);
}

function parsePax(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space === -1) break;
    const len = parseInt(data.subarray(i, space).toString('utf8'), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.subarray(space + 1, i + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/** Yield { name, type, data } for each entry of an uncompressed tar buffer. */
export function* readTar(buf) {
  let offset = 0;
  let nextName = null;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) return;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    let name = readString(header, 0, 100);
    if (readString(header, 257, 5) === 'ustar') {
      const prefix = readString(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const dataStart = offset + 512;
    if (dataStart + size > buf.length) throw new Error('tarball is truncated');
    const data = buf.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      nextName = parsePax(data).path ?? nextName;
      continue;
    }
    if (type === 'L') {
      nextName = readString(data, 0, data.length);
      continue;
    }
    if (type === 'g') continue;
    yield { name: nextName ?? name, type, data };
    nextName = null;
  }
}

/**
 * Gunzip with a bound on the output size. Throws SizeLimitError past maxUnpackedBytes.
 */
function gunzipBounded(gzBuffer, maxUnpackedBytes) {
  try {
    return gunzipSync(gzBuffer, { maxOutputLength: maxUnpackedBytes });
  } catch (err) {
    if (err instanceof RangeError || (err && typeof err === 'object' && err.code === 'ERR_BUFFER_TOO_LARGE')) {
      throw new SizeLimitError('tarball too large when unpacked');
    }
    throw err;
  }
}

/**
 * Read a fetch Response body as a stream, aborting once more than maxBytes arrive.
 * Throws SizeLimitError past the cap.
 */
export async function readBodyBounded(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') throw new Error('download returned no body');
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SizeLimitError('tarball is larger than the allowed maximum');
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, total);
}

/**
 * Write every allowed regular file of a tar.gz buffer under root. Returns per-prefix counts.
 * Throws SizeLimitError when the tarball unpacks to more than maxUnpackedBytes.
 */
export function extractAssets(gzBuffer, root, { maxUnpackedBytes = MAX_UNPACKED_BYTES } = {}) {
  const base = resolve(root);
  const counts = Object.fromEntries(ASSET_PREFIXES.map((p) => [p, 0]));
  for (const entry of readTar(gunzipBounded(gzBuffer, maxUnpackedBytes))) {
    if (entry.type !== '0' && entry.type !== '\0') continue;
    const rel = assetPathFor(entry.name);
    if (!rel) continue;
    const target = resolve(base, ...rel.split('/'));
    if (!target.startsWith(base + sep)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
    counts[ASSET_PREFIXES.find((p) => rel.startsWith(p))]++;
  }
  return counts;
}

function redact(text, token) {
  const s = String(text);
  return token ? s.split(token).join('[redacted]') : s;
}

/**
 * Run the fetch. Injected env/fetch/root keep it testable without network.
 * Resolves to the process exit code (0 or 1).
 */
export async function run({
  env = process.env,
  fetchImpl = globalThis.fetch,
  root = ROOT,
  log = console,
  maxDownloadBytes = MAX_DOWNLOAD_BYTES,
  maxUnpackedBytes = MAX_UNPACKED_BYTES,
} = {}) {
  const decision = decide(env);
  if (decision.action === 'skip') {
    log.log(`[private-assets] ${decision.message}`);
    return 0;
  }
  if (decision.action === 'fail') {
    log.error(`[private-assets] ${decision.message}`);
    return 1;
  }
  const token = env.PRIVATE_ASSETS_TOKEN.trim();
  log.log(`[private-assets] ${decision.message}`);
  try {
    const url = `https://api.github.com/repos/${decision.repo}/tarball/${decision.ref.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'plc-toolkit-fetch-private-assets',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      log.error(`[private-assets] download failed: HTTP ${res.status} (check PRIVATE_ASSETS_REPO, PRIVATE_ASSETS_REF and the token's access)`);
      return 1;
    }
    const declared = Number(res.headers?.get?.('content-length') ?? 0);
    if (declared > maxDownloadBytes) {
      log.error('[private-assets] tarball is larger than the allowed maximum');
      return 1;
    }
    // Streamed with a running count: the cap bounds memory, not just the final size.
    const body = await readBodyBounded(res, maxDownloadBytes);
    const counts = extractAssets(body, root, { maxUnpackedBytes });
    const missing = ASSET_PREFIXES.filter((p) => counts[p] === 0);
    if (missing.length > 0) {
      log.error(`[private-assets] the tarball has no files under ${missing.join(', ')}`);
      return 1;
    }
    log.log(`[private-assets] extracted ${ASSET_PREFIXES.map((p) => `${counts[p]} file(s) under ${p}`).join(', ')}`);
    return 0;
  } catch (err) {
    if (err instanceof SizeLimitError) {
      log.error(`[private-assets] ${err.message}`);
      return 1;
    }
    log.error(`[private-assets] fetch failed: ${redact(err instanceof Error ? err.message : err, token)}`);
    return 1;
  }
}

// Run only when executed directly. Compare real paths on both sides: Node realpaths the main
// module, so a checkout reached through a junction, symlink or subst drive would otherwise
// never match process.argv[1] and the script would silently do nothing.
function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    const self = realpathSync.native(fileURLToPath(import.meta.url));
    const invoked = realpathSync.native(resolve(process.argv[1]));
    return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  run().then((code) => {
    process.exitCode = code;
  });
}
