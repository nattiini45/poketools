import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SRC_ROOT,
  importChain,
  isUseClientFile,
  listSourceFiles,
  reachableGraph,
  runtimeSpecifiers,
} from './import-graph';

/**
 * Client boundary of the Pokémon localization layer (design pkmn-l10n.md §3.6, §7; critique P3, P11).
 * No `'use client'` module may reach the server-only descriptions, their 44 KB maps, or any `@pkmn/*` package;
 * the client-safe runtime files carry no `@pkmn/` import; each per-kind name module imports exactly one map.
 */

const I18N_DIR = path.join(SRC_ROOT, 'lib/pkmn/i18n');
const DESCRIPTIONS = path.normalize(path.join(I18N_DIR, 'descriptions.server.ts'));
const DESC_JSON = /[\\/]lib[\\/]pkmn[\\/]i18n[\\/]data[\\/][a-z]+\.desc\.de\.json$/;

const CLIENT_SAFE_FILES = [
  'id.ts',
  'types.ts',
  'names.ts',
  'search.ts',
  'calc-text.ts',
  'names/lookup.ts',
  'names/species.ts',
  'names/moves.ts',
  'names/items.ts',
  'names/abilities.ts',
  'names/misc.ts',
];

const KIND_MAPS: Record<string, string> = {
  'names/species.ts': '../data/species.de.json',
  'names/moves.ts': '../data/moves.de.json',
  'names/items.ts': '../data/items.de.json',
  'names/abilities.ts': '../data/abilities.de.json',
  'names/misc.ts': '../data/misc.de.json',
};

const read = (rel: string) => fs.readFileSync(path.join(I18N_DIR, rel), 'utf8');

/**
 * Pre-existing client → `@pkmn/*` bridges, outside this package's files (found when PK-2 landed, 2026-10-09).
 * The walk records them but does not follow them, so any NEW path to `@pkmn/*` still fails. Remove a row once
 * its module is split (the stale-row test below fails when a row no longer bridges anything).
 * - `lib/pkmn/teams.ts` (`@pkmn/sets`): Showdown import/export runs in the teambuilder on the client.
 * (`lib/pkmn/formats.ts` was split: client code reads the dex-free `lib/pkmn/format-catalog.ts`.)
 */
const PREEXISTING_PKMN_BRIDGES: ReadonlySet<string> = new Set(
  ['lib/pkmn/teams.ts'].map((rel) => path.normalize(path.join(SRC_ROOT, rel))),
);

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('client boundary: use-client modules', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  const clientFiles = listSourceFiles(SRC_ROOT).filter(isUseClientFile);
  const graph = reachableGraph(clientFiles, { stopAt: PREEXISTING_PKMN_BRIDGES });

  it('every pre-existing bridge is still reached from client code and still pulls @pkmn/* (no stale rows)', () => {
    for (const bridge of PREEXISTING_PKMN_BRIDGES) {
      expect(graph.files.has(bridge), `${bridge} is no longer reached by a use-client module`).toBe(true);
      const own = reachableGraph(bridge);
      expect([...own.packages].some((p) => p.startsWith('@pkmn/')), `${bridge} no longer imports @pkmn/*`).toBe(
        true,
      );
      expect([...own.files].filter((f) => f === DESCRIPTIONS || DESC_JSON.test(f))).toEqual([]);
    }
  });

  it('never reach lib/pkmn/formats.ts; the dex-free format-catalog.ts reaches no @pkmn/* package', () => {
    const formats = path.normalize(path.join(SRC_ROOT, 'lib/pkmn/formats.ts'));
    expect(graph.files.has(formats) ? importChain(graph, formats) : null).toBeNull();
    const catalog = reachableGraph(path.join(SRC_ROOT, 'lib/pkmn/format-catalog.ts'));
    expect([...catalog.packages].filter((p) => p.startsWith('@pkmn/'))).toEqual([]);
    expect([...catalog.files].map((f) => path.basename(f)).filter((b) => /^(formats|tiers|dex)\.ts$/.test(b))).toEqual(
      [],
    );
  });

  it('finds the use-client modules (sanity)', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(clientFiles).toContain(path.normalize(path.join(SRC_ROOT, 'components/shared/PkmnName.tsx')));
  });

  it('never reach descriptions.server.ts or a *.desc.de.json map', () => {
    const offending = [...graph.files].filter((f) => f === DESCRIPTIONS || DESC_JSON.test(f));
    expect(offending.map((f) => importChain(graph, f))).toEqual([]);
  });

  it('never import an @pkmn/* package', () => {
    const offending = [...graph.packages].filter((p) => p.startsWith('@pkmn/'));
    // Name which client-reachable file imports it, for a useful failure message.
    const importers = [...graph.files].filter((f) =>
      f.endsWith('.json') || PREEXISTING_PKMN_BRIDGES.has(f)
        ? false
        : runtimeSpecifiers(f).some((s) => s.startsWith('@pkmn/')),
    );
    expect({ offending, importers: importers.map((f) => importChain(graph, f)) }).toEqual({
      offending: [],
      importers: [],
    });
  });

  it('PkmnName reaches the five name maps and nothing server-only', () => {
    const own = reachableGraph(path.join(SRC_ROOT, 'components/shared/PkmnName.tsx'));
    const maps = [...own.files].filter((f) => f.endsWith('.json')).map((f) => path.basename(f)).sort();
    expect(maps).toEqual([
      'abilities.de.json',
      'items.de.json',
      'misc.de.json',
      'moves.de.json',
      'species.de.json',
    ]);
    expect([...own.packages].filter((p) => p.startsWith('@pkmn/'))).toEqual([]);
  });
});

describe('client boundary: the runtime files', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it.each(CLIENT_SAFE_FILES)('%s contains no @pkmn/ import', (rel) => {
    expect(read(rel)).not.toMatch(/['"]@pkmn\//);
  });

  it.each(CLIENT_SAFE_FILES)('%s does not reach descriptions.server.ts', (rel) => {
    const files = reachableGraph(path.join(I18N_DIR, rel)).files;
    expect([...files].filter((f) => f === DESCRIPTIONS || DESC_JSON.test(f))).toEqual([]);
  });

  it('descriptions.server.ts starts with import "server-only"', () => {
    expect(read('descriptions.server.ts').trimStart()).toMatch(/^import 'server-only';/);
  });

  it.each(Object.entries(KIND_MAPS))('%s imports exactly one data map (%s)', (rel, map) => {
    const jsonSpecs = runtimeSpecifiers(path.join(I18N_DIR, rel)).filter((s) => s.endsWith('.json'));
    expect(jsonSpecs).toEqual([map]);
  });

  it('names/lookup.ts, search.ts, types.ts and calc-text.ts import no data map', () => {
    for (const rel of ['names/lookup.ts', 'search.ts', 'types.ts', 'calc-text.ts']) {
      expect(runtimeSpecifiers(path.join(I18N_DIR, rel)).filter((s) => s.endsWith('.json'))).toEqual([]);
    }
  });

  it('search.ts is dictionary-free: its runtime imports are ./id and the @/i18n/config constants only', () => {
    expect(runtimeSpecifiers(path.join(I18N_DIR, 'search.ts')).sort()).toEqual(['./id', '@/i18n/config']);
  });

  it('the per-kind modules do not import the barrel', () => {
    for (const rel of Object.keys(KIND_MAPS)) {
      expect(runtimeSpecifiers(path.join(I18N_DIR, rel))).not.toContain('../names');
    }
  });
});
