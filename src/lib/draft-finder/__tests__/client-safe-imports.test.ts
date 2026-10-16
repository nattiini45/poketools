/**
 * Client safety of the finder (draft-frontend §4, AGENTS.md "Never import @pkmn/dex in client components").
 *
 * - `src/lib/draft-finder/*.ts` except `*.server.ts`: no `@pkmn/*`, Supabase, auth, `next/*`, `server-only`
 *   or Node built-in, directly or through any runtime import they reach (type-only imports are erased).
 * - `src/lib/draft-ui/**` and `src/components/draft-*\/**`: no `@pkmn/*` import at all.
 * - `names-port.ts` is the only finder module importing the name dictionaries (`@/lib/pkmn/i18n/names*`);
 *   the dictionary-free `@/lib/pkmn/i18n/{search,id}` may be imported anywhere.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../..');
const FINDER = path.join(SRC, 'lib', 'draft-finder');

const FORBIDDEN: readonly RegExp[] = [
  /^@pkmn\//,
  /^@supabase\//,
  /^next(\/|$)/,
  /^next-auth(\/|$)/,
  /^server-only$/,
  /^node:/,
  /^(fs|path|crypto|os|child_process)$/,
  /^@\/lib\/supabase(\/|$)/,
  /^@\/lib\/auth(\/|$)/,
  /^@\/lib\/pkmn\/dex/,
];

const NAME_DICTIONARIES = /^@\/lib\/pkmn\/i18n\/names(\/|$)/;

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(file: string): ImportRef[] {
  const source = stripComments(readFileSync(file, 'utf8'));
  const refs: ImportRef[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) refs.push({ specifier: m[3], typeOnly: Boolean(m[2]) });
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push({ specifier: m[1], typeOnly: false });
  return refs;
}

function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function walk(dir: string, filter: (file: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

const isSource = (f: string) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f);
const isTest = (f: string) => f.includes(`${path.sep}__tests__${path.sep}`) || /\.test\.tsx?$/.test(f);

const clientFinderModules = readdirSync(FINDER)
  .filter((n) => n.endsWith('.ts') && !n.endsWith('.server.ts'))
  .map((n) => path.join(FINDER, n));

/** Every forbidden specifier reachable from `entry` through runtime imports, with the importing file. */
function forbiddenReachable(entry: string): string[] {
  const seen = new Set<string>();
  const hits: string[] = [];
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of importsOf(file)) {
      if (ref.typeOnly || ref.specifier.endsWith('.json')) continue;
      if (FORBIDDEN.some((re) => re.test(ref.specifier))) {
        hits.push(`${path.relative(SRC, file)} -> ${ref.specifier}`);
        continue;
      }
      const local = resolveLocal(file, ref.specifier);
      if (local) stack.push(local);
    }
  }
  return hits;
}

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('draft finder client safety', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('finds the client modules', () => {
    expect(clientFinderModules.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(['engine.ts', 'search.ts', 'names-port.ts', 'line-catalog.ts', 'reducer.ts']),
    );
  });

  it.each(clientFinderModules.map((f) => [path.basename(f), f]))(
    '%s reaches no @pkmn, Supabase, auth, next or Node module at runtime',
    (_name, file) => {
      expect(forbiddenReachable(file)).toEqual([]);
    },
  );

  it('only names-port.ts imports the name dictionaries', () => {
    const importers = clientFinderModules
      .filter((f) => importsOf(f).some((r) => NAME_DICTIONARIES.test(r.specifier)))
      .map((f) => path.basename(f));
    expect(importers).toEqual(['names-port.ts']);
  });

  it('no @pkmn import in draft-ui or the draft components', () => {
    const files = [
      ...walk(path.join(SRC, 'lib', 'draft-ui'), (f) => isSource(f) && !isTest(f)),
      ...readdirSync(path.join(SRC, 'components'))
        .filter((n) => n.startsWith('draft-'))
        .flatMap((n) => walk(path.join(SRC, 'components', n), (f) => isSource(f) && !isTest(f))),
    ];
    const hits = files.flatMap((f) =>
      importsOf(f)
        .filter((r) => /^@pkmn\//.test(r.specifier))
        .map((r) => `${path.relative(SRC, f)} -> ${r.specifier}`),
    );
    expect(hits).toEqual([]);
  });
});
