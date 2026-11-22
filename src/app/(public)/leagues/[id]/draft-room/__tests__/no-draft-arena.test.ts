/**
 * The click-to-pick arena is retired (draft-frontend §8.2): its directory is
 * gone and nothing under `src/` imports `draft-arena` any more.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sourceFiles, sourceText, walkStats } from '@/test/file-walk';

const SRC = path.resolve(__dirname, '../../../../../..');
const SELF = path.resolve(__filename);
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"][^'"]*draft-arena[^'"]*['"]/;

// The shared walker enumerates a dir once per process and caches each file's text across tests
// (issue #144); 30 s remains the backstop for the one-time text read of the whole tree under load.
const FILE_WALK_TIMEOUT_MS = 30_000;

describe('draft-arena retirement', { timeout: FILE_WALK_TIMEOUT_MS }, () => {
  it('resolves src/ correctly', () => {
    expect(path.basename(SRC)).toBe('src');
  });

  it('the arena directory is deleted', () => {
    expect(existsSync(path.join(SRC, 'components', 'draft-arena'))).toBe(false);
  });

  it('the shared walk enumerates a directory once per process (issue #144)', () => {
    const before = walkStats.enumerations;
    sourceFiles(SRC);
    sourceFiles(SRC);
    expect(walkStats.enumerations - before).toBe(1);
  });

  it('no source file imports draft-arena', () => {
    const offenders = sourceFiles(SRC, (rel) => /\.(tsx?|mjs|jsx?)$/.test(rel)).filter(
      (file) => path.resolve(file) !== SELF && IMPORT.test(sourceText(file)),
    );
    expect(offenders).toEqual([]);
  });
});
