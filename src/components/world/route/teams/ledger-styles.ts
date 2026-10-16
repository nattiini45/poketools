import type { LedgerStyle } from './ledger-painter';

/**
 * The four worlds' Roll-Call Ledger palettes and rail materials (fidelity
 * wave 2, seat 2G — D16). Pure data, so the contrast law can pin them: cream
 * ink, sub-ink and kicker ≥ 4.5:1 on the rest ground AND on both roll-call
 * grounds (ledger-painter.test.ts). The face is self-lit (emissive = its own
 * map, `fog: false`, the W1 data-material rule) on a dark ground, so the
 * rendered contrast only rises over the texture-space numbers checked here.
 */

export interface LedgerMaterial {
  bezel: string;
  roughness: number;
  metalness: number;
}

/** Plaza: the stone "Trainer" rail — limestone slab, dark slate face. */
export const PLAZA_LEDGER_STYLE: LedgerStyle = {
  ground: '#1e2126',
  groundCalled: '#282c33',
  groundCalling: '#343942',
  ink: '#f6ecd6',
  subInk: '#dcd3c2',
  kickerInk: '#f2b8a8',
  rule: '#4d535c',
  frame: '#c8b690',
};
export const PLAZA_LEDGER_MATERIAL: LedgerMaterial = { bezel: '#b9ab94', roughness: 0.82, metalness: 0.04 };

/** Sakura: a walnut rail, dark lacquer face. */
export const SAKURA_LEDGER_STYLE: LedgerStyle = {
  ground: '#241811',
  groundCalled: '#2e2017',
  groundCalling: '#3b2a1e',
  ink: '#f6ecd6',
  subInk: '#e2d2b4',
  kickerInk: '#f0b9c4',
  rule: '#5b4330',
  frame: '#c9a46a',
};
export const SAKURA_LEDGER_MATERIAL: LedgerMaterial = { bezel: '#4a3222', roughness: 0.62, metalness: 0.08 };

/** Mountain: a bronze rail, dark patina face. */
export const MOUNTAIN_LEDGER_STYLE: LedgerStyle = {
  ground: '#1d1a15',
  groundCalled: '#27231c',
  groundCalling: '#332d24',
  ink: '#f4ead4',
  subInk: '#dcd0b6',
  kickerInk: '#e6b27a',
  rule: '#54452f',
  frame: '#a8844f',
};
export const MOUNTAIN_LEDGER_MATERIAL: LedgerMaterial = { bezel: '#6b5436', roughness: 0.42, metalness: 0.6 };

/** Clouds: a brass rail on a navy-slate face. */
export const CLOUDS_LEDGER_STYLE: LedgerStyle = {
  ground: '#17202c',
  groundCalled: '#1f2a38',
  groundCalling: '#2a3748',
  ink: '#f7efdc',
  subInk: '#d8cdb4',
  kickerInk: '#e2c27a',
  rule: '#5a4a2c',
  frame: '#b8934f',
};
export const CLOUDS_LEDGER_MATERIAL: LedgerMaterial = { bezel: '#8a6d3b', roughness: 0.38, metalness: 0.72 };
