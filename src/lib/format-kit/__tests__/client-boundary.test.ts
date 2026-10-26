import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The client barrel (`client.ts`) must stay free of server code. This test walks its import closure with
 * regexes over the source text (not a bundler) and fails on:
 *  - `zod`, `server-only`, `@pkmn/*`, `next/*`, `react`, `@/lib/supabase/*`;
 *  - any server file of the kit: `schema/*`, `validate.ts`, `registry/server.ts`, `expr/schema.ts`,
 *    `compile.ts`, `index.ts`;
 *  - any module outside the kit that is not on the allow-list below.
 *
 * Allowed outside the kit, and why:
 *  - `@/i18n/{core,config,format,define,types}`: the translator runtime is client-safe by design.
 *  - `@/i18n/messages/format-studio` (and its `primitives` and `describe` children): the catalogs the renderers
 *    read. They are walked like kit files.
 *  - `@/lib/season/format-capabilities`: capability flags; it holds type imports only.
 *  - `@/lib/tournament/round-robin`: the pure round count the plan reuses; it imports only `./types`.
 *  - `@/lib/studio-core/{json,keys,ltext,patch}`: the shared JSON, key, localized-text and patch helpers (pure, zod-free,
 *    they import only each other and `@/i18n/config`).
 *  - `@/lib/pkmn/format-catalog`: the dex-free rule preset catalog `ruleset-presets.ts` reads; it walks to no dex, no
 *    server data and no `@pkmn` package (`src/lib/pkmn/__tests__/format-catalog-boundary.test.ts` proves it).
 */

const KIT = path.resolve(__dirname, '..');
const SRC = path.resolve(KIT, '../..');
const FORMAT_STUDIO = path.resolve(SRC, 'i18n/messages/format-studio');

const ALLOWED_OUTSIDE = new Set([
  '@/i18n/core',
  '@/i18n/config',
  '@/i18n/format',
  '@/i18n/define',
  '@/i18n/types',
  '@/lib/season/format-capabilities',
  '@/lib/tournament/round-robin',
  '@/lib/pkmn/format-catalog',
  '@/lib/studio-core/json',
  '@/lib/studio-core/keys',
  '@/lib/studio-core/ltext',
  '@/lib/studio-core/patch',
]);

const FORBIDDEN_BARE = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^next(\/|$)/, /^react(-dom)?(\/|$)/, /^@\/lib\/supabase\//];

const SERVER_FILES = [
  'validate.ts',
  'compile.ts',
  'index.ts',
  'registry/server.ts',
  'expr/schema.ts',
].map((f) => path.resolve(KIT, f));
const SERVER_DIRS = [path.resolve(KIT, 'schema') + path.sep];

/** Runtime import specifiers of a source text: skips `import type` and `export type`. */
export function importSpecifiers(source: string): string[] {
  const text = source.replace(/\r\n/g, '\n');
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(statement)) {
    if (m[2] === undefined) found.push(m[4]);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

function resolveFile(base: string): string | null {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface Closure {
  files: Set<string>;
  bare: Set<string>;
  outside: Set<string>;
}

function walk(entry: string): Closure {
  const closure: Closure = { files: new Set(), bare: new Set(), outside: new Set() };
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (closure.files.has(file)) continue;
    closure.files.add(file);
    for (const spec of importSpecifiers(fs.readFileSync(file, 'utf8'))) {
      let target: string | null = null;
      if (spec.startsWith('.')) target = resolveFile(path.resolve(path.dirname(file), spec));
      else if (spec.startsWith('@/')) {
        const resolved = path.resolve(SRC, spec.slice(2));
        const inKit = resolved.startsWith(KIT + path.sep);
        const inStudio = resolved === FORMAT_STUDIO || resolved.startsWith(FORMAT_STUDIO + path.sep);
        if (inKit || inStudio) target = resolveFile(resolved);
        else closure.outside.add(spec);
      } else closure.bare.add(spec);
      if (target !== null) queue.push(target);
    }
  }
  return closure;
}

const rel = (file: string) => path.relative(KIT, file).split(path.sep).join('/');

describe('importSpecifiers', () => {
  it('finds static, re-export, side-effect, dynamic and multi-line imports and skips type-only ones', () => {
    const source = [
      "import a from './a';",
      "import { b,",
      "  c } from '../b';",
      "export * from './c';",
      "export { d } from './d';",
      "import type { T } from './type-only';",
      "export type { U } from './type-only-too';",
      "import './effect';",
      "const lazy = import('./lazy');",
      "import { type V, w } from './mixed';",
      '',
    ].join('\r\n');
    expect(importSpecifiers(source).sort()).toEqual(['../b', './a', './c', './d', './effect', './lazy', './mixed']);
  });

  it('ignores the word import inside text', () => {
    expect(importSpecifiers("// import x from 'nope'\nconst a = 'import y from \"z\"';")).toEqual([]);
  });
});

describe('client barrel boundary', () => {
  const closure = walk(path.resolve(KIT, 'client.ts'));

  it('reaches the client files it is supposed to expose', () => {
    const reached = new Set([...closure.files].map(rel));
    for (const expected of [
      'client.ts',
      'validate.browser.ts',
      'compile.browser.ts',
      'registry/manifest.ts',
      'registry/describe.ts',
      'expr/validate-json.ts',
      'engine/render.ts',
      'engine/describe-definition.ts',
      'presets/index.ts',
    ]) {
      expect(reached.has(expected), expected).toBe(true);
    }
    expect([...closure.files].some((f) => f.startsWith(FORMAT_STUDIO))).toBe(true);
    expect(closure.files.has(path.resolve(FORMAT_STUDIO, 'describe/index.ts'))).toBe(true);
    expect(closure.files.size).toBeGreaterThan(40);
  });

  it('imports no server file of the kit', () => {
    const offenders = [...closure.files].filter((f) => SERVER_FILES.includes(f) || SERVER_DIRS.some((dir) => f.startsWith(dir)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('imports no forbidden package and no unlisted bare module', () => {
    const forbidden = [...closure.bare, ...closure.outside].filter((spec) => FORBIDDEN_BARE.some((re) => re.test(spec)));
    expect(forbidden).toEqual([]);
    expect([...closure.bare]).toEqual([]);
  });

  it('reaches outside the kit only for the allow-listed modules', () => {
    expect([...closure.outside].filter((spec) => !ALLOWED_OUTSIDE.has(spec))).toEqual([]);
  });
});

describe('server barrel (sanity: the walker sees server code when it is there)', () => {
  const closure = walk(path.resolve(KIT, 'index.ts'));

  it('reaches zod and the server files', () => {
    expect(closure.bare.has('zod')).toBe(true);
    const reached = new Set([...closure.files].map(rel));
    for (const server of ['validate.ts', 'compile.ts', 'registry/server.ts', 'expr/schema.ts', 'schema/index.ts']) {
      expect(reached.has(server), server).toBe(true);
    }
  });
});
