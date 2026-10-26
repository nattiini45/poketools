import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN } from '@/lib/studio-core/keys';
import { slugFromName } from '../slug';

// The folding and suffix rules are the studio core's (`studio-core/__tests__/slug.test.ts`); here only the format binding.
describe('format slugs', () => {
  it('fold a name with the shared rules', () => {
    expect(slugFromName('Swiss Cup 2026')).toBe('swiss-cup-2026');
  });

  it('use "format" for a name with nothing usable, and that is a valid slug', () => {
    for (const name of ['', '🔥🔥🔥', '---', '日本語']) {
      expect(slugFromName(name)).toBe('format');
      expect(slugFromName(name)).toMatch(SLUG_PATTERN);
    }
  });
});
