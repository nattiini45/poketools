import { describe, expect, it } from 'vitest';
import fixture from '@/lib/draft/__tests__/fixtures/example-list.json';
import { compileCriteria, evaluateLine, runFinder, viaSubject, type FinderInput, type LineEvaluation } from '../engine';
import { EMPTY_FILTERS, initialFinderState, type FinderFilters, type FinderViewState } from '../filter-types';
import { prepareIndex } from '../prepare';
import { finderReducer } from '../reducer';
import { countByTab } from '../tabs';
import { BANNED, buildFixtureCatalog, buildFixtureIndex, stubNames } from './fixture-index';

// The public suite runs on the example pack: utility keys hazards / hazard_control / recovery / pivot /
// priority, price tabs 25-20 / 19-15 / 14-10 / 9-1. The fixture's own ban list is Baton Pass, Shed Tail.
const ix = prepareIndex(buildFixtureIndex(), stubNames);
const catalog = buildFixtureCatalog();

function filters(patch: Partial<FinderFilters>): FinderFilters {
  return { ...EMPTY_FILTERS, ...patch };
}

function evaluate(lineId: string, f: FinderFilters, mode: 'same_stage' | 'anywhere'): LineEvaluation {
  const line = ix.byLineId.get(lineId);
  if (!line) throw new Error(`fixture line ${lineId} missing`);
  return evaluateLine(line, compileCriteria(f, ix, { banned: BANNED }), mode);
}

function run(view: Partial<FinderViewState>, taken: Record<string, string> = {}): ReturnType<typeof runFinder> {
  const input: FinderInput = {
    ix,
    catalog,
    view: { ...initialFinderState(), ...view },
    taken,
    favorites: new Set(),
    dataLocale: 'en',
    names: stubNames,
    banned: BANNED,
  };
  return runFinder(input);
}

const ids = (r: ReturnType<typeof runFinder>) => r.rows.map((row) => row.lineId).sort();
const moveIdx = (id: string) => ix.moveIdToIdx.get(id);

describe('finder engine vectors (draft-frontend §4.9)', () => {
  it('V1 (acceptance 3): Hazards finds the Hisui line via Spikes from stage 3, not plain Samurott', () => {
    const f = filters({ utility: [{ key: 'hazards', members: [] }] });
    const hisui = evaluate('oshawott--samurotthisui', f, 'anywhere');
    expect(hisui.matches).toBe(true);
    expect(hisui.results[0]).toMatchObject({
      criterionId: 'utility:hazards',
      satisfied: true,
      firstStage: 3,
      via: { kind: 'move', moveIdx: moveIdx('spikes') },
      stages: [3],
    });
    expect(evaluate('oshawott--samurott', f, 'anywhere').matches).toBe(false);
    expect(evaluate('oshawott--samurott', f, 'same_stage').matches).toBe(false);

    const result = run({ filters: f, stageMode: 'anywhere' });
    expect(ids(result)).toContain('oshawott--samurotthisui');
    expect(ids(result)).not.toContain('oshawott--samurott');
  });

  it('V2: text "Gengar" finds only the Gastly line', () => {
    expect(ids(run({ filters: filters({ text: 'Gengar' }) }))).toEqual(['gastly--gengar']);
  });

  it('V3: "Samurott-Hisui" finds only the Hisui line; "Samurott" both Oshawott lines', () => {
    expect(ids(run({ filters: filters({ text: 'Samurott-Hisui' }) }))).toEqual(['oshawott--samurotthisui']);
    expect(ids(run({ filters: filters({ text: 'Samurott' }) }))).toEqual(['oshawott--samurott', 'oshawott--samurotthisui']);
  });

  it('V4: "hisui samurott" (word order swapped) finds only the Hisui line', () => {
    expect(ids(run({ filters: filters({ text: 'hisui samurott' }) }))).toEqual(['oshawott--samurotthisui']);
  });

  it('V5: German "Blutmond" finds only Ursaluna-Bloodmoon; "Ursaluna" both Teddiursa lines', () => {
    expect(ids(run({ filters: filters({ text: 'Blutmond' }) }))).toEqual(['teddiursa--ursalunabloodmoon']);
    expect(ids(run({ filters: filters({ text: 'Ursaluna' }) }))).toEqual(['teddiursa--ursaluna', 'teddiursa--ursalunabloodmoon']);
  });

  it('V6: Recovery + Pivot on the same Pokémon: monb--y from stage 3, mona--x not', () => {
    const f = filters({
      utility: [
        { key: 'recovery', members: [] },
        { key: 'pivot', members: [] },
      ],
    });
    const y = evaluate('monb--y', f, 'same_stage');
    expect(y.matches).toBe(true);
    expect(y.simultaneousFromStage).toBe(3);
    expect(evaluate('mona--x', f, 'same_stage').matches).toBe(false);
  });

  it('V7: Recovery + Pivot anywhere in the line: both match, with per-criterion stages', () => {
    const f = filters({
      utility: [
        { key: 'recovery', members: [] },
        { key: 'pivot', members: [] },
      ],
    });
    expect(evaluate('monb--y', f, 'anywhere').matches).toBe(true);
    const x = evaluate('mona--x', f, 'anywhere');
    expect(x.matches).toBe(true);
    expect(x.simultaneousFromStage).toBeNull();
    expect(x.results).toEqual([
      expect.objectContaining({
        criterionId: 'utility:recovery',
        firstStage: 3,
        via: { kind: 'ability', abilityIdx: ix.abilityIdToIdx.get('regenerator') },
      }),
      expect.objectContaining({
        criterionId: 'utility:pivot',
        firstStage: 2,
        via: { kind: 'move', moveIdx: moveIdx('uturn') },
      }),
    ]);
  });

  it('V8: moves "require all" needs both; "any" needs either', () => {
    const all = run({
      stageMode: 'anywhere',
      filters: filters({ moves: { ids: ['stealthrock', 'rapidspin'], match: 'all' } }),
    });
    expect(ids(all)).toEqual(['monb--y']);
    const any = run({
      stageMode: 'anywhere',
      filters: filters({ moves: { ids: ['stealthrock', 'rapidspin'], match: 'any' } }),
    });
    expect(ids(any)).toEqual(['monb--y', 'teddiursa--ursalunabloodmoon']);
  });

  it('V9: immune to Ground counts Levitate when abilities count; typing only otherwise', () => {
    const on = evaluate('gastly--gengar', filters({ defense: [{ relation: 'immune', type: 'Ground' }] }), 'anywhere');
    expect(on.matches).toBe(true);
    expect(on.results[0]).toMatchObject({
      firstStage: 1,
      via: { kind: 'ability-defense', abilityIdx: ix.abilityIdToIdx.get('levitate'), multiplier: 0 },
      stages: [1, 2],
    });
    const off = evaluate(
      'gastly--gengar',
      filters({ defense: [{ relation: 'immune', type: 'Ground' }], abilityDefense: false }),
      'anywhere',
    );
    expect(off.matches).toBe(false);
    // Flying typing is immune without any ability.
    const flying = evaluate(
      'mona--x',
      filters({ defense: [{ relation: 'immune', type: 'Ground' }], abilityDefense: false }),
      'anywhere',
    );
    expect(flying.results[0]).toMatchObject({ firstStage: 3, via: { kind: 'typing', multiplier: 0 } });
  });

  it('weakness filters use typing only (FR-9)', () => {
    const weak = evaluate('gastly--gengar', filters({ defense: [{ relation: 'weak', type: 'Ground' }] }), 'anywhere');
    expect(weak.matches).toBe(true);
    expect(weak.results[0].via).toEqual({ kind: 'typing', multiplier: 2 });
  });

  it('V10: a move outside the category never matches its parent (Rest is no Recovery member in the example pack)', () => {
    expect(evaluate('oshawott--samurott', filters({ utility: [{ key: 'recovery', members: [] }] }), 'anywhere').matches).toBe(
      false,
    );
  });

  it('V11: pin survives tab, filter and clear-all; its evaluation is computed while hidden', () => {
    let s = initialFinderState();
    s = finderReducer(s, { type: 'pin', lineId: 'oshawott--samurott' });
    s = finderReducer(s, { type: 'setTab', tab: '9-1' });
    s = finderReducer(s, { type: 'toggleType', id: 'Ghost' });
    expect(s.pinnedLineId).toBe('oshawott--samurott');
    const hidden = run(s);
    expect(ids(hidden)).toEqual([]);
    expect(hidden.pinnedEvaluation).toMatchObject({ lineId: 'oshawott--samurott', matches: false });
    s = finderReducer(s, { type: 'clearAll' });
    expect(s.pinnedLineId).toBe('oshawott--samurott');
    expect(run(s).pinnedEvaluation).not.toBeNull();
  });

  it('V12: default sort is price desc then display name, in both data locales', () => {
    const tie = buildFixtureCatalog([
      { lineId: 'teddiursa--ursaluna', price: 30, stages: [{ name: 'Teddiursa', types: ['Normal'] }, { name: 'Ursaluna', types: ['Ground'] }] },
      { lineId: 'gastly--gengar', price: 30, stages: [{ name: 'Gastly', types: ['Ghost'] }, { name: 'Gengar', types: ['Ghost'] }] },
      { lineId: 'dratini--dragonite', price: 27, stages: [{ name: 'Dratini', types: ['Dragon'] }, { name: 'Dragonite', types: ['Dragon', 'Flying'] }] },
    ]);
    const base: Omit<FinderInput, 'dataLocale' | 'names'> = {
      ix,
      catalog: tie,
      view: initialFinderState(),
      taken: {},
      favorites: new Set(),
      banned: BANNED,
    };
    expect(runFinder({ ...base, dataLocale: 'en', names: stubNames }).rows.map((r) => r.lineId)).toEqual([
      'gastly--gengar',
      'teddiursa--ursaluna',
      'dratini--dragonite',
    ]);
    // A German name that sorts after Teddiursa flips the tie.
    const flipped = { ...stubNames, species: (en: string, l: 'en' | 'de') => (l === 'de' && en === 'Gastly' ? 'Zwirrlicht' : en) };
    expect(runFinder({ ...base, dataLocale: 'de', names: flipped }).rows.map((r) => r.lineId)).toEqual([
      'teddiursa--ursaluna',
      'gastly--gengar',
      'dratini--dragonite',
    ]);
  });

  it('V12b: the sort stage picks whose stats a stat sort reads', () => {
    const order = (sortStage: 'base' | 'final') => run({ sort: 'spe', sortStage }).rows.map((r) => r.lineId);
    // Mona's final stage is the fastest line (110), its base stage the slowest (40).
    expect(order('final')[0]).toBe('mona--x');
    expect(order('base').at(-1)).toBe('mona--x');
    expect(initialFinderState().sortStage).toBe('final');
  });

  it('V13: price tabs on the example list fixture are 12 / 12 / 12 / 12 / 48', () => {
    const price = new Map(fixture.entries.map((e) => [e.line_id, e.price]));
    expect(countByTab(price.keys(), (id) => price.get(id) ?? 0)).toEqual({
      '25-20': 12,
      '19-15': 12,
      '14-10': 12,
      '9-1': 12,
      all: 48,
    });
  });

  it('V14: Spe >= 100 and Ground on the same Pokémon needs one stage with both', () => {
    const f = filters({ stats: { spe: 100 }, types: { ids: ['Ground'], match: 'any' } });
    expect(ids(run({ filters: f, stageMode: 'same_stage' }))).toEqual(['monb--y']);
    expect(ids(run({ filters: f, stageMode: 'anywhere' }))).toEqual(['mona--x', 'monb--y']);
  });

  it('V15: a banned Pivot member never matches, parent or picked', () => {
    const bannedPivot = new Set([...BANNED, 'partingshot']);
    const line = ix.byLineId.get('teddiursa--ursaluna');
    if (!line) throw new Error('fixture line teddiursa--ursaluna missing');
    const parentFilters = filters({ utility: [{ key: 'pivot', members: [] }] });
    expect(evaluateLine(line, compileCriteria(parentFilters, ix, { banned: BANNED }), 'anywhere').matches).toBe(true);
    expect(evaluateLine(line, compileCriteria(parentFilters, ix, { banned: bannedPivot }), 'anywhere').matches).toBe(false);
    const picked = filters({ utility: [{ key: 'pivot', members: ['partingshot'] }] });
    expect(evaluateLine(line, compileCriteria(picked, ix, { banned: bannedPivot }), 'anywhere').matches).toBe(false);
  });

  it('V16: an explanation names the move from moveNames, never the id', () => {
    const hisui = evaluate('oshawott--samurotthisui', filters({ utility: [{ key: 'hazards', members: [] }] }), 'anywhere');
    const via = hisui.results[0].via;
    expect(via).not.toBeNull();
    if (!via) return;
    expect(viaSubject(via, ix, stubNames, 'en')).toBe('Spikes');
    expect(viaSubject(via, ix, stubNames, 'de')).toBe('Stachler');
  });
});

describe('runFinder counts and visibility', () => {
  it('counts matches across every tab and per tab, matching/total (FR-8)', () => {
    // Fixture prices 30 / 29 / 28 / 27 sit above every example tab: they count under all only.
    const r = run({ filters: filters({ types: { ids: ['Ground'], match: 'any' } }), tab: '19-15' });
    expect(r.matchingAllTabs).toBe(4);
    expect(r.tabCounts['25-20']).toEqual({ matching: 0, total: 1 });
    expect(r.tabCounts['19-15']).toEqual({ matching: 2, total: 2 });
    expect(r.tabCounts['14-10']).toEqual({ matching: 0, total: 1 });
    expect(r.tabCounts['9-1']).toEqual({ matching: 0, total: 0 });
    expect(r.tabCounts.all).toEqual({ matching: 4, total: 8 });
    expect(ids(r)).toEqual(['mona--x', 'monb--y']);
  });

  it('hides drafted lines only when "show drafted" is off', () => {
    expect(ids(run({}, { 'gastly--gengar': 'p1' }))).toContain('gastly--gengar');
    expect(ids(run({ showDrafted: false }, { 'gastly--gengar': 'p1' }))).not.toContain('gastly--gengar');
  });

  it('with no criteria every line matches with empty results', () => {
    const r = run({});
    expect(r.rows).toHaveLength(8);
    expect(r.rows.every((row) => row.evaluation.matches && row.evaluation.results.length === 0)).toBe(true);
    expect(r.activeChips).toEqual([]);
  });

  it('max price is a line-level criterion', () => {
    expect(ids(run({ filters: filters({ maxPrice: 17 }) }))).toEqual(['monb--y', 'oshawott--samurott']);
  });

  it('chips carry English names from the index', () => {
    const r = run({ filters: filters({ moves: { ids: ['uturn'], match: 'any' } }) });
    expect(r.activeChips).toEqual([
      { id: 'move:uturn', kind: 'move', labelParts: { kind: 'move', moveId: 'uturn', name: 'U-turn' } },
    ]);
  });
});
