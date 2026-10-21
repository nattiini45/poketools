/**
 * Example pack: the workbook layout the importers read (documented in docs/point-buy-format.md).
 * English sheet names and a column order of its own.
 */
import type { WorkbookMap } from '@/lib/format-pack/types';

export const exampleWorkbook = {
  pointBuy: {
    sheet: 'Lines',
    defaultListName: 'Example Point Buy',
    overviewSheet: 'Summary',
    rulesSheet: 'Rules',
    columns: {
      lineNumber: 0,
      evolutionLine: 1,
      startName: 2,
      price: 3,
      priceGroup: 4,
      killsToStage2: 5,
      additionalKillsToStage3: 6,
      legacyTier: 7,
      early: 8,
      mid: 9,
      late: 10,
      rationale: 11,
      historical: 12,
      specialRulesText: 13,
      sources: 14,
    },
    skipStartNames: ['start', 'base', 'group'],
    priceGroupSpellings: {
      top: 'premium',
      upper: 'hoch',
      middle: 'mittel',
      lower: 'guenstig',
      bargain: 'budget',
    },
    overviewGroupLabels: {
      premium: 'Top',
      hoch: 'Upper',
      mittel: 'Middle',
      guenstig: 'Lower',
      budget: 'Bargain',
    },
    overviewLabels: { lineCount: 'Line count', averagePrice: 'Average price' },
  },
  utilitySheet: {
    sheet: 'Utility',
    categories: ['Hazards', 'Hazard Control', 'Recovery', 'Pivoting', 'Priority'],
    branchMarkers: {
      'Pikachu (A)': { species: 'Pikachu', line: ['Pichu', 'Raichu-Alola'] },
    },
    typos: {},
    exact: {},
    moveRenames: { 'U-Turn': 'U-turn' },
  },
  teamRoles: {
    sheets: ['Roles A', 'Roles B'],
    categoryLabels: {
      hazards: 'hazard_setting',
      'hazard control': 'hazard_removal',
      healing: 'healing_cleric',
      pivoting: 'momentum',
      'item removal': 'item_removal',
      status: 'status',
      priority: 'priority',
      disruption: 'disruption',
    },
    blocks: [
      { label: 'Hazards', category: 'hazard_setting', speciesCol: 0, moveCol: 1 },
      { label: 'Hazard control', category: 'hazard_removal', speciesCol: 2, moveCol: 3 },
      { label: 'Healing', category: 'healing_cleric', speciesCol: 4, moveCol: 5 },
      { label: 'Pivoting', category: 'momentum', speciesCol: 6, moveCol: 7 },
      { label: 'Item removal', category: 'item_removal', speciesCol: 8, moveCol: 9 },
      { label: 'Status', category: 'status', speciesCol: 10, moveCol: 11 },
      { label: 'Priority', category: 'priority', speciesCol: 12, moveCol: 13 },
      { label: 'Disruption', category: 'disruption', speciesCol: 14, moveCol: 15 },
    ],
  },
} satisfies WorkbookMap;
