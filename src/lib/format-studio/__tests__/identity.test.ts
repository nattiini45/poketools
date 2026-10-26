import { describe, expect, it } from 'vitest';
import { ltext } from '@/lib/format-kit';
import { extractIdentity, hasSummary, skeletonDocument } from '../identity';

describe('extractIdentity', () => {
  it('reads a valid name and summary', () => {
    const name = ltext('en', 'Spring cup', 'Frühlingspokal');
    const summary = ltext('de', undefined, 'Kurze Beschreibung');
    const identity = extractIdentity({ identity: { name, summary } });
    expect(identity.name).toEqual(name);
    expect(identity.description).toEqual(summary);
  });

  it('gives null for a missing identity block', () => {
    expect(extractIdentity({})).toEqual({ name: null, description: null });
    expect(extractIdentity({ identity: null })).toEqual({ name: null, description: null });
    expect(extractIdentity({ identity: [] })).toEqual({ name: null, description: null });
    expect(extractIdentity(null)).toEqual({ name: null, description: null });
    expect(extractIdentity('text')).toEqual({ name: null, description: null });
  });

  it('gives null for a text that is not a valid localized text', () => {
    expect(extractIdentity({ identity: { name: 'Plain string' } }).name).toBeNull();
    expect(extractIdentity({ identity: { name: { base: 'en' } } }).name).toBeNull();
    expect(extractIdentity({ identity: { name: { base: 'de', en: { v: 'x', s: 'human' } } } }).name).toBeNull();
    expect(extractIdentity({ identity: { name: { base: 'en', en: { v: '', s: 'human' } } } }).name).toBeNull();
    expect(extractIdentity({ identity: { name: { base: 'en', en: { v: 'x', s: 'human' }, extra: 1 } } }).name).toBeNull();
  });

  it('keeps a valid name when the summary is broken', () => {
    const name = ltext('en', 'Cup');
    const identity = extractIdentity({ identity: { name, summary: 42 } });
    expect(identity.name).toEqual(name);
    expect(identity.description).toBeNull();
  });

  it('does not read inherited members', () => {
    const inherited = Object.create({ identity: { name: ltext('en', 'Cup') } }) as unknown;
    expect(extractIdentity(inherited).name).toBeNull();
  });
});

describe('hasSummary', () => {
  it('tells a present summary (valid or not) from an absent one', () => {
    expect(hasSummary({ identity: { summary: ltext('en', 'x') } })).toBe(true);
    expect(hasSummary({ identity: { summary: 7 } })).toBe(true);
    expect(hasSummary({ identity: { name: ltext('en', 'x') } })).toBe(false);
    expect(hasSummary({})).toBe(false);
    expect(hasSummary(null)).toBe(false);
  });
});

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
