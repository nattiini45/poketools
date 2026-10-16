import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_POINTS_MAX } from '../points-limits';

describe('points-limits', () => {
  it('LEGACY_POINTS_MAX is 100 000', () => {
    expect(LEGACY_POINTS_MAX).toBe(100_000);
  });

  it('imports nothing: both schema modules read it at module init, so it must stay a leaf', () => {
    const source = readFileSync(join(__dirname, '..', 'points-limits.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toMatch(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/m);
  });
});
