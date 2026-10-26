import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The ruleset kit is client-safe: the editor runs `compileRuleset` in the browser with the same code the server publishes
 * with. This test walks the runtime import closure of `client.ts` with regexes over the source text (not a bundler) and
 * fails on `zod`, `server-only`, `@pkmn/*`, `next/*`, `react` and `@/lib/supabase/*`, and on any module outside the kit
 * that is not on the allow-list: each of those is dex-free, import-free or itself walked.
 */

const KIT = path.resolve(__dirname, '..');
const SRC = path.resolve(KIT, '../..');

/** Modules outside the kit that the kit may import at runtime, and why. */
const ALLOWED_OUTSIDE = new Set([
  // The shared JSON, hash, patch and key helpers of the studio core (client-safe by its own boundary test).
  '@/lib/studio-core/json',
  '@/lib/studio-core/keys',
  '@/lib/studio-core/patch',
  // The one id fold, the one format-id parser and the clause catalog: no imports of their own besides each other.
  '@/lib/pkmn/i18n/id',
  '@/lib/pkmn/format-id',
  '@/lib/pkmn/clauses',
  '@/lib/pkmn/team-constraints',
]);

const FORBIDDEN_BARE = [/^zod(\/|$)/, /^server-only$/, /^@pkmn\//, /^next(\/|$)/, /^react(-dom)?(\/|$)/, /^@\/lib\/supabase\//];

/** Runtime import specifiers of a source text: skips `import type` and `export type`. */
function importSpecifiers(source: string): string[] {
  const text = source.replace(/\r\n/g, '\n');
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(statement)) {
    if (m[2] === undefined) found.push(m[4]);
  }
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(m[1]);
  return found;
}

function resolveFile(base: string): string | null {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function closure(entry: string): { files: Set<string>; violations: string[] } {
  const files = new Set<string>();
  const violations: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (FORBIDDEN_BARE.some((pattern) => pattern.test(specifier))) {
        violations.push(`${path.relative(SRC, file)} imports ${specifier}`);
        continue;
      }
      let target: string | null = null;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        target = resolveFile(path.resolve(path.dirname(file), specifier));
      } else if (specifier.startsWith('@/')) {
        if (!ALLOWED_OUTSIDE.has(specifier)) {
          violations.push(`${path.relative(SRC, file)} imports ${specifier} (not allowed outside the kit)`);
          continue;
        }
        target = resolveFile(path.resolve(SRC, specifier.slice(2)));
      } else {
        violations.push(`${path.relative(SRC, file)} imports the package ${specifier}`);
        continue;
      }
      if (target === null) violations.push(`${path.relative(SRC, file)} imports ${specifier}, which does not resolve`);
      else queue.push(target);
    }
  }
  return { files, violations };
}

describe('ruleset-kit client boundary', () => {
  const walked = closure(path.resolve(KIT, 'client.ts'));

  it('reaches no zod, server-only, @pkmn, next, react or supabase module, and no module outside the allow-list', () => {
    expect(walked.violations).toEqual([]);
  });

  it('walks the kit files and the shared helpers it is meant to use', () => {
    const relative = [...walked.files].map((file) => path.relative(SRC, file).replace(/\\/g, '/'));
    expect(relative).toEqual(
      expect.arrayContaining(['lib/ruleset-kit/validate.ts', 'lib/ruleset-kit/compile.ts', 'lib/ruleset-kit/effective.ts', 'lib/pkmn/i18n/id.ts']),
    );
  });
});
