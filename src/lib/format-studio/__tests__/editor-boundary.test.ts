import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  SRC_ROOT,
  importChain,
  listSourceFiles,
  reachableGraph,
  runtimeSpecifiers,
} from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The closure test of the Studio's pure editing core. Everything under `src/lib/format-studio/editor/` runs in the
 * browser (the editor, the previews, the attach panel), and so do `materialise.ts` (the attach preview plans the
 * phases with it) and `access.ts` (the UI hides what the role may not do). None of them may reach:
 *
 *  - `zod`, `server-only`, `@pkmn/*` or `@supabase/*` (React is reached through the translator core the kit's own
 *    client barrel uses; the core itself has no React code);
 *  - a server file of the kit (`validate.ts`, `compile.ts`, `index.ts`, `registry/server.ts`, `expr/schema.ts`,
 *    `schema/**`), anything under `src/lib/supabase`, or the Studio loader.
 *
 * Each of them reaches the kit through `@/lib/format-kit/client` only. A negative control proves the walker sees
 * zod when it starts at the kit's server barrel.
 */

const KIT = path.join(SRC_ROOT, 'lib', 'format-kit');
const STUDIO = path.join(SRC_ROOT, 'lib', 'format-studio');
const EDITOR = path.join(STUDIO, 'editor');

const KIT_SERVER_FILES = ['validate.ts', 'compile.ts', 'index.ts', 'registry/server.ts', 'expr/schema.ts'].map((f) => path.join(KIT, f));
const KIT_SERVER_DIRS = [path.join(KIT, 'schema') + path.sep];
const SUPABASE_DIR = path.join(SRC_ROOT, 'lib', 'supabase') + path.sep;
const LOADER = path.join(STUDIO, 'loader.ts');

const FORBIDDEN_PACKAGES = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^@supabase\//];

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const editorFiles = listSourceFiles(EDITOR);
const files = [...editorFiles, path.join(STUDIO, 'materialise.ts'), path.join(STUDIO, 'access.ts')];

/** Every module specifier in a source text, type-only ones included. */
function allSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('the editor core', () => {
  it('finds the modules it is supposed to check', () => {
    const names = editorFiles.map((file) => path.basename(file)).sort();
    for (const expected of [
      'api.ts',
      'attach-preview.ts',
      'catalog.ts',
      'document.ts',
      'import-file.ts',
      'ops.ts',
      'preview.ts',
      'readiness.ts',
      'starts.ts',
      'state.ts',
      'targets.ts',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  describe.each(files.map((file) => [rel(file), file] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file);

    it('reaches no zod, server-only, @pkmn or @supabase package', () => {
      expect([...graph.packages].filter((pkg) => FORBIDDEN_PACKAGES.some((re) => re.test(pkg)))).toEqual([]);
    });

    it('reaches no kit server file, no Supabase module and not the loader', () => {
      const bad = [...graph.files].filter(
        (reached) =>
          KIT_SERVER_FILES.includes(reached) ||
          KIT_SERVER_DIRS.some((dir) => reached.startsWith(dir)) ||
          reached.startsWith(SUPABASE_DIR) ||
          reached === LOADER,
      );
      expect(bad.map((reached) => importChain(graph, reached))).toEqual([]);
    });

    it('reaches the kit through its client entry only', () => {
      const offenders: string[] = [];
      for (const spec of allSpecifiers(fs.readFileSync(file, 'utf8'))) {
        const isKit = spec === '@/lib/format-kit' || spec.startsWith('@/lib/format-kit/');
        if (isKit && spec !== '@/lib/format-kit/client') offenders.push(spec);
        if (spec.startsWith('.') && path.resolve(path.dirname(file), spec).startsWith(KIT)) offenders.push(spec);
      }
      expect(offenders).toEqual([]);
    });
  });

  it('the walker is not blind: the attach preview reaches the kit client barrel and the planner', () => {
    const graph = reachableGraph(path.join(EDITOR, 'attach-preview.ts'));
    expect(graph.files.has(path.join(KIT, 'client.ts'))).toBe(true);
    expect(graph.files.has(path.join(KIT, 'engine', 'schedule.ts'))).toBe(true);
    expect(graph.files.has(path.join(STUDIO, 'materialise.ts'))).toBe(true);
  });

  it('negative control: the kit\'s server barrel reaches zod', () => {
    const graph = reachableGraph(path.join(KIT, 'index.ts'));
    expect([...graph.packages].some((pkg) => /^zod(\/|$)/.test(pkg))).toBe(true);
  });

  it('negative control: the old zod-based limits import would be caught', () => {
    const graph = reachableGraph(path.join(SRC_ROOT, 'lib', 'validation', 'schemas.ts'));
    expect([...graph.packages].some((pkg) => /^zod(\/|$)/.test(pkg))).toBe(true);
  });

  it('materialise.ts does not import the validation module', () => {
    const specs = runtimeSpecifiers(path.join(STUDIO, 'materialise.ts'));
    expect(specs.filter((spec) => spec.startsWith('@/lib/validation'))).toEqual([]);
  });
});
