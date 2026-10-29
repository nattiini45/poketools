/**
 * The nine static tests of plan 3.9, and where each one lives. Several were written with the module they guard (the
 * dispatcher, the store, the registry, the Plan); this directory holds the ones that span modules. This map is the
 * checklist: a test that moves or disappears without its replacement fails here, and a test file in this directory that is
 * not on the list fails too. It runs in `npm run test`, so the nine run on every pull request (plan 7.4 suite 1, 7.6 T0).
 *
 *  1. Route manifest drift                      scripts/__tests__/route-manifest.test.mjs
 *  2. Declared guard equals scanned guard        scripts/__tests__/route-manifest.test.mjs
 *  3. No direct writes                           registry import allow-list, loop-static, architecture/no-direct-writes
 *  4. Module-graph privilege                     architecture/module-graph
 *  5. Override allow-list                        session-override-static, dispatch-static
 *  6. Registry invariants                        registry.test, architecture/registry-invariants
 *  7. Catalog completeness                       i18n error-codes and parity tests, architecture/catalog-completeness
 *  8. Repository isolation                       store isolation.test, architecture/repository-isolation
 *  9. Schema parity                              plans/__tests__/parity.test
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './graph';

const AGENT = 'src/lib/ai/admin-agent';

interface Entry {
  n: number;
  name: string;
  files: string[];
}

const MAP: Entry[] = [
  { n: 1, name: 'route manifest drift', files: ['scripts/__tests__/route-manifest.test.mjs'] },
  { n: 2, name: 'declared guard equals scanned guard', files: ['scripts/__tests__/route-manifest.test.mjs'] },
  { n: 3, name: 'no direct writes', files: [`${AGENT}/registry/__tests__/import-allowlist.test.ts`, `${AGENT}/loop/__tests__/loop-static.test.ts`, `${AGENT}/__tests__/architecture/no-direct-writes.test.ts`] },
  { n: 4, name: 'module-graph privilege', files: [`${AGENT}/__tests__/architecture/module-graph.test.ts`, `${AGENT}/dispatch/__tests__/dispatch-static.test.ts`] },
  { n: 5, name: 'override allow-list', files: ['src/lib/auth/__tests__/session-override-static.test.ts', `${AGENT}/dispatch/__tests__/dispatch-static.test.ts`] },
  { n: 6, name: 'registry invariants', files: [`${AGENT}/registry/__tests__/registry.test.ts`, `${AGENT}/__tests__/architecture/registry-invariants.test.ts`] },
  { n: 7, name: 'catalog completeness', files: ['src/i18n/__tests__/error-codes.test.ts', 'src/i18n/__tests__/parity.test.ts', `${AGENT}/__tests__/architecture/catalog-completeness.test.ts`] },
  { n: 8, name: 'repository isolation', files: [`${AGENT}/store/__tests__/isolation.test.ts`, `${AGENT}/__tests__/architecture/repository-isolation.test.ts`] },
  { n: 9, name: 'schema parity', files: [`${AGENT}/plans/__tests__/parity.test.ts`] },
];

const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('plan 3.9: nine static tests', () => {
  it('lists all nine, in order', () => {
    expect(MAP.map((entry) => entry.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it.each(MAP.flatMap((entry) => entry.files.map((file) => [`${entry.n} ${entry.name}`, file] as const)))('%s: %s exists and is picked up by the test run', (_name, file) => {
    expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    // The vitest projects: `app` takes src/**/__tests__/**/*.test.{ts,tsx}, `scripts` takes scripts/**/__tests__/**/*.test.mjs.
    expect(file).toMatch(/^(?:src\/(?:.*\/)?__tests__\/.*\.test\.tsx?|scripts\/(?:.*\/)?__tests__\/.*\.test\.mjs)$/);
  });

  it('has a test file of the assistant that names plan 3.9 in its header, for every file under the assistant', () => {
    for (const entry of MAP) {
      for (const file of entry.files.filter((f) => f.startsWith(AGENT) || f.startsWith('scripts/') || f.includes('session-override-static'))) {
        expect(read(file), `${file} (test ${entry.n})`).toMatch(/3\.9/);
      }
    }
  });

  it('leaves no test file in the architecture directory off the map', () => {
    const onMap = new Set(MAP.flatMap((entry) => entry.files).filter((file) => file.includes('/architecture/')).map((file) => path.basename(file)));
    const present = readdirSync(path.join(REPO_ROOT, AGENT, '__tests__/architecture')).filter((name) => name.endsWith('.test.ts') && name !== 'coverage-map.test.ts');
    expect(present.sort()).toEqual([...onMap].sort());
  });

  it('keeps the scanner functions that tests 1 and 2 call', () => {
    const scanner = read('scripts/lib/route-manifest-scan.mjs');
    expect(scanner).toMatch(/export function compareDeclaredGuards/);
    expect(scanner).toMatch(/export function diffManifests/);
    expect(read('scripts/__tests__/route-manifest.test.mjs')).toMatch(/checkManifest/);
  });

  it('keeps the schema-parity table that test 9 reads, with the three create schemas', () => {
    const parity = read(`${AGENT}/plans/parity.ts`);
    for (const schema of ['seasonCreateRequestSchema', 'phaseCreateSchema', 'tournamentCreateSchema']) expect(parity, schema).toContain(schema);
  });
});
