import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Kilo PR #65 (BallLoader chip placement): while the loader's CSS module has
 * not applied (the root is not yet `position: fixed`), the placement pass
 * re-checks every frame only for a bounded number of tries, then at the
 * resize cadence — a stylesheet that never applies must not cost a style
 * read per frame for the whole load, and a late one must still get the chip
 * placed (an unplaced chip stays hidden under `:not([data-placed])`).
 */

const LOADER = join(process.cwd(), 'src', 'components', 'world', 'route', 'BallLoader.tsx');

function placementEffect(): string {
  const source = readFileSync(LOADER, 'utf8');
  const start = source.indexOf('const place = () => {');
  const end = source.indexOf('}, [overPage, visible]);', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('BallLoader: the unstyled-root retry is bounded', () => {
  it('retries per frame for a bounded number of tries, then on a timer', () => {
    const effect = placementEffect();
    const unstyled = effect.slice(effect.indexOf("if (getComputedStyle(root).position !== 'fixed') {"), effect.indexOf('// Measure the full chip'));
    expect(unstyled).toMatch(/if \(\(unstyledTries \+= 1\) < 240\) \{\s*request\(\);\s*\} else \{\s*window\.clearTimeout\(unstyled\);\s*unstyled = window\.setTimeout\(request, 150\);\s*\}\s*return;/);
    // The old shape — an unconditional per-frame re-request — is gone.
    expect(unstyled).not.toMatch(/\{\s*request\(\);\s*return;/);
  });

  it('the fallback timer is cleared with the effect', () => {
    const effect = placementEffect();
    const cleanup = effect.slice(effect.lastIndexOf('return () => {'));
    expect(cleanup).toMatch(/cancelled = true;/);
    expect(cleanup).toMatch(/window\.clearTimeout\(unstyled\);/);
  });
});
