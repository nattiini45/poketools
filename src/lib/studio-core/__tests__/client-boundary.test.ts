import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, SRC_ROOT, importChain, reachableGraph } from '@/lib/pkmn/i18n/__tests__/import-graph';

/**
 * The studio core is shared by two studios and by the browser. Its client-safe modules (everything but the server
 * ones named below) must reach no `zod`, `server-only`, `@pkmn/*`, `@supabase/*`, `next/*` or React, and no module of
 * either studio or kit: the core is the layer both studios stand on, so it may not know them.
 *
 * Server-side modules are listed on purpose and are not walked: `api-schemas.ts` (zod, Next), `api-body.ts` (the
 * user-facing error), `identity.ts` and `text-schema.ts` (zod), `insert-with-slug.server.ts` (`server-only`, node crypto).
 */

const CORE = path.join(SRC_ROOT, 'lib', 'studio-core');
const CLIENT_SAFE = ['access', 'db-errors', 'document-guard', 'editor-state', 'json', 'keys', 'ltext', 'name', 'patch', 'request', 'slug', 'targets'];
const SERVER_SIDE = ['api-body', 'api-schemas', 'identity', 'insert-with-slug.server', 'text-schema'];

const FORBIDDEN_PACKAGES = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^@supabase\//, /^next(\/|$)/, /^react(-dom)?(\/|$)/];
/** Modules the core must not reach: the studios and the kits stand on the core, not the other way round. */
const STUDIO_SPECIFIC = [
  path.join(SRC_ROOT, 'lib', 'format-kit') + path.sep,
  path.join(SRC_ROOT, 'lib', 'format-studio') + path.sep,
  path.join(SRC_ROOT, 'lib', 'ruleset-kit') + path.sep,
  path.join(SRC_ROOT, 'lib', 'ruleset-studio') + path.sep,
  path.join(SRC_ROOT, 'lib', 'supabase') + path.sep,
];

const rel = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

describe('studio core client boundary', () => {
  it('lists every module of the core as client-safe or server-side', () => {
    const modules = fs
      .readdirSync(CORE)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.replace(/\.ts$/, ''))
      .sort();
    expect(modules).toEqual([...CLIENT_SAFE, ...SERVER_SIDE].sort());
  });

  describe.each(CLIENT_SAFE.map((name) => [name, path.join(CORE, `${name}.ts`)] as const))('%s', (_name, file) => {
    const graph = reachableGraph(file);

    it('reaches no forbidden package', () => {
      expect([...graph.packages].filter((pkg) => FORBIDDEN_PACKAGES.some((re) => re.test(pkg)))).toEqual([]);
    });

    it('reaches no module of a studio or a kit', () => {
      const bad = [...graph.files].filter((reached) => STUDIO_SPECIFIC.some((dir) => reached.startsWith(dir)));
      expect(bad.map((reached) => importChain(graph, reached))).toEqual([]);
    });

    it('stays inside the core and the i18n runtime', () => {
      const outside = [...graph.files].filter((reached) => !reached.startsWith(CORE + path.sep));
      expect(outside.map(rel).filter((name) => !name.startsWith('src/i18n/'))).toEqual([]);
    });
  });

  it('the walker is not blind: the server-side api-schemas reaches zod', () => {
    expect([...reachableGraph(path.join(CORE, 'api-schemas.ts')).packages]).toContain('zod');
  });
});
