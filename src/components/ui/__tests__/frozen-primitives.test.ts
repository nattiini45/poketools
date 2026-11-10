import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isFrozenSource } from '@/lib/design/frozen-surfaces';

/**
 * Frozen surfaces keep the pre-redesign primitives (docs/design.md, "Direction B primitives"): every module a frozen
 * source reaches imports Button, Card, Badge and buttonStyles from src/components/ui/frozen, never the wrappers on
 * @fluid. The walk follows static imports from the frozen sources and stops at src/components/ui.
 */

const REPO = join(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const REWIRED = ['Button', 'Card', 'Badge', 'Input', 'Textarea', 'index'].map((name) => `src/components/ui/${name}`);

function trackedSources(): Set<string> {
  return new Set(
    execFileSync('git', ['ls-files', '-z', '--', 'src'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 })
      .split('\0')
      .filter((file) => /\.(tsx?|jsx?)$/.test(file)),
  );
}

function resolver(tracked: Set<string>) {
  return (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? `src/${spec.slice(2)}` : spec.startsWith('.') ? normalize(join(dirname(from), spec)) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) if (tracked.has(candidate)) return candidate;
    return null;
  };
}

function importsOf(file: string): string[] {
  const source = readFileSync(join(REPO, file), 'utf8');
  return [...source.matchAll(/(?:import|export)[^;]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] ?? m[2]);
}

describe('frozen surfaces keep the pre-redesign primitives', () => {
  it('no module reachable from a frozen source imports a primitive rewired onto @fluid', () => {
    const tracked = trackedSources();
    const resolve = resolver(tracked);
    const roots = [...tracked].filter((file) => !/(\.test\.|__tests__\/)/.test(file) && isFrozenSource(file.slice('src/'.length)));
    expect(roots.length).toBeGreaterThan(20);
    const seen = new Set(roots);
    const queue = [...roots];
    const offenders: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift()!;
      for (const spec of importsOf(file)) {
        const target = resolve(file, spec);
        if (!target) continue;
        if (target.startsWith('src/components/ui/')) {
          if (REWIRED.some((rewired) => target.replace(/\.tsx?$/, '') === rewired)) offenders.push(`${file} -> ${spec}`);
          continue;
        }
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }
    expect(offenders, 'import these from @/components/ui/frozen/* so the frozen surface keeps its look').toEqual([]);
  });
});
