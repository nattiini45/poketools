/**
 * The shared-team and library-entry pages localize every name on the server, so no `'use client'` module they reach
 * may pull a German name table into the browser bundle (VAL-SEO-013: `TypeBadge` shipped `misc.de.json` into both
 * route chunks). Walks the static import graph: server modules may reach the tables, client modules may not.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT, importChain, isUseClientFile, reachableGraph } from '@/lib/pkmn/i18n/__tests__/import-graph';

const PAGES = ['app/(public)/teams/shared/[token]/page.tsx', 'app/(public)/teams/library/[id]/page.tsx'];
const NAME_TABLE = /[\\/]lib[\\/]pkmn[\\/]i18n[\\/]data[\\/][^\\/]+\.json$/;

describe.each(PAGES)('%s', (rel) => {
  const page = path.join(SRC_ROOT, rel);
  const clientModules = [...reachableGraph(page).files].filter(
    (file) => /\.tsx?$/.test(file) && isUseClientFile(file),
  );

  it('reaches at least one client island (the walk is not vacuous)', () => {
    expect(clientModules.length).toBeGreaterThan(0);
  });

  it('ships no name table through a client module', () => {
    const offenders = clientModules.flatMap((client) => {
      const graph = reachableGraph(client);
      return [...graph.files].filter((file) => NAME_TABLE.test(file)).map((file) => importChain(graph, file));
    });
    expect(offenders).toEqual([]);
  });
});
