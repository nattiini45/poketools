/**
 * Hand-built finder fixtures (draft-frontend §4.9). No `@pkmn/*`: ids, names and learnsets are authored
 * for the vectors only. The stub name resolver wraps the REAL dictionary-free folding of the pkmn layer
 * (`buildSearchKeys` / `compareDisplayNames`) with a tiny German name table.
 */
import type { Locale } from '@/i18n/config';
import { buildSearchKeys, compareDisplayNames } from '@/lib/pkmn/i18n/search';
import type { DraftSearchIndex, IndexLine, StatTuple, TypeId } from '../index-types';
import { INDEX_SCHEMA_VERSION } from '../index-types';
import type { DraftLineCatalog, DraftLineCatalogEntry } from '../line-catalog';
import type { NameResolver } from '../names-port';

const MOVE_NAMES: Record<string, string> = {
  batonpass: 'Baton Pass',
  ceaselessedge: 'Ceaseless Edge',
  knockoff: 'Knock Off',
  partingshot: 'Parting Shot',
  rapidspin: 'Rapid Spin',
  rest: 'Rest',
  spikes: 'Spikes',
  stealthrock: 'Stealth Rock',
  suckerpunch: 'Sucker Punch',
  surf: 'Surf',
  uturn: 'U-turn',
};

const ABILITY_NAMES: Record<string, string> = {
  cursedbody: 'Cursed Body',
  guts: 'Guts',
  levitate: 'Levitate',
  regenerator: 'Regenerator',
  sharpness: 'Sharpness',
  torrent: 'Torrent',
};

/** Stub German names (the real ones come from PokeAPI; these only exercise the plumbing). */
export const STUB_DE: Record<string, string> = {
  'Ursaluna-Bloodmoon': 'Blutmond-Ursaluna',
  Samurott: 'Admurai',
  'Samurott-Hisui': 'Hisui-Admurai',
  Oshawott: 'Ottaro',
  Dewott: 'Zwottronin',
  Gastly: 'Nebulak',
  Haunter: 'Alpollo',
  Gengar: 'Gengar',
  Teddiursa: 'Teddiursa',
  Ursaring: 'Ursaring',
  Ursaluna: 'Ursaluna',
  'Ceaseless Edge': 'Klingenschwall',
  'Rapid Spin': 'Turbodreher',
  'Stealth Rock': 'Tarnsteine',
  Spikes: 'Stachler',
  'U-turn': 'Kehrtwende',
  Regenerator: 'Belebekraft',
  Levitate: 'Schwebe',
};

export const stubNames: NameResolver = {
  species: (en, l) => (l === 'de' ? (STUB_DE[en] ?? en) : en),
  move: (en, l) => (l === 'de' ? (STUB_DE[en] ?? en) : en),
  ability: (en, l) => (l === 'de' ? (STUB_DE[en] ?? en) : en),
  type: (t) => t,
  stat: (s) => s,
  lineLabel: (base, stage3, l: Locale) => {
    const b = l === 'de' ? (STUB_DE[base] ?? base) : base;
    if (!stage3) return b;
    return `${b} → ${l === 'de' ? (STUB_DE[stage3] ?? stage3) : stage3}`;
  },
  searchKeys: (_kind, en) => buildSearchKeys([en, STUB_DE[en]]),
  compare: compareDisplayNames,
};

interface StageSpec {
  name: string;
  types: TypeId[];
  moves?: string[];
  abilities?: string[];
  stats?: StatTuple;
}

interface LineSpec {
  lineId: string;
  price: number;
  stages: StageSpec[];
  flags?: Partial<DraftLineCatalogEntry['flags']>;
}

const DEFAULT_STATS: StatTuple = [60, 60, 60, 60, 60, 60];

export const LINE_SPECS: LineSpec[] = [
  {
    lineId: 'teddiursa--ursalunabloodmoon',
    price: 30,
    stages: [
      { name: 'Teddiursa', types: ['Normal'], abilities: ['guts'] },
      { name: 'Ursaring', types: ['Normal'], abilities: ['guts'] },
      { name: 'Ursaluna-Bloodmoon', types: ['Ground', 'Normal'], moves: ['stealthrock'], abilities: ['guts'], stats: [113, 70, 120, 135, 65, 52] },
    ],
  },
  {
    lineId: 'gastly--gengar',
    price: 29,
    stages: [
      { name: 'Gastly', types: ['Ghost', 'Poison'], abilities: ['levitate'] },
      { name: 'Haunter', types: ['Ghost', 'Poison'], abilities: ['levitate'] },
      { name: 'Gengar', types: ['Ghost', 'Poison'], abilities: ['cursedbody'], moves: ['knockoff'] },
    ],
  },
  {
    lineId: 'teddiursa--ursaluna',
    price: 28,
    stages: [
      { name: 'Teddiursa', types: ['Normal'], abilities: ['guts'] },
      { name: 'Ursaring', types: ['Normal'], abilities: ['guts'] },
      { name: 'Ursaluna', types: ['Ground', 'Normal'], moves: ['batonpass', 'partingshot'], abilities: ['guts'], stats: [130, 140, 105, 45, 80, 50] },
    ],
  },
  {
    lineId: 'cosmog--solgaleo',
    price: 27,
    flags: { cosmog: true, noRedraft: true },
    stages: [
      { name: 'Cosmog', types: ['Psychic'] },
      { name: 'Cosmoem', types: ['Psychic'] },
      { name: 'Solgaleo', types: ['Psychic', 'Steel'] },
    ],
  },
  {
    lineId: 'oshawott--samurotthisui',
    price: 25,
    stages: [
      { name: 'Oshawott', types: ['Water'], moves: ['surf', 'rest'], abilities: ['torrent'] },
      { name: 'Dewott', types: ['Water'], moves: ['surf', 'rest'], abilities: ['torrent'] },
      {
        name: 'Samurott-Hisui',
        types: ['Water', 'Dark'],
        // Ceaseless Edge (a league pack's hazard member) and Spikes (the example pack's) on stage 3 only.
        moves: ['surf', 'rest', 'ceaselessedge', 'spikes', 'suckerpunch', 'knockoff'],
        abilities: ['torrent', 'sharpness'],
      },
    ],
  },
  {
    lineId: 'mona--x',
    price: 18,
    stages: [
      { name: 'Mona', types: ['Ground'], stats: [40, 40, 40, 40, 40, 40] },
      { name: 'Monamid', types: ['Normal'], moves: ['uturn'] },
      { name: 'Monx', types: ['Flying'], abilities: ['regenerator'], stats: [80, 80, 80, 80, 80, 110] },
    ],
  },
  {
    lineId: 'monb--y',
    price: 17,
    stages: [
      { name: 'Monb', types: ['Normal'], moves: ['stealthrock'] },
      { name: 'Monbmid', types: ['Normal'], moves: ['uturn'] },
      { name: 'Mony', types: ['Ground'], moves: ['uturn', 'rapidspin'], abilities: ['regenerator'], stats: [90, 90, 90, 90, 90, 100] },
    ],
  },
  {
    lineId: 'oshawott--samurott',
    price: 14,
    stages: [
      { name: 'Oshawott', types: ['Water'], moves: ['surf', 'rest'], abilities: ['torrent'] },
      { name: 'Dewott', types: ['Water'], moves: ['surf', 'rest'], abilities: ['torrent'] },
      { name: 'Samurott', types: ['Water'], moves: ['surf', 'rest', 'knockoff'], abilities: ['torrent', 'shellarmor'] },
    ],
  },
];

function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function buildFixtureIndex(specs: readonly LineSpec[] = LINE_SPECS): DraftSearchIndex {
  const moves = [...new Set(specs.flatMap((l) => l.stages.flatMap((s) => s.moves ?? [])))].sort();
  const abilities = [...new Set(specs.flatMap((l) => l.stages.flatMap((s) => s.abilities ?? [])))].sort();
  const lines: IndexLine[] = specs.map((l, i) => ({
    lineId: l.lineId,
    entryId: `entry-${i + 1}`,
    price: l.price,
    stages: l.stages.map((s, si) => ({
      stage: (si + 1) as 1 | 2 | 3,
      speciesId: toId(s.name),
      name: s.name,
      types: s.types,
      abilities: (s.abilities ?? []).map((a) => abilities.indexOf(a)),
      stats: s.stats ?? DEFAULT_STATS,
      moves: (s.moves ?? []).map((m) => moves.indexOf(m)).sort((a, b) => a - b),
    })),
  }));
  return {
    v: INDEX_SCHEMA_VERSION,
    listVersionId: 'list-1',
    moves,
    moveNames: moves.map((m) => MOVE_NAMES[m] ?? m),
    abilities,
    abilityNames: abilities.map((a) => ABILITY_NAMES[a] ?? a),
    lines,
  };
}

export function buildFixtureCatalog(specs: readonly LineSpec[] = LINE_SPECS): DraftLineCatalog {
  const baseCounts = new Map<string, number>();
  for (const l of specs) baseCounts.set(toId(l.stages[0].name), (baseCounts.get(toId(l.stages[0].name)) ?? 0) + 1);
  return {
    listVersionId: 'list-1',
    bannedMoves: ['batonpass', 'shedtail'],
    lines: specs.map((l, i) => ({
      lineId: l.lineId,
      entryId: `entry-${i + 1}`,
      lineNumber: i + 1,
      price: l.price,
      stages: l.stages.map((s, si) => ({ stage: (si + 1) as 1 | 2 | 3, name: s.name, speciesId: toId(s.name) })),
      thresholds: { toStage2: 4, additionalToStage3: 10, cumulative: [4, 14] },
      flags: { cosmog: false, noRedraft: false, scatterbugCocoon: false, ...l.flags },
      specialRules: null,
      branch: { groupKey: toId(l.stages[0].name), count: baseCounts.get(toId(l.stages[0].name)) ?? 1 },
    })),
  };
}

export const BANNED: ReadonlySet<string> = new Set(['batonpass', 'shedtail']);
