/**
 * `ruleConflictText` fills a rule conflict's localized text from its params; with a Pokémon-data
 * localization, the params named in `pkmnParams` are localized first (a move or item name in the
 * viewer's data locale), and the others stay as given. The active pack is replaced by a minimal one
 * that has rule-conflict texts (the example pack has none).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../active', () => ({
  formatPack: {
    epb: {},
    messages: {
      en: { ruleConflicts: { BAN: '{name}: banned ({count} lists).' }, utility: {} },
      de: { ruleConflicts: { BAN: '{name}: gebannt ({count} Listen).' }, utility: {} },
    },
  },
}));

import { ruleConflictText } from '..';

const localize = vi.fn((kind: 'move' | 'item', name: string) => `${kind}:${name.toUpperCase()}`);

describe('ruleConflictText', () => {
  it('fills the params as given without a localization', () => {
    expect(ruleConflictText('BAN', { name: 'Razor Fang', count: 2 }, 'de')).toBe('Razor Fang: gebannt (2 Listen).');
  });

  it('localizes only the params named in pkmnParams', () => {
    expect(
      ruleConflictText('BAN', { name: 'Razor Fang', count: 2 }, 'de', { pkmnParams: { name: 'item' }, localize }),
    ).toBe('item:RAZOR FANG: gebannt (2 Listen).');
    expect(localize).toHaveBeenCalledTimes(1);
    expect(localize).toHaveBeenCalledWith('item', 'Razor Fang');
  });

  it('leaves the params unchanged when the conflict names no Pokémon-data params', () => {
    localize.mockClear();
    expect(ruleConflictText('BAN', { name: 'Razor Fang', count: 1 }, 'en', { pkmnParams: undefined, localize })).toBe(
      'Razor Fang: banned (1 lists).',
    );
    expect(localize).not.toHaveBeenCalled();
  });

  it('returns null for a key without a text', () => {
    expect(ruleConflictText('NOPE', { name: 'x' }, 'en', { pkmnParams: { name: 'move' }, localize })).toBeNull();
  });
});
