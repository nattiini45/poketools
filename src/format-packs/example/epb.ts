/**
 * Example pack: Evolution Point Buy tuning. Deliberately unlike any real league; it exists so a
 * public checkout demonstrates every mechanic (design spec §B.4). Every base named here exists
 * in the example fixture (`scripts/draft/make-example-list-fixtures.ts`).
 */
import type { FormatPack } from '@/lib/format-pack/types';
import { exampleUtility } from './utility';
import { exampleWorkbook } from './workbook';

export const exampleEpb = {
  defaults: {
    draftBudget: 100,
    draftPicks: 6,
    tokenRatio: 5,
    tokenMax: 1,
    tokenMaxPerLine: 1,
    redraftMaxLines: 2,
    bannedMoves: ['Last Respects'],
    bannedItems: ['Bright Powder'],
  },
  matchPoints: { win: 3, draw: 1 },
  teraByStage: { stage1: 'any', stage2: 'any', stage3: 'stab_only' },
  tiebreakerChain: ['match_points', 'kill_difference', 'evolution_points', 'head_to_head', 'decision_match'],
  comeback: { table: [{ minWinnerSurvivors: 4, tokens: 1 }], earnWindow: 'season' },
  stageLock: { enabled: true, stage: 3, byMatchday: 2, suspendMatchdays: 1 },
  participationPoints: {
    perMatchday: 1,
    untilStage: 3,
    locksRedraft: true,
    awardNote: 'Participation Token for bringing the line on this matchday',
    comebackTokensPerProgress: 1,
  },
  draftClock: { quietHours: null },
  priceGroups: {
    premium: [20, 25],
    hoch: [15, 19],
    mittel: [10, 14],
    guenstig: [6, 9],
    budget: [1, 5],
  },
  priceGroupOrder: ['premium', 'hoch', 'mittel', 'guenstig', 'budget'],
  priceTabs: [
    { key: '25-20', min: 20, max: 25 },
    { key: '19-15', min: 15, max: 19 },
    { key: '14-10', min: 10, max: 14 },
    { key: '9-1', min: 1, max: 9 },
  ],
  lineRules: [
    { base: 'Dratini', participationPoints: true, redraftLocked: true },
    { base: 'Grubbin', instantFinalStage: true, expectedThresholds: { killsToStage2: 1, additionalKillsToStage3: 0 } },
    { base: 'Axew', noCocoon: true },
  ],
  lineOverrides: [
    {
      line_id: 'dratini--dragonite',
      kills_to_stage2: 5,
      additional_kills_to_stage3: 5,
      reason: {
        en: 'Example ruling: the participation line needs 5 KOs, then 5 more.',
        de: 'Beispielregel: Die Teilnahme-Linie braucht 5 KOs und danach 5 weitere.',
      },
      source: 'Example pack (src/format-packs/example/epb.ts)',
    },
  ],
  specialRulesEn: {
    'dratini--dragonite': {
      de_hash: '82f57c50',
      en: 'Example rule: this line earns Participation Tokens and stays locked in the redraft.',
    },
    'grubbin--vikavolt': {
      de_hash: 'bf63576e',
      en: 'Example rule: Charjabug needs no further KOs after the first evolution.',
    },
  },
  utility: exampleUtility,
  workbook: exampleWorkbook,
  reconciliation: {
    knownRepoOnlyBanIds: [],
    pastStatusHealingIds: [],
  },
} satisfies FormatPack['epb'];
