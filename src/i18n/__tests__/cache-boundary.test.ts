import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Cached reads never hold localized text (i18n-core §3 caching rule, §8.1;
 * owner G0-ERR). `t()`, `getT`, `getFormatter`, `getLocale`, Intl formatting
 * and dex-name localization never run inside a `cachedRead` /
 * `unstable_cache` callback, and no cache is keyed by locale.
 *
 * Scanned: every file under `src/lib/cache/**` and every non-test file under
 * `src/` that calls `unstable_cache(` or `cachedRead(`.
 */

const SRC = path.resolve(__dirname, '../..');
const CACHE_DIR = path.join(SRC, 'lib', 'cache');

const FORBIDDEN_IMPORT =
  /(?:from\s*|import\s*\(\s*)['"](@\/i18n\/(?:server|client|core|format)|@\/lib\/pkmn\/i18n(?:\/[^'"]*)?)['"]/g;
const CACHE_CALL = /\b(unstable_cache|cachedRead)\s*\(/g;
const FORBIDDEN_CALL =
  /\b(getLocale|getDataLocale|getTimeZone|getRequestLocale|getRequestDataLocale|getT|getFormatter|createTranslator|createFormatter|localize[A-Za-z]*)\s*\(/g;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The text between the `(` at `open` and its matching `)`, skipping string and template literals. */
function argumentText(text: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function violations(file: string, text: string): string[] {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  const out: string[] = [];
  for (const m of text.matchAll(FORBIDDEN_IMPORT)) out.push(`${rel}: imports ${m[1]}`);
  for (const m of text.matchAll(CACHE_CALL)) {
    const body = argumentText(text, m.index + m[0].length - 1);
    for (const call of body.matchAll(FORBIDDEN_CALL)) out.push(`${rel}: ${m[1]} callback calls ${call[1]}()`);
  }
  return out;
}

function scannedFiles(): string[] {
  const files = new Set<string>(fs.existsSync(CACHE_DIR) ? sourceFiles(CACHE_DIR) : []);
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\b(unstable_cache|cachedRead)\s*\(/.test(text)) files.add(file);
  }
  return [...files].sort();
}

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('cache boundary', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('finds the cached-read modules', () => {
    const rel = scannedFiles().map((f) => path.relative(SRC, f).replace(/\\/g, '/'));
    expect(rel).toContain('lib/cache/public-reads.ts');
  });

  it('no cached read imports the i18n runtime or localizes inside its callback', () => {
    const problems = scannedFiles().flatMap((file) => violations(file, fs.readFileSync(file, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('the checker catches the forbidden shapes (self-test)', () => {
    const bad = [
      "import { getT } from '@/i18n/server';",
      "import { localizeSpecies } from '@/lib/pkmn/i18n/names';",
      'const read = unstable_cache(async (id: string) => {',
      "  const t = createTranslator(ns, await getLocale());",
      "  return { label: t('x'), name: localizeSpecies('Pikachu', 'de'), s: ')' };",
      "}, ['key']);",
      "const ok = cachedRead('k', async () => ({ name: 'Pikachu' }));",
    ].join('\n');
    expect(violations(path.join(SRC, 'fixture.ts'), bad)).toEqual([
      'fixture.ts: imports @/i18n/server',
      'fixture.ts: imports @/lib/pkmn/i18n/names',
      'fixture.ts: unstable_cache callback calls createTranslator()',
      'fixture.ts: unstable_cache callback calls getLocale()',
      'fixture.ts: unstable_cache callback calls localizeSpecies()',
    ]);
  });
});
