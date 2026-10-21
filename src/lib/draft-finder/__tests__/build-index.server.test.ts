import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PointBuyListEntry } from '@/types/point-buy';
import { toLineId } from '@/lib/draft/line-identity';
import { buildDraftSearchIndex } from '../build-index.server';
import { compileCriteria, evaluateLine, runFinder } from '../engine';
import { EMPTY_FILTERS, initialFinderState } from '../filter-types';
import { INDEX_SCHEMA_VERSION } from '../index-types';
import { buildLineCatalog } from '../line-catalog';
import { pkmnNameResolver } from '../names-port';
import { prepareIndex } from '../prepare';
import exampleList from '@/lib/draft/__tests__/fixtures/example-list.json';
import previewLines from '@/app/(public)/draft-preview/fixture-lines.example.json';

function entry(
  line_number: number,
  base: string,
  stage2: string,
  stage3: string | null,
  price: number,
  species_ids: PointBuyListEntry['species_ids'],
): PointBuyListEntry {
  return {
    id: `entry-${line_number}`,
    list_version_id: 'list-real',
    line_number,
    line_id: toLineId(base, stage3 ?? stage2),
    base_pokemon: base,
    stage2_pokemon: stage2,
    stage3_pokemon: stage3,
    price,
    kills_to_stage2: 4,
    additional_kills_to_stage3: stage3 ? 10 : null,
    price_group: 'mittel',
    early_rating: null,
    mid_rating: null,
    late_rating: null,
    rationale: null,
    historical_data: null,
    special_rules: null,
    special_rules_text: null,
    sources: null,
    legacy_tier: null,
    species_ids,
  };
}

const ENTRIES: PointBuyListEntry[] = [
  entry(5, 'Gastly', 'Haunter', 'Gengar', 29, { base: 'gastly', stage2: 'haunter', stage3: 'gengar' }),
  entry(27, 'Oshawott', 'Dewott', 'Samurott-Hisui', 25, { base: 'oshawott', stage2: 'dewott', stage3: 'samurotthisui' }),
  // Stored NFC with no species ids: must still resolve (dex names are NFD).
  entry(54, 'Flabébé'.normalize('NFC'), 'Floette', 'Florges', 20, null),
  entry(92, 'Oshawott', 'Dewott', 'Samurott', 14, { base: 'oshawott', stage2: 'dewott', stage3: 'samurott' }),
];

describe('buildDraftSearchIndex with real @pkmn/data (draft-frontend §4.1, §4.9)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves every stage of the example fixtures (/draft-preview, example list) in the Gen 9 dex', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const lines of [previewLines, exampleList.entries]) {
      const { index, warnings } = await buildDraftSearchIndex('example', lines as unknown as PointBuyListEntry[]);
      expect(warnings).toEqual([]);
      expect(index.lines).toHaveLength(lines.length);
    }
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/not found in the Gen 9 dex/);
  });

  it('builds a v2 index in list order with parallel name arrays', async () => {
    const { index, warnings } = await buildDraftSearchIndex('list-real', [...ENTRIES].reverse());
    expect(warnings).toEqual([]);
    expect(index.v).toBe(INDEX_SCHEMA_VERSION);
    expect(index.lines.map((l) => l.lineId)).toEqual([
      'gastly--gengar',
      'oshawott--samurotthisui',
      'flabebe--florges',
      'oshawott--samurott',
    ]);
    expect(index.moveNames).toHaveLength(index.moves.length);
    expect(index.abilityNames).toHaveLength(index.abilities.length);
    expect([...index.moves].sort()).toEqual(index.moves);
    expect(index.moveNames[index.moves.indexOf('ceaselessedge')]).toBe('Ceaseless Edge');
    expect(index.abilityNames[index.abilities.indexOf('levitate')]).toBe('Levitate');
    for (const line of index.lines) {
      for (const stage of line.stages) {
        expect([...stage.moves].sort((a, b) => a - b)).toEqual(stage.moves);
        expect(stage.moves.length).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('resolves NFC-stored Flabébé to flabebe', async () => {
    const { index } = await buildDraftSearchIndex('list-real', ENTRIES);
    const flabebe = index.lines.find((l) => l.lineId === 'flabebe--florges');
    expect(flabebe?.stages[0]).toMatchObject({ speciesId: 'flabebe', types: ['Fairy'] });
    expect(flabebe?.stages[0].name.normalize('NFC')).toBe(flabebe?.stages[0].name);
  }, 60_000);

  // The public suite runs on the example pack (Priority: Sucker Punch, Aqua Jet, Ice Shard, Mach Punch, Bullet Punch).
  it('V1 on real learnsets: Sucker Punch is a Priority member only Samurott-Hisui learns, from stage 3', async () => {
    const { index } = await buildDraftSearchIndex('list-real', ENTRIES);
    const ix = prepareIndex(index, pkmnNameResolver);
    const hisui = ix.byLineId.get('oshawott--samurotthisui');
    const plain = ix.byLineId.get('oshawott--samurott');
    if (!hisui || !plain) throw new Error('lines missing');
    const suckerPunch = ix.moveIdToIdx.get('suckerpunch');
    const aquaJet = ix.moveIdToIdx.get('aquajet');
    expect(suckerPunch).toBeDefined();

    // The whole category (parent selection) matches both lines from stage 1 through Aqua Jet.
    const parent = compileCriteria({ ...EMPTY_FILTERS, utility: [{ key: 'priority', members: [] }] }, ix, {
      banned: new Set(),
    });
    for (const line of [hisui, plain]) {
      expect(evaluateLine(line, parent, 'anywhere').results[0]).toMatchObject({ firstStage: 1, via: { kind: 'move', moveIdx: aquaJet } });
    }

    // Sucker Punch picked on its own, in both stage modes.
    const member = compileCriteria({ ...EMPTY_FILTERS, utility: [{ key: 'priority', members: ['suckerpunch'] }] }, ix, {
      banned: new Set(),
    });
    for (const mode of ['anywhere', 'same_stage'] as const) {
      const h = evaluateLine(hisui, member, mode);
      expect(h.matches).toBe(true);
      expect(h.results[0]).toMatchObject({ firstStage: 3, stages: [3], via: { kind: 'move', moveIdx: suckerPunch } });
      expect(evaluateLine(plain, member, mode).matches).toBe(false);
    }
  }, 60_000);

  it('V2 on the real index: text "Gengar" finds only the Gastly line', async () => {
    const { index } = await buildDraftSearchIndex('list-real', ENTRIES);
    const ix = prepareIndex(index, pkmnNameResolver);
    const catalog = buildLineCatalog(ENTRIES, [], [], 'en');
    const result = runFinder({
      ix,
      catalog,
      view: { ...initialFinderState(), filters: { ...EMPTY_FILTERS, text: 'Gengar' } },
      taken: {},
      favorites: new Set(),
      dataLocale: 'en',
      names: pkmnNameResolver,
      banned: new Set(),
    });
    expect(result.rows.map((r) => r.lineId)).toEqual(['gastly--gengar']);
  }, 60_000);

  it('emits an unresolvable line with empty data and a warning', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { index, warnings } = await buildDraftSearchIndex('list-real', [
      entry(1, 'Notamon', 'Notamid', null, 10, null),
    ]);
    expect(index.lines).toHaveLength(1);
    expect(index.lines[0].stages).toHaveLength(2);
    expect(index.lines[0].stages[0]).toMatchObject({ moves: [], abilities: [], types: [] });
    expect(warnings).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[draft-finder]'));
  }, 60_000);
});
