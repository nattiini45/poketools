import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC_ROOT, importChain, isUseClientFile, listSourceFiles, reachableGraph } from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The Ruleset Studio's client boundary. Every module under `src/components/ruleset-studio` runs in the browser or renders on
 * the server from text it was handed, and none of them may reach `@pkmn/*` (the dex stays on the server: the browser gets
 * ids, names and resolved preset rules from the routes), `@supabase/*`, `server-only`, anything under `src/lib/supabase`, a
 * server module of the studio library (`*.server.ts`, the library, guards and pins), or a server file of the format kit.
 *
 * `zod` is reached through one bridge that every client component using `useApiErrorText` has (see the Format Studio's
 * client boundary test); it is not followed.
 */

const KIT = path.join(SRC_ROOT, 'lib', 'format-kit');
const STUDIO = path.join(SRC_ROOT, 'lib', 'ruleset-studio');
const PREEXISTING_BRIDGES: ReadonlySet<string> = new Set([path.join(SRC_ROOT, 'lib', 'format-pack', 'index.ts')]);

const KIT_SERVER_FILES = ['validate.ts', 'compile.ts', 'index.ts', 'registry/server.ts', 'expr/schema.ts'].map((f) => path.join(KIT, f));
const KIT_SERVER_DIRS = [path.join(KIT, 'schema') + path.sep];
const SUPABASE_DIR = path.join(SRC_ROOT, 'lib', 'supabase') + path.sep;
const STUDIO_SERVER = ['library.ts', 'guards.ts', 'pins.ts', 'pin-change.ts', 'materialise.ts', 'legacy-bridge.ts', 'exposure.ts', 'api-body.ts', 'api-schemas.ts', 'errors.ts'].map((f) => path.join(STUDIO, f));
const FORBIDDEN_PACKAGES = [/^@pkmn\//, /^@supabase\//, /^server-only$/];

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const files = listSourceFiles(path.join(SRC_ROOT, 'components', 'ruleset-studio')).filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));

describe('Ruleset Studio client boundary', () => {
  it('finds the modules it is supposed to check', () => {
    const names = files.map((file) => path.basename(file));
    for (const expected of ['NewRulesetDialog.tsx', 'ForkPresetButton.tsx', 'ForkStoredButton.tsx', 'RulesetLibraryList.tsx', 'library-entries.ts', 'hrefs.ts']) {
      expect(names, expected).toContain(expected);
    }
    expect(files.some(isUseClientFile)).toBe(true);
  });

  describe.each(files.map((file) => [rel(file), file] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file, { stopAt: PREEXISTING_BRIDGES });

    it('reaches no dex, Supabase or server-only package', () => {
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
  });
});
