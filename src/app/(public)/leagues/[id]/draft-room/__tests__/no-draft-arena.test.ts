/**
 * The click-to-pick arena is retired (draft-frontend §8.2): its directory is
 * gone and nothing under `src/` imports `draft-arena` any more.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../../../../..');
const SELF = path.resolve(__filename);
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*draft-arena[^'"]*['"]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(tsx?|mjs|jsx?)$/.test(name)) out.push(full);
  }
  return out;
}

// Walks the source tree: under a loaded full suite or a cold clone the walk can pass the
// 5 s default (engine-r3-contract.test.ts uses the same bound).
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('draft-arena retirement', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('resolves src/ correctly', () => {
    expect(path.basename(SRC)).toBe('src');
  });

  it('the arena directory is deleted', () => {
    expect(existsSync(path.join(SRC, 'components', 'draft-arena'))).toBe(false);
  });

  it('no source file imports draft-arena', () => {
    const offenders = sourceFiles(SRC).filter(
      (file) => path.resolve(file) !== SELF && IMPORT.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
