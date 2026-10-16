import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * [site palettes, C5] The palette panel hangs ~250 px below the revealed bar
 * but is a DOM descendant of `#site-nav`. A pointer over it must count as on
 * the bar (y: 0), or the bar slides away under an open panel. The hook has no
 * DOM test (node env), so this pins the source; the machine side is in
 * `src/lib/route-world/__tests__/nav-reveal.test.ts`.
 */
describe('RouteNavReveal pointer hold over the bar subtree', () => {
  const source = readFileSync(path.resolve(__dirname, '../RouteNavReveal.tsx'), 'utf8');
  const start = source.indexOf('const onPointerMove');
  const end = source.indexOf('const onMouseOut', start);
  const body = source.slice(start, end);

  it('dispatches y: 0 when the pointer target is inside #site-nav', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body).toContain("type: 'pointer'");
    expect(body).toMatch(/siteNav\(\)\?\.contains\(event\.target[^)]*\)\s*\?\s*0\s*:\s*event\.clientY/);
  });
});
