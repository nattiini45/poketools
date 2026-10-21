import { describe, expect, it, vi } from 'vitest';
import movesDesc from '../data/moves.desc.de.json';
import { localizeDesc } from '../descriptions.server';

const STEALTH_ROCK_EN = 'Hurts foes on switch-in. Factors Rock weakness.';
const CEASELESS_EDGE_EN = 'Sets a layer of Spikes on the opposing side.';

describe('localizeDesc', () => {
  it("'de' gives the German game text for a move with one", () => {
    const out = localizeDesc('move', 'Stealth Rock', STEALTH_ROCK_EN, 'de');
    expect(out).toEqual({ text: movesDesc.stealthrock, lang: 'de', source: 'game' });
    expect(out.text).not.toBe(STEALTH_ROCK_EN);
    expect(out.text.length).toBeGreaterThan(10);
  });

  it("'de' falls back to the English Showdown text for an SV-new move (no German game text)", () => {
    expect(localizeDesc('move', 'Ceaseless Edge', CEASELESS_EDGE_EN, 'de')).toEqual({
      text: CEASELESS_EDGE_EN,
      lang: 'en',
      source: 'showdown',
    });
  });

  it("'en' returns the input unchanged", () => {
    expect(localizeDesc('move', 'Stealth Rock', STEALTH_ROCK_EN, 'en')).toEqual({
      text: STEALTH_ROCK_EN,
      lang: 'en',
      source: 'showdown',
    });
  });

  it('abilities and items, by name or id', () => {
    expect(localizeDesc('ability', 'Intimidate', 'en text', 'de').lang).toBe('de');
    expect(localizeDesc('item', 'Leftovers', 'en text', 'de').lang).toBe('de');
    expect(localizeDesc('item', 'leftovers', 'en text', 'de').lang).toBe('de');
  });

  it('a typed Hidden Power shares the Hidden Power text', () => {
    const base = localizeDesc('move', 'Hidden Power', 'en', 'de');
    expect(base.lang).toBe('de');
    expect(localizeDesc('move', 'Hidden Power Fire', 'en', 'de').text).toBe(base.text);
  });

  it('unknown names and prototype keys fall back to English', () => {
    expect(localizeDesc('move', 'Not A Move', 'en', 'de')).toEqual({ text: 'en', lang: 'en', source: 'showdown' });
    expect(localizeDesc('move', 'constructor', 'en', 'de').lang).toBe('en');
    expect(localizeDesc('move', '', 'en', 'de').lang).toBe('en');
  });
});

describe('localizeDesc with a reviewed override (desc.de.json slot)', () => {
  it('an override entry merged by the generator wins over the English fallback', async () => {
    // The generator merges scripts/pkmn-i18n/overrides/desc.de.json into the committed map; simulate one SV entry.
    vi.resetModules();
    vi.doMock('../data/moves.desc.de.json', () => ({
      default: { ceaselessedge: 'Der Anwender greift mit einer muschelartigen Klinge an. (Override)' },
    }));
    const { localizeDesc: withOverride } = await import('../descriptions.server');
    expect(withOverride('move', 'Ceaseless Edge', CEASELESS_EDGE_EN, 'de')).toEqual({
      text: 'Der Anwender greift mit einer muschelartigen Klinge an. (Override)',
      lang: 'de',
      source: 'game',
    });
    vi.doUnmock('../data/moves.desc.de.json');
    vi.resetModules();
  });
});
