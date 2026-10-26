import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC_ROOT, importChain, listSourceFiles, reachableGraph } from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The closure test of the Ruleset Studio's pure editing core. Everything under `src/lib/ruleset-studio/editor/` runs in the
 * browser (the library dialog, the editor), and so do `access.ts` (the UI hides what the role may not do), `document.ts`
 * (a new document is built where it is typed) and `library-types.ts`. None of them may reach:
 *
 *  - `zod`, `server-only`, `@pkmn/*` or `@supabase/*` (the dex stays on the server: the browser gets ids, names and
 *    resolved preset rules from the routes);
 *  - a server module of the studio (`*.server.ts`, `library.ts`, `guards.ts`, `pins.ts`, ...), anything under
 *    `src/lib/supabase`, or a server file of the format kit.
 *
 * Each of them reaches the format kit (the rule preset catalog view, localized text) through `@/lib/format-kit/client` only.
 * A negative control proves the walker sees the dex when it starts at the server side of the studio.
 */

const KIT = path.join(SRC_ROOT, 'lib', 'format-kit');
const STUDIO = path.join(SRC_ROOT, 'lib', 'ruleset-studio');
const EDITOR = path.join(STUDIO, 'editor');

const KIT_SERVER_FILES = ['validate.ts', 'compile.ts', 'index.ts', 'registry/server.ts', 'expr/schema.ts'].map((f) => path.join(KIT, f));
const KIT_SERVER_DIRS = [path.join(KIT, 'schema') + path.sep];
const SUPABASE_DIR = path.join(SRC_ROOT, 'lib', 'supabase') + path.sep;
const STUDIO_SERVER = ['library.ts', 'guards.ts', 'pins.ts', 'pin-change.ts', 'materialise.ts', 'legacy-bridge.ts', 'exposure.ts', 'api-body.ts', 'api-schemas.ts', 'errors.ts'].map((f) => path.join(STUDIO, f));

const FORBIDDEN_PACKAGES = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^@supabase\//];

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const editorFiles = listSourceFiles(EDITOR);
const files = [...editorFiles, path.join(STUDIO, 'access.ts'), path.join(STUDIO, 'document.ts'), path.join(STUDIO, 'library-types.ts')];

/** Every module specifier in a source text, type-only ones included. */
function allSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

describe('the ruleset editor core', () => {
  it('finds the modules it is supposed to check', () => {
    const names = editorFiles.map((file) => path.basename(file)).sort();
    for (const expected of ['api.ts', 'import-file.ts', 'starts.ts']) expect(names, expected).toContain(expected);
  });

  describe.each(files.map((file) => [rel(file), file] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file);

    it('reaches no zod, server-only, @pkmn or @supabase package', () => {
      expect([...graph.packages].filter((pkg) => FORBIDDEN_PACKAGES.some((re) => re.test(pkg)))).toEqual([]);
    });

    it('reaches no server module of the studio or the kit and no Supabase module', () => {
      const bad = [...graph.files].filter(
        (reached) =>
          KIT_SERVER_FILES.includes(reached) ||
          KIT_SERVER_DIRS.some((dir) => reached.startsWith(dir)) ||
          STUDIO_SERVER.includes(reached) ||
          reached.endsWith('.server.ts') ||
          reached.startsWith(SUPABASE_DIR),
      );
      expect(bad.map((reached) => importChain(graph, reached))).toEqual([]);
    });

    it('reaches the format kit through its client entry only', () => {
      const offenders: string[] = [];
      for (const spec of allSpecifiers(fs.readFileSync(file, 'utf8'))) {
        const isKit = spec === '@/lib/format-kit' || spec.startsWith('@/lib/format-kit/');
        if (isKit && spec !== '@/lib/format-kit/client') offenders.push(spec);
        if (spec.startsWith('.') && path.resolve(path.dirname(file), spec).startsWith(KIT)) offenders.push(spec);
      }
      expect(offenders).toEqual([]);
    });
  });

  it('the walker is not blind: the starts reach the kit client barrel and the preset catalog', () => {
    const graph = reachableGraph(path.join(EDITOR, 'starts.ts'));
    expect(graph.files.has(path.join(KIT, 'client.ts'))).toBe(true);
    expect(graph.files.has(path.join(KIT, 'ruleset-presets.ts'))).toBe(true);
  });

  it('negative control: the library (server side) reaches the dex and Supabase', () => {
    const graph = reachableGraph(path.join(STUDIO, 'library.ts'));
    expect([...graph.packages].some((pkg) => /^@pkmn\//.test(pkg))).toBe(true);
    expect([...graph.files].some((file) => file.startsWith(SUPABASE_DIR))).toBe(true);
  });
});
