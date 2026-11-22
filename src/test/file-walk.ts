/**
 * Shared source-tree walk and file-text cache for tests that scan the repository
 * (route-handoff-contract, repository-isolation, no-draft-arena — issue #144).
 *
 * Vitest isolates each test file's module state, so a `Map` alone cannot share
 * anything across files. The text cache is therefore persisted to
 * `node_modules/.cache/test-source-texts.json`, keyed by absolute path + mtime +
 * size: an unchanged file is read from disk once per fresh checkout however
 * many test files scan it, and an `afterAll` hook merges each file's entries
 * back when its tests finish.
 * The directory enumeration itself is `readdir`-only (names, no stat per file
 * beyond the mtime the cache needs) and stays cheap enough to redo per test
 * file — only file contents are cached.
 *
 * `walkStats` counts the real work so a test can prove the walk ran once.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll } from 'vitest';

export const REPO_ROOT = path.resolve(__dirname, '../..');

/** Repository-relative path of an absolute file, `/`-separated. */
export const relFromRepo = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

export const walkStats = { enumerations: 0, textsRead: 0, cacheHits: 0 };

const CACHE_FILE = path.join(REPO_ROOT, 'node_modules', '.cache', 'test-source-texts.json');

interface CacheEntry {
  m: number;
  s: number;
  t: string;
}
type DiskCache = Record<string, CacheEntry>;

let disk: DiskCache | undefined;
let dirty = false;

function diskCache(): DiskCache {
  if (disk === undefined) {
    try {
      disk = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as DiskCache;
    } catch {
      disk = {};
    }
  }
  return disk;
}

function flushTextCache(): void {
  if (!dirty || disk === undefined) return;
  try {
    // Sibling test files may have written entries since this file loaded: merge over them.
    let merged: DiskCache = {};
    try {
      merged = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as DiskCache;
    } catch {
      /* first writer */
    }
    Object.assign(merged, disk);
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(merged));
    dirty = false;
  } catch {
    /* a cache must never fail a test run */
  }
}

const freshTexts = new Map<string, string>();

/** The text of a file: cached in-process, and on disk across test files and runs while its mtime and size hold. */
export function sourceText(file: string): string {
  const fresh = freshTexts.get(file);
  if (fresh !== undefined) return fresh;
  const { mtimeMs, size } = statSync(file);
  const entry = diskCache()[file];
  let text: string;
  if (entry !== undefined && entry.m === mtimeMs && entry.s === size) {
    walkStats.cacheHits += 1;
    text = entry.t;
  } else {
    walkStats.textsRead += 1;
    text = readFileSync(file, 'utf8');
    diskCache()[file] = { m: mtimeMs, s: size, t: text };
    dirty = true;
  }
  freshTexts.set(file, text);
  return text;
}

// Registered at collection time in every importing test file: flush this file's entries when its tests end.
afterAll(flushTextCache);

const dirLists = new Map<string, string[]>();

/**
 * Every file under `dir` (node_modules, .next and dot-named entries skipped), enumerated once per
 * process per dir; `include` filters on the repo-relative `/`-separated path afterwards.
 */
export function sourceFiles(dir: string, include: (rel: string) => boolean = () => true): string[] {
  let files = dirLists.get(dir);
  if (files === undefined) {
    walkStats.enumerations += 1;
    const collected: string[] = [];
    const visit = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const name = entry.name;
        if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue;
        const full = path.join(current, name);
        if (entry.isDirectory()) visit(full);
        else if (entry.isFile()) collected.push(full);
      }
    };
    if (existsSync(dir)) visit(dir);
    files = collected;
    dirLists.set(dir, files);
  }
  return files.filter((file) => include(relFromRepo(file)));
}
