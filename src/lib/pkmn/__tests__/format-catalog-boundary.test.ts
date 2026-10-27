import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT, reachableGraph } from '../i18n/__tests__/import-graph';

/**
 * The preset catalog is read by 'use client' modules (the format pickers, the ruleset builder, the studios), so its
 * import closure must stay dex-free and server-free: no `@pkmn/*`, no `server-only`, no `.server` module, no rule
 * data (`preset-data/*`: the tables are server-side), no dex and no tier code. The format id parser and the clause
 * catalog are the client-safe siblings and have no imports beyond the id fold.
 */
const PKMN = path.join(SRC_ROOT, 'lib/pkmn');
const rel = (file: string) => path.relative(PKMN, file).split(path.sep).join('/');

describe('the preset catalog stays client-safe', () => {
  for (const entry of ['format-catalog.ts', 'ruleset-preset-catalog.ts', 'format-id.ts', 'clauses.ts', 'preset-rules.ts']) {
    it(`${entry} reaches no @pkmn package, no server module and no rule data`, () => {
      const graph = reachableGraph(path.join(PKMN, entry));
      expect([...graph.packages].filter((name) => name.startsWith('@pkmn/') || name === 'server-only')).toEqual([]);
      const files = [...graph.files].map(rel);
      expect(files.filter((file) => /\.server\.ts$|^preset-data\/|^(dex|tiers|formats|species-list|known-ids)(\.|\/)/.test(file))).toEqual([]);
    });
  }

  it('the catalog reaches exactly the parser and itself, its picker view the catalog and the key pattern, the clause catalog the id fold and itself', () => {
    expect([...reachableGraph(path.join(PKMN, 'format-catalog.ts')).files].map(rel).sort()).toEqual(['format-catalog.ts', 'format-id.ts']);
    expect([...reachableGraph(path.join(PKMN, 'ruleset-preset-catalog.ts')).files].map(rel).sort()).toEqual([
      '../studio-core/keys.ts',
      'format-catalog.ts',
      'format-id.ts',
      'ruleset-preset-catalog.ts',
    ]);
    expect([...reachableGraph(path.join(PKMN, 'clauses.ts')).files].map(rel).sort()).toEqual(['clauses.ts', 'i18n/id.ts']);
    expect([...reachableGraph(path.join(PKMN, 'format-id.ts')).files].map(rel)).toEqual(['format-id.ts']);
  });
});
