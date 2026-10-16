#!/usr/bin/env node

/**
 * deploy-avatar-sprites.mjs
 *
 * Scans a source folder of layered trainer sprites (one folder per gender,
 * e.g. "trainer front female"), copies them to `public/avatar/` with URL-safe
 * filenames, and writes a generated manifest JSON that the TypeScript manifest
 * can import. The source folder is not part of the repository, and neither is
 * `public/avatar/` (git-ignored third-party art, see NOTICE.md).
 *
 * Usage:  AVATAR_SPRITES_SRC=<source folder> node scripts/deploy-avatar-sprites.mjs
 *         (defaults to `avatars/` at the repo root)
 *
 * Order: scan the source and build the whole manifest first; refuse a source that is not a
 * directory, has no gender folder, yields no sprites, or overlaps the destination; only then
 * replace the destination and write the manifest last. A wrong AVATAR_SPRITES_SRC can never
 * wipe public/avatar/ or empty the tracked manifest.
 */

import { existsSync, realpathSync, statSync } from 'node:fs';
import { readdir, copyFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, join, basename, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Sanitize a name for URL-safe filenames: lowercase, trim, collapse spaces → hyphens. */
function sanitize(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Recursively list all PNG files under a directory.
 * Returns array of { relativePath, fullPath }.
 */
async function listPngs(dir, base = dir) {
  const results = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listPngs(full, base));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
      results.push({ fullPath: full, relativePath: full.slice(base.length + 1) });
    }
  }
  return results;
}

/** Parse a gender folder like "trainer front female" → "female" */
function parseGender(folderName) {
  if (folderName.includes('female')) return 'female';
  if (folderName.includes('male')) return 'male';
  return null;
}

/** Parse a sprite file and extract its metadata. */
function parseSpriteFile(relativePath, gender) {
  // relativePath looks like: "base/base  light.png" or "tops/hoodie/hoodie blue.png"
  const parts = relativePath.replace(/\\/g, '/').split('/');
  const filename = basename(parts[parts.length - 1], '.png');
  const category = sanitize(parts[0]); // "base", "hair", "tops", "bottoms", "hats"

  let style, color;

  if (parts.length === 2) {
    // Direct file in category: "bottoms/lords pants.png" or "base/base dark.png"
    // or "hats/fedora.png", "hats/feather hat.png"
    const words = filename.trim().split(/\s+/);
    if (category === 'base') {
      // Base always has a single style with color variants
      style = 'default';
      color = sanitize(words[words.length - 1]);
    } else {
      // Single file directly in category folder = standalone item, no color variant.
      // Treat entire filename as the style name.
      style = sanitize(filename);
      color = 'default';
    }
  } else if (parts.length >= 3) {
    // File in subfolder: "tops/hoodie/hoodie blue.png" or "hair/Hair 1/1 black.png"
    style = sanitize(parts[1]); // subfolder name is the style
    // Extract color from filename (last word typically)
    const words = filename.trim().split(/\s+/);
    color = sanitize(words[words.length - 1]);
  }

  // Generate a safe destination filename
  const destFilename = `${style}-${color}.png`;
  const destPath = `${gender}/${category}/${destFilename}`;
  const optionId = `${gender}-${category}-${style}-${color}`;

  return { category, style, color, destFilename, destPath, optionId };
}

/** A failure that must stop the deploy before anything is deleted or written. */
export class DeployRefused extends Error {}

/**
 * Resolve the nearest existing ancestor of `abs` through realpath and re-append the rest, so a
 * junction, symlink or subst drive cannot hide where a path really points.
 */
function realpathNearest(abs) {
  const tail = [];
  let current = abs;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return abs;
    tail.unshift(basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync.native(current);
  } catch {
    // keep the lexical path
  }
  return tail.length > 0 ? join(real, ...tail) : real;
}

/** Compare form of a path: real location, case-insensitive on Windows and macOS. */
function comparable(p) {
  const r = realpathNearest(resolve(p));
  return process.platform === 'win32' || process.platform === 'darwin' ? r.toLowerCase() : r;
}

/** True when `a` equals `b` or lies inside it. */
function within(a, b) {
  const ca = comparable(a);
  const cb = comparable(b);
  return ca === cb || ca.startsWith(cb.endsWith(sep) ? cb : cb + sep);
}

/**
 * Refuse a source that equals the destination or overlaps it either way.
 * Throws DeployRefused.
 */
export function validateDeployPaths(srcDir, destDir) {
  if (within(srcDir, destDir) || within(destDir, srcDir)) {
    throw new DeployRefused(
      `Sprite source ${resolve(srcDir)} and destination ${resolve(destDir)} overlap; point AVATAR_SPRITES_SRC at the separate folder that holds the gender folders.`
    );
  }
}

/**
 * Scan the source and build the full manifest and copy plan without touching the destination.
 * Throws DeployRefused when the source is not a directory, has no gender folder, or yields no sprites.
 * Returns { manifest, copies: [{ from, destPath }], counts: { [gender]: n } }.
 */
export async function scanSprites(srcDir) {
  let isDir = false;
  try {
    isDir = statSync(srcDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    throw new DeployRefused(
      `Sprite source folder not found or not a directory: ${srcDir}. Set AVATAR_SPRITES_SRC to the folder that holds the gender folders.`
    );
  }

  const genderFolders = await readdir(srcDir, { withFileTypes: true });
  const manifest = {};
  const copies = [];
  const counts = {};
  let genderFound = false;

  for (const gf of genderFolders) {
    if (!gf.isDirectory()) continue;
    const gender = parseGender(gf.name);
    if (!gender) continue;
    genderFound = true;

    manifest[gender] = manifest[gender] ?? {};
    const pngs = await listPngs(join(srcDir, gf.name));
    counts[gender] = (counts[gender] ?? 0) + pngs.length;

    for (const png of pngs) {
      const parsed = parseSpriteFile(png.relativePath, gender);
      if (!parsed) continue;
      const styles = (manifest[gender][parsed.category] ??= {});
      (styles[parsed.style] ??= []).push({
        color: parsed.color,
        filename: parsed.destFilename,
        optionId: parsed.optionId,
      });
      copies.push({ from: png.fullPath, destPath: parsed.destPath });
    }
  }

  if (!genderFound) {
    throw new DeployRefused(
      `No gender folder (a folder name containing "male" or "female") in ${srcDir}; nothing was changed.`
    );
  }
  if (copies.length === 0) {
    throw new DeployRefused(`No PNG sprites under the gender folders of ${srcDir}; nothing was changed.`);
  }
  return { manifest, copies, counts };
}

/**
 * Scan and validate first, then replace destDir and write the manifest last.
 * Resolves to { totalCopied, counts }. Throws DeployRefused before any change when validation fails.
 */
export async function deploySprites({ srcDir, destDir, manifestPath }) {
  validateDeployPaths(srcDir, destDir);
  const { manifest, copies, counts } = await scanSprites(srcDir);

  await rm(destDir, { recursive: true, force: true });
  for (const copy of copies) {
    const destFull = join(destDir, ...copy.destPath.split('/'));
    await mkdir(dirname(destFull), { recursive: true });
    await copyFile(copy.from, destFull);
  }

  // Write manifest JSON for the TypeScript code to consume
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return { totalCopied: copies.length, counts };
}

async function main() {
  console.log('🎨 Deploying avatar sprites...\n');
  const srcDir = process.env.AVATAR_SPRITES_SRC ? resolve(process.env.AVATAR_SPRITES_SRC) : join(ROOT, 'avatars');
  const destDir = join(ROOT, 'public', 'avatar');
  const manifestPath = join(ROOT, 'src', 'lib', 'avatar', 'manifest-data.json');

  try {
    const { totalCopied, counts } = await deploySprites({ srcDir, destDir, manifestPath });
    for (const [gender, n] of Object.entries(counts)) console.log(`  ${gender}: found ${n} sprites`);
    console.log(`\n✅ Deployed ${totalCopied} sprites to public/avatar/`);
    console.log(`📋 Manifest written to src/lib/avatar/manifest-data.json`);
  } catch (err) {
    if (err instanceof DeployRefused) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
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
  main().catch((err) => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
}
