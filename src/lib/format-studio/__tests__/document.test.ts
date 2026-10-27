import { describe, expect, it } from 'vitest';
import { extractIdentity } from '@/lib/studio-core/identity';
import { skeletonDocument } from '../document';

describe('skeletonDocument', () => {
  it('builds an incomplete document with the name in the base language', () => {
    const doc = skeletonDocument('Spring cup', 'en');
    expect(doc).toEqual({
      schema_version: 1,
      identity: { name: { base: 'en', en: { v: 'Spring cup', s: 'human' } } },
      stages: [],
    });
    expect(extractIdentity(doc).name).toEqual((doc.identity as { name: unknown }).name);
  });

  it('puts a German name under de', () => {
    const doc = skeletonDocument('Frühlingspokal', 'de');
    expect(doc.identity).toEqual({ name: { base: 'de', de: { v: 'Frühlingspokal', s: 'human' } } });
  });
});
