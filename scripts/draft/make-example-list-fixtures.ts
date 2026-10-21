/**
 * Write the two EXAMPLE point-buy list fixtures (format-pack design spec §F.4):
 *
 *   - src/lib/draft/__tests__/fixtures/example-list.json        (importer-row shape, sheet values,
 *     the example workbook's overview and rules rows)
 *   - src/app/(public)/draft-preview/fixture-lines.example.json (read-layer shape, the example
 *     pack's line overrides applied)
 *
 * It reads the EXAMPLE pack by relative path, never `@format-pack` / `@/lib/format-pack` (those
 * resolve to the private pack when the companion overlay is attached), so the output is the same
 * on every checkout. The skeleton is SYNTHETIC: 48 lines (two- and three-stage, five branched
 * bases, the example pack's rule lines and its override line). Prices, thresholds and ratings come
 * from a fixed seed, so re-running the script is idempotent.
 *
 * Usage (no database, no network):  npx tsx --tsconfig tsconfig.json scripts/draft/make-example-list-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import examplePack from '../../src/format-packs/example';
import { storedFlagsOf } from '../../src/lib/format-pack/stored-flags';
import { toID } from '../../src/lib/pkmn/i18n/id';
import type { PriceGroup } from '../../src/types/point-buy';

const EPB_PATH = resolve('src/lib/draft/__tests__/fixtures/example-list.json');
const LINES_PATH = resolve('src/app/(public)/draft-preview/fixture-lines.example.json');
const SEED = 0x0e4a3b1e;

/**
 * [base, stage 2, stage 3 | null]: @pkmn species names, every stage Gen 9 standard (`isNonstandard` null, so
 * the draft finder's Gen 9 dex resolves it). Branched bases: Pichu, Ralts, Poliwag, Oddish, Eevee.
 */
const SKELETON: readonly (readonly [string, string, string | null])[] = [
  ['Dratini', 'Dragonair', 'Dragonite'],
  ['Grubbin', 'Charjabug', 'Vikavolt'],
  ['Axew', 'Fraxure', 'Haxorus'],
  ['Bulbasaur', 'Ivysaur', 'Venusaur'],
  ['Charmander', 'Charmeleon', 'Charizard'],
  ['Squirtle', 'Wartortle', 'Blastoise'],
  ['Pichu', 'Pikachu', 'Raichu'],
  ['Pichu', 'Pikachu', 'Raichu-Alola'],
  ['Ralts', 'Kirlia', 'Gardevoir'],
  ['Ralts', 'Kirlia', 'Gallade'],
  ['Poliwag', 'Poliwhirl', 'Poliwrath'],
  ['Poliwag', 'Poliwhirl', 'Politoed'],
  ['Oddish', 'Gloom', 'Vileplume'],
  ['Oddish', 'Gloom', 'Bellossom'],
  ['Gastly', 'Haunter', 'Gengar'],
  ['Mareep', 'Flaaffy', 'Ampharos'],
  ['Geodude', 'Graveler', 'Golem'],
  ['Goomy', 'Sliggoo', 'Goodra'],
  ['Larvitar', 'Pupitar', 'Tyranitar'],
  ['Beldum', 'Metang', 'Metagross'],
  ['Gible', 'Gabite', 'Garchomp'],
  ['Fletchling', 'Fletchinder', 'Talonflame'],
  ['Froakie', 'Frogadier', 'Greninja'],
  ['Sprigatito', 'Floragato', 'Meowscarada'],
  ['Fuecoco', 'Crocalor', 'Skeledirge'],
  ['Quaxly', 'Quaxwell', 'Quaquaval'],
  ['Tinkatink', 'Tinkatuff', 'Tinkaton'],
  ['Frigibax', 'Arctibax', 'Baxcalibur'],
  ['Dreepy', 'Drakloak', 'Dragapult'],
  ['Rookidee', 'Corvisquire', 'Corviknight'],
  ['Pawmi', 'Pawmo', 'Pawmot'],
  ['Nacli', 'Naclstack', 'Garganacl'],
  ['Eevee', 'Vaporeon', null],
  ['Eevee', 'Jolteon', null],
  ['Magikarp', 'Gyarados', null],
  ['Growlithe', 'Arcanine', null],
  ['Shellder', 'Cloyster', null],
  ['Riolu', 'Lucario', null],
  ['Gligar', 'Gliscor', null],
  ['Sneasel', 'Weavile', null],
  ['Murkrow', 'Honchkrow', null],
  ['Misdreavus', 'Mismagius', null],
  ['Skwovet', 'Greedent', null],
  ['Wooper', 'Quagsire', null],
  ['Shroodle', 'Grafaiai', null],
  ['Bramblin', 'Brambleghast', null],
  ['Toedscool', 'Toedscruel', null],
  ['Capsakid', 'Scovillain', null],
];

/** German workbook prose (synthetic) of three lines; the pack's `specialRulesEn` pins two of them by hash. */
const SPECIAL_TEXT: Readonly<Record<string, string>> = {
  'dratini--dragonite': 'Beispielregel: Diese Linie sammelt Teilnahme-Tokens und bleibt im Redraft gesperrt.',
  'grubbin--vikavolt': 'Beispielregel: Charjabug braucht nach der ersten Entwicklung keine weiteren KOs.',
  'gastly--gengar': 'Beispielregel: Hypnose ist mit Sleep Clause erlaubt.',
};

/** Sheet thresholds of the rule lines (the participation line's are overridden by the pack). */
const PINNED_THRESHOLDS: Readonly<Record<string, readonly [number, number | null]>> = {
  'dratini--dragonite': [3, 8],
  'axew--haxorus': [2, 7],
};

/** mulberry32: a small, well-known seeded PRNG (deterministic across platforms). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

const { epb } = examplePack;

function priceGroupOf(price: number): PriceGroup {
  for (const group of epb.priceGroupOrder) if (price >= epb.priceGroups[group][0]) return group;
  return epb.priceGroupOrder[epb.priceGroupOrder.length - 1];
}

const TIER_OF: Record<PriceGroup, string> = { premium: 'S', hoch: 'A', mittel: 'B', guenstig: 'C', budget: 'C' };

const entries = SKELETON.map(([base, stage2, stage3], i) => {
  const lineNumber = i + 1;
  const lineId = `${toID(base)}--${toID(stage3 ?? stage2)}`;
  // Prices: the tabs take turns, the price is drawn inside the tab (every tab gets lines).
  const tab = epb.priceTabs[i % epb.priceTabs.length];
  const price = int(tab.min, tab.max);
  const rule = epb.lineRules.find((r) => r.base === base);
  const expected = rule?.expectedThresholds;
  const pinned = PINNED_THRESHOLDS[lineId];
  const k2 = expected?.killsToStage2 ?? pinned?.[0] ?? int(1, 4);
  const k3 = stage3 ? (expected ? expected.additionalKillsToStage3 : (pinned?.[1] ?? int(5, 10))) : null;
  const early = int(2, 7);
  const mid = Math.min(10, early + int(0, 3));
  const group = priceGroupOf(price);
  return {
    line_number: lineNumber,
    line_id: lineId,
    base_pokemon: base,
    stage2_pokemon: stage2,
    stage3_pokemon: stage3,
    price,
    kills_to_stage2: k2,
    additional_kills_to_stage3: k3,
    price_group: group,
    early_rating: early,
    mid_rating: mid,
    late_rating: Math.min(10, mid + int(0, 3)),
    rationale: `Example line ${lineNumber}; no real rationale.`,
    historical_data: 'Example: no historical data.',
    special_rules: storedFlagsOf(rule),
    special_rules_text: SPECIAL_TEXT[lineId] ?? null,
    sources: 'Example fixture (scripts/draft/make-example-list-fixtures.ts).',
    legacy_tier: TIER_OF[group],
    species_ids: { base: toID(base), stage2: toID(stage2), stage3: stage3 ? toID(stage3) : null },
  };
});

const wb = epb.workbook.pointBuy;
const avg = entries.reduce((sum, e) => sum + e.price, 0) / entries.length;
const overview: Record<string, number | string> = {
  [wb.overviewLabels.lineCount]: entries.length,
  [wb.overviewLabels.averagePrice]: Number(avg.toFixed(7)),
};
for (const group of epb.priceGroupOrder) {
  overview[wb.overviewGroupLabels[group]] = entries.filter((e) => e.price_group === group).length;
}

/** The example workbook's rules sheet (English; row positions are not load-bearing). */
const rules_sheet_rows: string[][] = [
  ['Example league point buy'],
  ['Draft size', String(epb.defaults.draftPicks)],
  ['Draft budget', String(epb.defaults.draftBudget)],
  [],
  ['Price group', 'Points'],
  ...epb.priceGroupOrder.map((g) => [wb.overviewGroupLabels[g], `${epb.priceGroups[g][0]}–${epb.priceGroups[g][1]}`]),
  [],
  ['Additional rules'],
  ...epb.defaults.bannedMoves.map((m) => [m, 'banned']),
  ...epb.defaults.bannedItems.map((m) => [m, 'banned']),
];

writeFileSync(
  EPB_PATH,
  `${JSON.stringify(
    {
      $comment:
        'EXAMPLE test data generated by scripts/draft/make-example-list-fixtures.ts from the public example format pack (seeded; importer-row shape, sheet values, pack overrides NOT applied). Stage names are @pkmn data; prices, thresholds, ratings and texts are synthetic. Do not edit by hand.',
      source: 'example-list-v1',
      overview,
      rules_sheet_rows,
      entries,
    },
    null,
    2,
  )}\n`,
  'utf-8',
);

// Read-layer shape (ids, narrow texts) with the example pack's overrides applied.
const lines = entries.map((e) => {
  const override = epb.lineOverrides.find((o) => o.line_id === e.line_id);
  const row = {
    list_version_id: 'example-list-v1',
    ...e,
    rationale: null,
    historical_data: null,
    sources: null,
    id: `example-entry-${String(e.line_number).padStart(3, '0')}`,
    overrides: [] as { field: string; sheet_value: number | null; applied_value: number; reason: { en: string; de: string } }[],
  };
  if (override) {
    for (const field of ['kills_to_stage2', 'additional_kills_to_stage3'] as const) {
      const applied = override[field];
      if (applied === undefined || row[field] === applied) continue;
      row.overrides.push({ field, sheet_value: row[field], applied_value: applied, reason: override.reason });
      row[field] = applied;
    }
  }
  return row;
});
writeFileSync(LINES_PATH, `${JSON.stringify(lines, null, 2)}\n`, 'utf-8');
console.log(`Wrote ${entries.length} example lines to ${EPB_PATH} and ${LINES_PATH}`);
