import { describe, expect, it } from 'vitest';
import { buildChips } from '@/lib/draft-finder/chips';
import { compileCriteria, evaluateLine } from '@/lib/draft-finder/engine';
import { EMPTY_FILTERS, type FinderFilters } from '@/lib/draft-finder/filter-types';
import { prepareIndex } from '@/lib/draft-finder/prepare';
import { BANNED, buildFixtureCatalog, buildFixtureIndex } from '@/lib/draft-finder/__tests__/fixture-index';
import { chipLabel, criterionLabel, resultText, stageSpecies, togetherText, viaText } from '../finder-labels';
import { labelContext, testNames } from './label-context';

const ix = prepareIndex(buildFixtureIndex(), testNames);
const catalog = buildFixtureCatalog();
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

/** The stages of a fixture line, as the catalog entry hands them to the labels. */
function stagesOf(lineId: string) {
  const entry = catalog.lines.find((l) => l.lineId === lineId);
  if (!entry) throw new Error(`fixture line ${lineId} missing`);
  return entry.stages;
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

  it('renders every chip kind in English: a utility member is just its name, the category is not a chip', () => {
    expect(chips.map((c) => chipLabel(c.labelParts, en, 'short'))).toEqual([
      'Ground',
      'Stealth Rock',
      'Levitate',
      'U-turn',
      'Spe ≥ 100',
      'BST ≥ 500',
      '≤15 P',
      'immune to Ground',
    ]);
  });

  it('renders German UI text with German Pokémon names from the name layer', () => {
    expect(chips.map((c) => chipLabel(c.labelParts, de, 'short'))).toEqual([
      'Boden',
      'Tarnsteine',
      'Schwebe',
      'Kehrtwende',
      'Init. ≥ 100',
      'BST ≥ 500',
      '≤15 P',
      'immun gegen Boden',
    ]);
  });

  it('the full form (title, remove button name) keeps the category in front of a member', () => {
    expect(chipLabel(chips[3].labelParts, en, 'full')).toBe('Pivoting: U-turn');
    expect(chipLabel(chips[3].labelParts, de, 'full')).toBe('Pivot: Kehrtwende');
  });

  it('both forms agree for every kind but a utility member', () => {
    for (const c of chips.filter((chip) => chip.kind !== 'utilityMember')) {
      expect(chipLabel(c.labelParts, en, 'short')).toBe(chipLabel(c.labelParts, en, 'full'));
    }
  });

  it('labels a utility category from the pack', () => {
    const [chip] = buildChips(filters({ utility: [{ key: 'hazard_control', members: [] }] }));
    expect(chipLabel(chip.labelParts, en, 'short')).toBe('Hazard control');
    expect(chipLabel(chip.labelParts, de, 'short')).toBe('Hazard-Kontrolle');
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

describe('stageSpecies', () => {
  it('names the Pokémon of a stage number in the data locale, by number not position', () => {
    const stages = stagesOf('oshawott--samurotthisui');
    expect(stageSpecies(stages, 1, en)).toBe('Oshawott');
    expect(stageSpecies(stages, 3, en)).toBe('Samurott-Hisui');
    expect(stageSpecies(stages, 3, de)).toBe('Hisui-Admurai');
    expect(stageSpecies([stages[2]], 3, en)).toBe('Samurott-Hisui');
  });

  it('is null for a stage the line lacks', () => {
    expect(stageSpecies(stagesOf('gastly--gengar').slice(0, 2), 3, en)).toBeNull();
  });
});

describe('resultText (V16: names, never ids)', () => {
  it('explains V1 with the move name and the Pokémon it first holds on', () => {
    const f = filters({ utility: [{ key: 'hazards', members: [] }] });
    const evaluation = evaluate(f, 'oshawott--samurotthisui');
    const stages = stagesOf('oshawott--samurotthisui');
    const [result] = evaluation.results;
    expect(resultText(result, stages, ix, en)).toBe('Spikes, from Samurott-Hisui');
    expect(resultText(result, stages, ix, de)).toBe('Stachler, ab Hisui-Admurai');
    expect(resultText(result, stages, ix, en)).not.toContain('spikes');
    expect(resultText(result, stages, ix, en)).not.toContain('Stage');
  });

  it('explains V7 per criterion (Recovery via Regenerator at 3, Pivot via U-turn at 2)', () => {
    const f = filters({
      utility: [
        { key: 'recovery', members: [] },
        { key: 'pivot', members: [] },
      ],
    });
    const evaluation = evaluate(f, 'mona--x');
    const stages = stagesOf('mona--x');
    expect(evaluation.results.map((r) => resultText(r, stages, ix, en))).toEqual([
      'Regenerator, from Monx',
      'U-turn, from Monamid',
    ]);
    expect(evaluation.simultaneousFromStage).toBeNull();
  });

  it('is empty for an unsatisfied criterion and species-free for the price', () => {
    const missing = evaluate(filters({ moves: { ids: ['rapidspin'], match: 'all' } }), 'gastly--gengar');
    expect(resultText(missing.results[0], stagesOf('gastly--gengar'), ix, en)).toBe('');
    const price = evaluate(filters({ maxPrice: 20 }), 'monb--y');
    expect(resultText(price.results[0], stagesOf('monb--y'), ix, en)).toBe('17 P');
  });

  it('falls back to the bare reason when the line lacks the stage', () => {
    const evaluation = evaluate(filters({ utility: [{ key: 'hazards', members: [] }] }), 'oshawott--samurotthisui');
    expect(resultText(evaluation.results[0], [], ix, en)).toBe('Spikes');
  });
});

describe('togetherText', () => {
  const healingMomentum = filters({
    utility: [
      { key: 'recovery', members: [] },
      { key: 'pivot', members: [] },
    ],
  });

  it('names the Pokémon everything holds on at once', () => {
    const evaluation = evaluate(healingMomentum, 'monb--y', 'same_stage');
    expect(togetherText(evaluation, stagesOf('monb--y'), 'same_stage', en)).toBe('All at once – from Mony');
    expect(togetherText(evaluation, stagesOf('monb--y'), 'same_stage', de)).toBe('Alles gleichzeitig – ab Mony');
  });

  it('says they never meet only when the stage mode lets them hold apart', () => {
    const evaluation = evaluate(healingMomentum, 'mona--x', 'anywhere');
    expect(togetherText(evaluation, stagesOf('mona--x'), 'anywhere', en)).toBe('Not all on the same Pokémon');
    expect(togetherText(evaluation, stagesOf('mona--x'), 'same_stage', en)).toBeNull();
  });

  it('is null for a single criterion, no evaluation or a stage the line lacks', () => {
    const one = evaluate(filters({ utility: [{ key: 'pivot', members: [] }] }), 'mona--x');
    expect(togetherText(one, stagesOf('mona--x'), 'anywhere', en)).toBeNull();
    expect(togetherText(null, [], 'anywhere', en)).toBeNull();
    const together = evaluate(healingMomentum, 'monb--y', 'same_stage');
    expect(togetherText(together, [], 'same_stage', en)).toBeNull();
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
