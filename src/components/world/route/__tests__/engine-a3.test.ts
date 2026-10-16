import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOVER_PRIMER_MS, hoverPrimerDue } from '../HoverChromePrimer';

/**
 * ENGINE-A3 (rollout part A3): the focus hover chrome primer.
 *
 * ENGINE-A4: A3's compile pacing (8 ms slices, busy step-down, baseline-
 * relative thresholds, a cap that adapted only after the compile opened) was
 * reverted after an interleaved same-window A/B on a quiet machine showed no
 * plaza gain (median max gap 134 vs 140 ms, fps 47.4 vs 47.0, reveal
 * 12.6 vs 12.7 s; the keep bar was -20 ms). The restored pacing is pinned in
 * engine-a4.test.ts.
 */

describe('focus hover chrome primer (ENGINE-A3, D23)', () => {
  const ROUTE = join(__dirname, '..');
  const read = (file: string) => readFileSync(join(ROUTE, file), 'utf8');

  it('rasters once, only while the ball shows a presented ceremony', () => {
    expect(hoverPrimerDue('loading', 'presented', false)).toBe(true);
    expect(hoverPrimerDue('loading', 'presented', true)).toBe(false);
    expect(hoverPrimerDue('loading', 'loading', false)).toBe(false);
    expect(hoverPrimerDue('done', 'presented', false)).toBe(false);
    expect(hoverPrimerDue('hidden', 'presented', false)).toBe(false);
    expect(HOVER_PRIMER_MS).toBeGreaterThan(0);
    expect(HOVER_PRIMER_MS).toBeLessThanOrEqual(500);
  });

  it('draws the overlay own bracket and pill classes, invisible and inert, from the route canvas', () => {
    const primer = read('HoverChromePrimer.tsx');
    expect(primer).toMatch(/from '\.\/focus\/FocusHoverOverlay\.module\.css'/);
    expect(primer).toMatch(/styles\.corner/);
    expect(primer).toMatch(/styles\.pill/);
    expect(primer).toMatch(/opacity: 0\.002/);
    expect(primer).toMatch(/pointerEvents: 'none'/);
    expect(primer).toMatch(/aria-hidden="true"/);
    expect(read('RouteWorldCanvas.tsx')).toMatch(/<HoverChromePrimer \/>/);
  });
});
