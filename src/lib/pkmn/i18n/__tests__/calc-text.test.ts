import { describe, expect, it } from 'vitest';
import { calculate, Field, Generations, Move, Pokemon } from '@smogon/calc';
import { DE_AFTER_ITEMS, formatKo, koAfterItems, koLevel, toKoInfo, type KoInfo, type KoLevel } from '../calc-text';
import { germanAbility } from '../names/abilities';
import { germanItem } from '../names/items';
import { localizeStatus, localizeWeather } from '../names/misc';
import { germanMove } from '../names/moves';

/** The old CalcTab.tsx parseKoChance, kept here to pin koLevel to the same thresholds. */
function parseKoChance(text: string): KoLevel {
  if (!text || text === 'N/A') return 'unlikely';
  const lower = text.toLowerCase();
  if (lower.includes('guaranteed') || lower === '100%') return 'guaranteed';
  const match = lower.match(/(\d+(?:\.\d+)?)%/);
  if (match) {
    const pct = parseFloat(match[1]);
    if (pct >= 80) return 'likely';
    if (pct >= 20) return 'possible';
  }
  return 'unlikely';
}

const ko = (n: number, chance: number | null, conditional = false): KoInfo => ({ n, chance, conditional });

describe('toKoInfo', () => {
  it.each([
    [{ chance: 1, n: 1, text: 'guaranteed OHKO' }, ko(1, 1)],
    [{ chance: 0.375, n: 2, text: '37.5% chance to 2HKO' }, ko(2, 0.375)],
    [{ chance: undefined, n: 3, text: 'possible 3HKO' }, ko(3, null)],
    [{ chance: 0, n: 0, text: '' }, ko(0, 0)],
    [{ chance: 1, n: 2, text: 'guaranteed 2HKO after Stealth Rock' }, ko(2, 1, true)],
    [{ chance: 0.5, n: 2, text: '50% chance to 2HKO after Stealth Rock and Leftovers recovery' }, ko(2, 0.5, true)],
  ])('%o', (input, expected) => {
    expect(toKoInfo(input)).toEqual(expected);
  });

  it('null / undefined give null', () => {
    expect(toKoInfo(null)).toBeNull();
    expect(toKoInfo(undefined)).toBeNull();
  });

  it('"Afterburner"-like words do not count as conditional', () => {
    expect(toKoInfo({ chance: 1, n: 1, text: 'guaranteed OHKO' })?.conditional).toBe(false);
    expect(toKoInfo({ chance: 1, n: 1, text: 'guaranteed OHKO afterwards' })?.conditional).toBe(false);
  });
});

describe('koLevel', () => {
  it.each([
    [{ chance: 1, n: 1, text: 'guaranteed OHKO' }],
    [{ chance: 0.875, n: 1, text: '87.5% chance to OHKO' }],
    [{ chance: 0.8, n: 2, text: '80% chance to 2HKO' }],
    [{ chance: 0.795, n: 2, text: '79.5% chance to 2HKO' }],
    [{ chance: 0.375, n: 2, text: '37.5% chance to 2HKO' }],
    [{ chance: 0.2, n: 2, text: '20% chance to 2HKO' }],
    [{ chance: 0.199, n: 3, text: '19.9% chance to 3HKO' }],
    [{ chance: undefined, n: 3, text: 'possible 3HKO' }],
    [{ chance: 0, n: 0, text: '' }],
  ])('matches the old parseKoChance for %o', (input) => {
    expect(koLevel(toKoInfo(input))).toBe(parseKoChance(input.text));
  });

  it('null is unlikely', () => {
    expect(koLevel(null)).toBe('unlikely');
  });
});

describe('formatKo', () => {
  it('en', () => {
    expect(formatKo(ko(1, 1), 'en')).toBe('guaranteed OHKO');
    expect(formatKo(ko(2, 0.375), 'en')).toBe('37.5% chance to 2HKO');
    expect(formatKo(ko(3, null), 'en')).toBe('possible 3HKO');
    expect(formatKo(ko(2, 1, true), 'en')).toBe('guaranteed 2HKO (conditional)');
    expect(formatKo(ko(0, 0), 'en')).toBe('');
    expect(formatKo(ko(2, 0), 'en')).toBe('');
    expect(formatKo(null, 'en')).toBe('');
  });

  it('de, with the decimal comma "37,5 %"', () => {
    expect(formatKo(ko(1, 1), 'de')).toBe('garantierter OHKO');
    // de-DE puts a no-break space between number and percent sign.
    expect(formatKo(ko(2, 0.375), 'de')).toBe('37,5 % Chance auf 2HKO');
    expect(formatKo(ko(3, null), 'de')).toBe('möglicher 3HKO');
    expect(formatKo(ko(2, 0.5, true), 'de')).toBe('50 % Chance auf 2HKO (bedingt)');
    expect(formatKo(null, 'de')).toBe('');
  });

  it('rounds and clamps like @smogon/calc (one decimal, 0.1 %–99.9 %)', () => {
    expect(formatKo(ko(1, 0.99996), 'en')).toBe('99.9% chance to OHKO');
    expect(formatKo(ko(1, 0.00001), 'en')).toBe('0.1% chance to OHKO');
    expect(formatKo(ko(2, 0.12345), 'en')).toBe('12.3% chance to 2HKO');
  });
});

/** A real @smogon/calc KO result (Gen 9, default sets) so the regression tests use the calc's own text. */
function realKo(
  attacker: string,
  defender: string,
  move: string,
  defenderOptions: { item?: string; ability?: string },
  field: ConstructorParameters<typeof Field>[0] = {},
) {
  const gen = Generations.get(9);
  return calculate(gen, new Pokemon(gen, attacker), new Pokemon(gen, defender, defenderOptions), new Move(gen, move), new Field(field)).kochance();
}

describe('formatKo keeps the calc "after …" clauses (review L3: no collapse into "(conditional)")', () => {
  it('en: a hazard KO renders the calc string unchanged', () => {
    const calc = realKo('Garchomp', 'Toxapex', 'Earthquake', { item: 'Black Sludge' }, { defenderSide: { isSR: true, spikes: 1 } });
    expect(calc.text).toBe('guaranteed OHKO after Stealth Rock and 1 layer of Spikes');
    expect(formatKo(toKoInfo(calc), 'en', calc.text)).toBe(calc.text);
  });

  it('en: a Leftovers KO renders the calc string unchanged', () => {
    const calc = realKo('Tyranitar', 'Ferrothorn', 'Fire Punch', { item: 'Leftovers' });
    expect(calc.text).toBe('guaranteed 2HKO after Leftovers recovery');
    expect(formatKo(toKoInfo(calc), 'en', calc.text)).toBe(calc.text);
  });

  it('en: a hazard + Leftovers chance KO renders the calc string unchanged', () => {
    const calc = realKo('Garchomp', 'Corviknight', 'Fire Fang', { item: 'Leftovers', ability: 'Pressure' }, { defenderSide: { isSR: true } });
    expect(calc.text).toMatch(/^\d+(\.\d)?% chance to 3HKO after Stealth Rock and Leftovers recovery$/);
    expect(formatKo(toKoInfo(calc), 'en', calc.text)).toBe(calc.text);
  });

  it('en: the two-chance form and "approx." come through verbatim', () => {
    const text = '37.5% chance to 2HKO after Stealth Rock (guaranteed 2HKO after Leftovers recovery)';
    expect(formatKo(toKoInfo({ chance: 1, n: 2, text }), 'en', text)).toBe(text);
  });

  it('de: the after items are translated', () => {
    const hazard = realKo('Garchomp', 'Toxapex', 'Earthquake', { item: 'Black Sludge' }, { defenderSide: { isSR: true, spikes: 1 } });
    expect(formatKo(toKoInfo(hazard), 'de', hazard.text)).toBe('garantierter OHKO nach Tarnsteine und 1 Lage Stachler');
    const lefties = realKo('Tyranitar', 'Ferrothorn', 'Fire Punch', { item: 'Leftovers' });
    expect(formatKo(toKoInfo(lefties), 'de', lefties.text)).toBe('garantierter 2HKO nach Heilung durch Überreste');
    const text = '50% chance to 2HKO after Stealth Rock, sandstorm damage, and Leftovers recovery';
    expect(formatKo(toKoInfo({ chance: 0.5, n: 2, text }), 'de', text)).toBe(
      '50 % Chance auf 2HKO nach Tarnsteine, Schaden durch Sandsturm und Heilung durch Überreste',
    );
  });

  it('de: an item without a German phrase gets the generic wording; none translatable falls back to "(bedingt)"', () => {
    const mixed = 'guaranteed 2HKO after Stealth Rock and Steelsurge';
    expect(formatKo(toKoInfo({ chance: 1, n: 2, text: mixed }), 'de', mixed)).toBe(
      'garantierter 2HKO nach Tarnsteine und weiteren Effekten',
    );
    const unknown = 'guaranteed 2HKO after Steelsurge';
    expect(formatKo(toKoInfo({ chance: 1, n: 2, text: unknown }), 'de', unknown)).toBe('garantierter 2HKO (bedingt)');
  });

  it('without the calc text, or with "N/A", the structured phrase is used', () => {
    expect(formatKo(ko(2, 1, true), 'en', 'N/A')).toBe('guaranteed 2HKO (conditional)');
    expect(formatKo(ko(2, 1, false), 'en', '')).toBe('guaranteed 2HKO');
    expect(formatKo(ko(0, 0), 'en', 'not a KO')).toBe('');
  });
});

describe('koAfterItems', () => {
  it.each([
    ['guaranteed OHKO', []],
    ['guaranteed 2HKO after Leftovers recovery', ['Leftovers recovery']],
    ['guaranteed OHKO after Stealth Rock and 1 layer of Spikes', ['Stealth Rock', '1 layer of Spikes']],
    ['50% chance to 2HKO after Stealth Rock, sandstorm damage, and Leftovers recovery', ['Stealth Rock', 'sandstorm damage', 'Leftovers recovery']],
    [
      '37.5% chance to 2HKO after Stealth Rock (guaranteed 2HKO after Leftovers recovery)',
      ['Stealth Rock', 'Leftovers recovery'],
    ],
  ])('%s', (text, expected) => {
    expect(koAfterItems(text)).toEqual(expected);
  });
});

describe('DE_AFTER_ITEMS uses the official German names from the pkmn data', () => {
  const names: [string, string | undefined][] = [
    ['Tarnsteine', germanMove('Stealth Rock')],
    ['Stachler', germanMove('Spikes')],
    ['Egelsamen', germanMove('Leech Seed')],
    ['Grasfeld', germanMove('Grassy Terrain')],
    ['Pökelsalz', germanMove('Salt Cure')],
    ['Überreste', germanItem('Leftovers')],
    ['Giftschleim', germanItem('Black Sludge')],
    ['Klettdorn', germanItem('Sticky Barb')],
    ['Trockenheit', germanAbility('Dry Skin')],
    ['Solarkraft', germanAbility('Solar Power')],
    ['Regengenuss', germanAbility('Rain Dish')],
    ['Eishaut', germanAbility('Ice Body')],
    ['Kloakensoße', germanAbility('Liquid Ooze')],
    ['Aufheber', germanAbility('Poison Heal')],
    ['Alptraum', germanAbility('Bad Dreams')],
    ['Sandsturm', localizeWeather('Sand', 'de')],
    ['Hagel', localizeWeather('Hail', 'de')],
    ['Verbrennung', localizeStatus('brn', 'de', 'long')],
    ['Vergiftung', localizeStatus('psn', 'de', 'long')],
  ];
  it.each(names)('%s', (literal, fromData) => {
    expect(fromData).toBe(literal);
    expect(Object.values(DE_AFTER_ITEMS).some((phrase) => phrase.includes(literal))).toBe(true);
  });
});
