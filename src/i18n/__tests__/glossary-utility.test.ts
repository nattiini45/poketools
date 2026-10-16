import { describe, expect, it } from 'vitest';
import { epbPack, formatPack, utilityLabel } from '@/lib/format-pack';
import { UTILITY_ORDER } from '@/lib/draft/utility-categories';
import { glossaryMessages } from '../messages/glossary';

/**
 * Utility labels are format-pack data (format-pack spec §E.3): utility keys differ between packs,
 * so they live in `formatPack.messages.<locale>.utility` and are read through `utilityLabel`.
 * The glossary namespace no longer carries a typed `utility` subtree.
 */
describe('utility labels (format pack)', () => {
  it('the glossary namespace has no utility subtree', () => {
    expect(glossaryMessages.en).not.toHaveProperty('utility');
    expect(glossaryMessages.de).not.toHaveProperty('utility');
  });

  it('the active pack labels exactly UTILITY_ORDER, in order, in both languages', () => {
    expect(UTILITY_ORDER).toEqual(epbPack.utility.order);
    expect(Object.keys(formatPack.messages.en.utility)).toEqual([...UTILITY_ORDER]);
    expect(Object.keys(formatPack.messages.de.utility)).toEqual([...UTILITY_ORDER]);
  });

  it('utilityLabel resolves every key to a non-empty label per locale', () => {
    for (const key of UTILITY_ORDER) {
      expect(utilityLabel(key, 'en')).toBe(formatPack.messages.en.utility[key]);
      expect(utilityLabel(key, 'de')).toBe(formatPack.messages.de.utility[key]);
      expect(utilityLabel(key, 'de')).not.toBe('');
    }
  });
});
