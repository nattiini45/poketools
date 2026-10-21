import { describe, expect, it } from 'vitest';
import { buildChips } from '@/lib/draft-finder/chips';
import { compileCriteria, evaluateLine } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, type FinderFilters } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { BANNED, buildFixtureIndex } from '@/lib/draft-finder/__tests__/fixture-index';
import { chipLabel, criterionLabel, resultText, viaText } from '../finder-labels';
import { labelContext, testNames } from './label-context';

const ix = prepareIndex(buildFixtureIndex(), testNames);
const en = labelContext('en');
const de = labelContext('de');

function filters(over: Partial<FinderFilters>): FinderFilters {
  return { ...EMPTY_FILTERS, ...over };
}

function evaluate(f: FinderFilters, lineId: string, mode: 'same_stage' | 'anywhere' = 'anywhere') {
  const line = ix.byLineId.get(lineId);
  if (!line) throw new Error(`fixture line ${lineId} missing`);
  return evaluateLine(line, compileCriteria(f, ix, { banned: BANNED }), mode);
}

// The public suite runs on the example pack: utility labels come from its `messages.<locale>.utility`.
describe('chipLabel', () => {
  const f = filters({
    types: { ids: ['Ground'], match: 'any' },
    moves: { ids: ['stealthrock'], match: 'any' },
    abilities: { ids: ['levitate'] },
    utility: [{ key: 'pivot', members: ['uturn'] }],
    stats: { spe: 100, bst: 500 },
    maxPrice: 15,
    defense: [{ relation: 'immune', type: 'Ground' }],
  });
  const chips = buildChips(f, {
    moveName: (id) => ix.raw.moveNames[ix.moveIdToIdx.get(id) ?? -1],
    abilityName: (id) => ix.raw.abilityNames[ix.abilityIdToIdx.get(id) ?? -1],
  });

  it('renders every chip kind in English', () => {
    expect(chips.map((c) => chipLabel(c.labelParts, en))).toEqual([
      'Ground',
      'Stealth Rock',
      'Levitate',
      'Pivoting',
      'Pivoting: U-turn',
      'Spe ≥ 100',
      'BST ≥ 500',
      '≤15 P',
      'immune to Ground',
    ]);
  });

  it('renders German UI text with German Pokémon names from the name layer', () => {
    expect(chips.map((c) => chipLabel(c.labelParts, de))).toEqual([
      'Boden',
      'Tarnsteine',
      'Schwebe',
      'Pivot',
      'Pivot: Kehrtwende',
      'Init. ≥ 100',
      'BST ≥ 500',
      '≤15 P',
      'immun gegen Boden',
    ]);
  });

  it('labels a utility category from the pack', () => {
    const [chip] = buildChips(filters({ utility: [{ key: 'hazard_control', members: [] }] }));
    expect(chipLabel(chip.labelParts, en)).toBe('Hazard control');
    expect(chipLabel(chip.labelParts, de)).toBe('Hazard-Kontrolle');
  });
});

describe('criterionLabel', () => {
  it('joins the alternatives of an "any" criterion', () => {
    const f = filters({ types: { ids: ['Ground', 'Water'], match: 'any' } });
    expect(criterionLabel('type:any', f, ix, en)).toBe('Ground / Water');
    expect(criterionLabel('type:any', f, ix, de)).toBe('Boden / Wasser');
  });

  it('labels per-move, stat, defense and price criteria', () => {
    const f = filters({ stats: { spe: 100 }, maxPrice: 20 });
    expect(criterionLabel('move:rapidspin', f, ix, de)).toBe('Turbodreher');
    expect(criterionLabel('stat:spe', f, ix, en)).toBe('Spe ≥ 100');
    expect(criterionLabel('def:resists:Fire', f, ix, en)).toBe('resists Fire');
    expect(criterionLabel('price', f, ix, en)).toBe('≤20 P');
  });
});

describe('resultText (V16: names, never ids)', () => {
  it('explains V1 with the move name and its first stage', () => {
    const f = filters({ utility: [{ key: 'hazards', members: [] }] });
    const evaluation = evaluate(f, 'oshawott--samurotthisui');
    const [result] = evaluation.results;
    expect(resultText(result, ix, en)).toBe('Spikes, from Stage 3');
    expect(resultText(result, ix, de)).toBe('Stachler, ab Stufe 3');
    expect(resultText(result, ix, en)).not.toContain('spikes');
  });

  it('explains V7 per criterion (Recovery via Regenerator at 3, Pivot via U-turn at 2)', () => {
    const f = filters({
      utility: [
        { key: 'recovery', members: [] },
        { key: 'pivot', members: [] },
      ],
    });
    const evaluation = evaluate(f, 'mona--x');
    expect(evaluation.results.map((r) => resultText(r, ix, en))).toEqual([
      'Regenerator, from Stage 3',
      'U-turn, from Stage 2',
    ]);
    expect(evaluation.simultaneousFromStage).toBeNull();
  });

  it('is empty for an unsatisfied criterion and stage-free for the price', () => {
    const missing = evaluate(filters({ moves: { ids: ['rapidspin'], match: 'all' } }), 'gastly--gengar');
    expect(resultText(missing.results[0], ix, en)).toBe('');
    const price = evaluate(filters({ maxPrice: 20 }), 'monb--y');
    expect(resultText(price.results[0], ix, en)).toBe('17 P');
  });
});

describe('viaText', () => {
  it('names the defensive ability and formats the typing multiplier per locale', () => {
    const levitate = ix.abilityIdToIdx.get('levitate') ?? -1;
    expect(viaText({ kind: 'ability-defense', abilityIdx: levitate, multiplier: 0 }, ix, en)).toBe('with ability Levitate');
    expect(viaText({ kind: 'ability-defense', abilityIdx: levitate, multiplier: 0 }, ix, de)).toBe('mit Fähigkeit Schwebe');
    expect(viaText({ kind: 'typing', multiplier: 0.5 }, ix, en)).toBe('typing ×0.5');
    expect(viaText({ kind: 'typing', multiplier: 0.5 }, ix, de)).toBe('Typen ×0,5');
    expect(viaText({ kind: 'stat', stat: 'spe', value: 110 }, ix, de)).toBe('Init. 110');
  });
});
