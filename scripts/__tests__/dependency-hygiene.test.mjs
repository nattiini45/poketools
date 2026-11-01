/**
 * Dependency hygiene: packages nothing imports stay out of package.json, type-only packages are dev
 * dependencies, and the scripts that hold the service-role key run a locked `tsx` (`npx --no-install tsx`),
 * never whatever version `npx` would download that day.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));

describe('package.json dependencies', () => {
  it.each(['@dnd-kit/core', '@dnd-kit/utilities', '@react-three/rapier', 'zustand'])('does not list the unused %s', (name) => {
    expect(pkg.dependencies?.[name]).toBeUndefined();
    expect(pkg.devDependencies?.[name]).toBeUndefined();
    expect(lock.packages[''].dependencies?.[name]).toBeUndefined();
  });

  it('keeps zustand only as a transitive dependency of the three.js renderer', () => {
    expect(lock.packages['node_modules/zustand']).toBeDefined();
    expect(lock.packages['node_modules/@react-three/fiber'].dependencies.zustand).toBeDefined();
  });

  it('lists the type-only @types/three as a dev dependency', () => {
    expect(pkg.dependencies['@types/three']).toBeUndefined();
    expect(pkg.devDependencies['@types/three']).toBeDefined();
  });

  it('pins tsx in devDependencies and the lockfile', () => {
    expect(pkg.devDependencies.tsx).toMatch(/^\^?\d+\.\d+\.\d+$/);
    expect(lock.packages['node_modules/tsx']?.version).toBeDefined();
  });

  it('keeps both DOM-to-image libraries (Firefox blocks foreignObject, see src/lib/utils/export-node.ts)', () => {
    expect(pkg.dependencies['html-to-image']).toBeDefined();
    expect(pkg.dependencies.html2canvas).toBeDefined();
  });
});

describe('tsx invocations', () => {
  it('never call npx tsx without --no-install in a tracked file', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-n', '-I', '-e', 'npx tsx', '--', '.', ':!scripts/__tests__/*'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (error) {
      if (error.status !== 1) throw error; // git grep exits 1 when nothing matches
    }
    expect(out.trim()).toBe('');
  });

  it('keeps the --tsconfig flag on the audit script', () => {
    expect(pkg.scripts['audit:seasons']).toBe(
      'npx --no-install tsx --tsconfig scripts/tsconfig.audit.json scripts/run-season-audit.ts',
    );
  });
});
