import { describe, it, expect } from 'vitest';
import { toID } from '@/lib/pkmn/i18n/id';
import fixture from './fixtures/example-list.json';
import {
  getLineIdentity,
  formatLineLabel,
  collectTakenLineIdentities,
  foldId,
  isLineId,
  LINE_ID_PATTERN,
  lineIdOfEntry,
  toLineId,
} from '../line-identity';

describe('line identity', () => {
  it('uses base alone when stage3 is null', () => {
    expect(getLineIdentity('Gastly', null)).toBe('Gastly');
  });

  it('combines base and stage3 for branched lines', () => {
    expect(getLineIdentity('Eevee', 'Vaporeon')).toBe('Eevee|Vaporeon');
  });

  it('formats branched labels for display', () => {
    expect(formatLineLabel('Eevee', 'Jolteon')).toBe('Eevee → Jolteon');
    expect(formatLineLabel('Gastly', null)).toBe('Gastly');
  });

  it('collects unique taken identities from trackers', () => {
    expect(
      collectTakenLineIdentities([
        { base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' },
        { base_pokemon: 'Gastly', locked_stage3_pokemon: null },
        { base_pokemon: 'Eevee', locked_stage3_pokemon: 'Vaporeon' },
      ]),
    ).toEqual(['Eevee|Vaporeon', 'Gastly']);
  });
});

// ── Stable line ids ────────────────────────────────────────────────────────────

describe('foldId / toLineId', () => {
  it('is the PKMN toID (one fold for the app)', () => {
    expect(foldId).toBe(toID);
  });

  it.each([
    ['Flabébé', 'flabebe'],
    ['Flabébé', 'flabebe'],
    ['Nidoran♀', 'nidoranf'],
    ['Nidoran-F', 'nidoranf'],
    ['Porygon-Z', 'porygonz'],
    ['Jangmo-o', 'jangmoo'],
    ['Ursaluna-Bloodmoon', 'ursalunabloodmoon'],
    ['Type: Null', 'typenull'],
  ])('folds %s to %s', (name, id) => {
    expect(foldId(name)).toBe(id);
  });

  it('joins the folded base and final stage with --', () => {
    expect(toLineId('Teddiursa', 'Ursaluna-Bloodmoon')).toBe('teddiursa--ursalunabloodmoon');
    expect(toLineId('Flabébé', 'Florges')).toBe('flabebe--florges');
    expect(toLineId('Oshawott', 'Samurott-Hisui')).toBe('oshawott--samurotthisui');
    expect(toLineId('Ralts', 'Gallade')).toBe('ralts--gallade');
  });

  it('uses stage 2 as the final stage of a two-stage line and prefers a stored id', () => {
    expect(lineIdOfEntry({ base_pokemon: 'Pawniard', stage2_pokemon: 'Bisharp', stage3_pokemon: null })).toBe(
      'pawniard--bisharp',
    );
    expect(
      lineIdOfEntry({ line_id: 'stored--id', base_pokemon: 'A', stage2_pokemon: 'B', stage3_pokemon: 'C' }),
    ).toBe('stored--id');
  });

  it('validates the line-id shape', () => {
    expect(isLineId('cosmog--lunala')).toBe(true);
    expect(isLineId('Cosmog--Lunala')).toBe(false);
    expect(isLineId('cosmog-lunala')).toBe(false);
    expect(LINE_ID_PATTERN.test('a--b--c')).toBe(false);
  });
});

describe('the synthetic example list fixture (example-list.json)', () => {
  const entries = fixture.entries;

  it('has a unique, well-formed line id for every line', () => {
    const ids = entries.map((e) => e.line_id);
    expect(new Set(ids).size).toBe(entries.length);
    for (const id of ids) expect(id).toMatch(LINE_ID_PATTERN);
  });

  it('stores exactly the id computed from the stage names', () => {
    for (const e of entries) {
      expect(lineIdOfEntry({ base_pokemon: e.base_pokemon, stage2_pokemon: e.stage2_pokemon, stage3_pokemon: e.stage3_pokemon })).toBe(
        e.line_id,
      );
    }
  });

  it('keeps branched bases apart (5 bases, 10 lines)', () => {
    const byBase = new Map<string, string[]>();
    for (const e of entries) byBase.set(e.base_pokemon, [...(byBase.get(e.base_pokemon) ?? []), e.line_id]);
    const branched = [...byBase.values()].filter((ids) => ids.length > 1);
    expect(branched).toHaveLength(5);
    expect(branched.flat()).toHaveLength(10);
    expect(byBase.get('Pichu')).toEqual(['pichu--raichu', 'pichu--raichualola']);
  });
});
