import { describe, expect, it } from 'vitest';
import { draftFinderMessages } from '@/i18n/messages/draft/finder';

/** Dotted leaf paths with their placeholder sets (a plural leaf counts as one leaf). */
function leaves(tree: object, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(','));
    } else if (value && typeof value === 'object' && 'other' in value && typeof value.other === 'string') {
      out.set(path, 'plural');
    } else if (value && typeof value === 'object') {
      for (const [k, v] of leaves(value, path)) out.set(k, v);
    }
  }
  return out;
}

describe('draft/finder messages', () => {
  it('has the same keys and placeholders in English and German', () => {
    expect([...leaves(draftFinderMessages.de)].sort()).toEqual([...leaves(draftFinderMessages.en)].sort());
  });

  it('stores sentence case only (ALL CAPS is CSS) and German quotes or none', () => {
    const all = JSON.stringify(draftFinderMessages.en) + JSON.stringify(draftFinderMessages.de);
    // A straight double quote inside a value is serialized as \".
    expect(all).not.toContain('\\"');
    expect(all).not.toMatch(/\b[A-ZÄÖÜ]{5,}\b/);
  });
});
