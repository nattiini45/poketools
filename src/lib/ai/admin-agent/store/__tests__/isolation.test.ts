/**
 * Plan 3.9 test 8, repository isolation: `.from('admin_agent_...')` and `.rpc('admin_agent_...')` appear only under
 * `store/`, and every store method takes a typed `adminId` first and refuses a forged one before it reaches a query.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAdminAgentStore } from '../create';
import { FakeDb } from './fake-db';

const SRC = path.resolve(__dirname, '../../../../..');
const STORE = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

/** Test files and test helpers may name the tables (the migration suites do); production code may not. */
const isTestCode = (file: string) => /\.test\.|[\\/]__tests__[\\/]|[\\/]test[\\/]/.test(file);

describe('only the store touches the assistant\'s tables', () => {
  const production = walk(SRC).filter((file) => !isTestCode(file) && !file.startsWith(STORE + path.sep));

  it('finds source to scan', () => {
    expect(production.length).toBeGreaterThan(500);
  });

  it("has no .from('admin_agent_ or .rpc('admin_agent_ outside store/", () => {
    const offenders = production.filter((file) => /\.(?:from|rpc)\(\s*['"`]admin_agent_/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
  }, 30_000); // reads every production source: slow on a loaded machine

  it('keeps the service-role client out of anything but the store', () => {
    const files = walk(STORE).filter((file) => !isTestCode(file));
    const importers = files.filter((file) => /@\/lib\/supabase\/client['"]/.test(readFileSync(file, 'utf8')));
    expect(importers.map((file) => path.basename(file))).toEqual(['index.ts']);
  });
});

describe('every store method takes a typed adminId first', () => {
  const db = new FakeDb();
  const store = createAdminAgentStore(db.client);
  const methods = Object.entries(store).flatMap(([group, repository]) =>
    Object.entries(repository as Record<string, unknown>)
      .filter(([, fn]) => typeof fn === 'function')
      .map(([name, fn]) => [`${group}.${name}`, fn as (...args: unknown[]) => Promise<unknown>] as const),
  );

  it('covers the whole surface', () => {
    expect(methods.length).toBeGreaterThanOrEqual(40);
  });

  it.each(methods)('%s refuses a forged adminId before any query', async (_name, fn) => {
    for (const forged of [undefined, null, '', 'not-a-uuid', 42, {}, '33333333-3333-4333-8333-333333333333;drop']) {
      let outcome: unknown;
      try {
        outcome = await fn(forged, '44444444-4444-4444-8444-444444444444', {}, {});
      } catch (error) {
        outcome = error;
      }
      expect(outcome).toBeInstanceOf(TypeError);
    }
    expect(db.calls).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('declares AdminId as the first parameter in every repository source', () => {
    const files = ['conversations', 'messages', 'plans', 'proposals', 'actions', 'refs', 'snapshots', 'usage'].map((name) => path.join(STORE, `${name}.ts`));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // Every method signature in the returned object: `async name(adminId: AdminId, ...)` (or an `api` member).
      const signatures = [...source.matchAll(/^ {4}(?:async )?([a-zA-Z]+)(?:<T>)?\(([^)]*)\)[^{;]*: Promise</gm)];
      expect(signatures.length, file).toBeGreaterThan(0);
      for (const [, name, parameters] of signatures) {
        expect(parameters.trim().startsWith('adminId: AdminId'), `${path.basename(file)}: ${name}`).toBe(true);
      }
    }
  });
});
