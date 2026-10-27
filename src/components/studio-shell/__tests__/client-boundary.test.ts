import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC_ROOT, importChain, isUseClientFile, listSourceFiles, reachableGraph } from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The studio shell is the editor frame both studios share, so it must not know either of them. Every module under
 * `src/components/studio-shell` (the 'use client' ones and the plain ones) reaches:
 *
 *  - no `@pkmn/*`, `@supabase/*` or `server-only`, and nothing under `src/lib/supabase`;
 *  - no module of the format kit or the ruleset kit, no module of either studio's library, and no component of either
 *    studio: a studio hands the shell its words, requests and summaries as props.
 *
 * `zod` is reached through one bridge that every client component using `useApiErrorText` has (`api-errors` -> the enum
 * catalog -> the format pack, app-wide, see the Format Studio's client boundary test); it is not followed.
 */

const SHELL = path.join(SRC_ROOT, 'components', 'studio-shell');
const PREEXISTING_BRIDGES: ReadonlySet<string> = new Set([path.join(SRC_ROOT, 'lib', 'format-pack', 'index.ts')]);

const FORBIDDEN_PACKAGES = [/^@pkmn\//, /^@supabase\//, /^server-only$/];
const STUDIO_SPECIFIC = [
  path.join(SRC_ROOT, 'lib', 'format-kit'),
  path.join(SRC_ROOT, 'lib', 'format-studio'),
  path.join(SRC_ROOT, 'lib', 'ruleset-kit'),
  path.join(SRC_ROOT, 'lib', 'ruleset-studio'),
  path.join(SRC_ROOT, 'lib', 'supabase'),
  path.join(SRC_ROOT, 'components', 'format-studio'),
  path.join(SRC_ROOT, 'components', 'ruleset-studio'),
].map((dir) => dir + path.sep);

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const files = listSourceFiles(SHELL).filter((file) => !file.includes(`${path.sep}__tests__${path.sep}`));

describe('studio shell boundary', () => {
  it('finds the modules it is supposed to check', () => {
    const names = files.map((file) => path.basename(file));
    for (const expected of ['EditorToolbar.tsx', 'EditorLayout.tsx', 'useDraftEditor.ts', 'useUnsavedGuard.ts', 'PublishDialog.tsx', 'ShareDialog.tsx', 'ConflictDialog.tsx', 'ForkDialog.tsx', 'DeleteDialog.tsx', 'LibraryCard.tsx', 'LibraryList.tsx', 'StartActionButton.tsx', 'text.ts']) {
      expect(names, expected).toContain(expected);
    }
    expect(files.some(isUseClientFile)).toBe(true);
  });

  describe.each(files.map((file) => [rel(file), file] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file, { stopAt: PREEXISTING_BRIDGES });

    it('reaches no dex, Supabase or server-only package', () => {
      expect([...graph.packages].filter((pkg) => FORBIDDEN_PACKAGES.some((re) => re.test(pkg)))).toEqual([]);
    });

    it('reaches no module of a kit, a studio library or a studio component', () => {
      const bad = [...graph.files].filter((reached) => STUDIO_SPECIFIC.some((dir) => reached.startsWith(dir)));
      expect(bad.map((reached) => importChain(graph, reached))).toEqual([]);
    });
  });
});
