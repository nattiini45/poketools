import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  REPO_ROOT,
  SRC_ROOT,
  importChain,
  isUseClientFile,
  listSourceFiles,
  reachableGraph,
  runtimeSpecifiers,
} from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The Format Studio's client boundary. The kit has two entries: `@/lib/format-kit` (server: zod validator, schemas,
 * server registry) and `@/lib/format-kit/client` (browser validator and compile, no zod). There is no bundler
 * alias between them (unlike `format-pack`, whose server and browser import the SAME specifier), so the entry
 * file IS the boundary, and this test keeps it:
 *
 *  - every `'use client'` module under `src/components/format-studio` and `src/app/admin/formats` reaches no
 *    `zod`, `server-only`, `@pkmn/*` or `@supabase/*` package, none of the kit's server files, nothing under
 *    `src/lib/supabase` and not the Studio loader;
 *  - every module under those directories (pages included) imports the kit through `@/lib/format-kit/client`
 *    only, never the bare `@/lib/format-kit`, `validate`, `compile`, `schema` or `registry/server`;
 *  - a negative control proves the walker sees zod when it starts at the server barrel.
 *
 * One pre-existing bridge is not followed: the format pack's entry (`src/lib/format-pack/index.ts`). Every client
 * component that renders an API error reaches it through `useApiErrorText` -> `api-errors` -> the enum catalog,
 * and the pack validates itself with zod in both the server and the browser build. It is app-wide and not part
 * of the kit's boundary; a row below keeps the exception honest (it must still be reached, and still pull zod).
 */

const KIT = path.join(SRC_ROOT, 'lib', 'format-kit');
const SCAN_DIRS = [path.join(SRC_ROOT, 'components', 'format-studio'), path.join(SRC_ROOT, 'app', 'admin', 'formats')];

const KIT_SERVER_FILES = ['validate.ts', 'compile.ts', 'index.ts', 'registry/server.ts', 'expr/schema.ts'].map((f) =>
  path.join(KIT, f),
);
const KIT_SERVER_DIRS = [path.join(KIT, 'schema') + path.sep];
const SUPABASE_DIR = path.join(SRC_ROOT, 'lib', 'supabase') + path.sep;
const LOADER = path.join(SRC_ROOT, 'lib', 'format-studio', 'loader.ts');

/** Reached by every client module that uses `useApiErrorText`; see the header. */
const PREEXISTING_BRIDGES: ReadonlySet<string> = new Set([path.join(SRC_ROOT, 'lib', 'format-pack', 'index.ts')]);

const FORBIDDEN_PACKAGES = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^@supabase\//];

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const sourceFiles = SCAN_DIRS.flatMap((dir) => listSourceFiles(dir));
const clientFiles = sourceFiles.filter(isUseClientFile);

describe('Format Studio client boundary', () => {
  it('finds the client modules it is supposed to check', () => {
    const names = clientFiles.map((file) => path.basename(file));
    const expectedModules = [
      'FormatDetail.tsx',
      'RulesText.tsx',
      'DiagnosticsList.tsx',
      'StageOutline.tsx',
      'ModuleFacts.tsx',
      // The editor and the starts: each is checked below like the read-only modules.
      'FormatEditor.tsx',
      'NewFormatDialog.tsx',
      'PreviewPanel.tsx',
      'StageInspector.tsx',
      'PublishDialog.tsx',
      'ForkPresetButton.tsx',
    ];
    for (const expected of expectedModules) {
      expect(names, expected).toContain(expected);
    }
  });

  describe.each(clientFiles.map((file) => [rel(file), file] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file, { stopAt: PREEXISTING_BRIDGES });

    it('reaches no zod, server-only, @pkmn or @supabase package', () => {
      const hits = [...graph.packages].filter((pkg) => FORBIDDEN_PACKAGES.some((re) => re.test(pkg)));
      expect(hits).toEqual([]);
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
  });

  it('the pre-existing format-pack bridge is still reached by client code and still pulls zod (no stale exception)', () => {
    const graph = reachableGraph(clientFiles, { stopAt: PREEXISTING_BRIDGES });
    for (const bridge of PREEXISTING_BRIDGES) {
      expect(graph.files.has(bridge), `${rel(bridge)} is no longer reached by a Studio client module`).toBe(true);
      expect([...reachableGraph(bridge).packages].some((pkg) => /^zod(\/|$)/.test(pkg)), `${rel(bridge)} no longer pulls zod`).toBe(true);
    }
  });

  it('the walker is not blind: the client graph contains the kit client barrel and the renderer', () => {
    const detail = clientFiles.find((file) => path.basename(file) === 'FormatDetail.tsx');
    expect(detail).toBeDefined();
    const graph = reachableGraph(detail as string);
    expect(graph.files.has(path.join(KIT, 'client.ts'))).toBe(true);
    expect(graph.files.has(path.join(KIT, 'engine', 'describe-definition.ts'))).toBe(true);
  });

  it('negative control: the server barrel reaches zod', () => {
    const graph = reachableGraph(path.join(KIT, 'index.ts'));
    expect([...graph.packages].some((pkg) => /^zod(\/|$)/.test(pkg))).toBe(true);
  });

  it('every module under the Studio directories imports the kit through the client entry only', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      for (const spec of runtimeSpecifiers(file)) {
        const isKit = spec === '@/lib/format-kit' || spec.startsWith('@/lib/format-kit/');
        if (isKit && spec !== '@/lib/format-kit/client') offenders.push(`${rel(file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no module under the Studio directories imports the kit by a relative path', () => {
    const offenders = sourceFiles.flatMap((file) =>
      runtimeSpecifiers(file)
        .filter((spec) => spec.startsWith('.') && path.resolve(path.dirname(file), spec).startsWith(KIT))
        .map((spec) => `${rel(file)} imports ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
