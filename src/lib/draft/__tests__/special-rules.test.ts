import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import {
  isCosmogLine,
  isScatterbugLine,
  isNoCocoonLine,
  isRedraftExcluded,
  handleInstantFinalStage,
  shouldAwardCosmoPoint,
  applyNoCocoonRule,
  toCumulativeThresholds,
  resolveNextStageTarget,
} from '../special-rules';

// The example pack's line rules (src/format-packs/example/epb.ts): Dratini is the participation
// (redraft-locked) line, Grubbin the instant-final-stage line, Axew the no-cocoon line.

// ─── Line Identification ───────────────────────────────────────────

describe('line identification', () => {
  it('identifies the participation line', () => {
    expect(isCosmogLine('Dratini')).toBe(true);
    expect(isCosmogLine('Pikachu')).toBe(false);
  });

  it('reads the stored special_rules.cosmog flag of a list entry (BR-2)', () => {
    expect(isCosmogLine({ base_pokemon: 'Dratini', special_rules: { cosmog: true, no_redraft: true } })).toBe(true);
    // the stored flag decides, whatever the base is called
    expect(isCosmogLine({ base_pokemon: 'Dragonair', special_rules: { cosmog: true } })).toBe(true);
    // base-name fallback without flags (trackers, threshold rows)
    expect(isCosmogLine({ base_pokemon: 'Dratini' })).toBe(true);
    expect(isCosmogLine({ base_pokemon: 'Pikachu', special_rules: { no_redraft: true } })).toBe(false);
  });

  it('identifies the instant-final-stage line (pack rule only, not the stored flag)', () => {
    expect(isScatterbugLine('Grubbin')).toBe(true);
    expect(isScatterbugLine('Axew')).toBe(false);
  });

  it('identifies the no-cocoon line', () => {
    expect(isNoCocoonLine('Axew')).toBe(true);
    expect(isNoCocoonLine('Grubbin')).toBe(false);
  });

  it('follows the pack: every lineRules entry maps onto its predicate', () => {
    for (const rule of epbPack.lineRules) {
      expect(isCosmogLine(rule.base)).toBe(!!rule.participationPoints);
      expect(isScatterbugLine(rule.base)).toBe(!!rule.instantFinalStage);
      expect(isNoCocoonLine(rule.base)).toBe(!!rule.noCocoon);
    }
  });
});

describe('isRedraftExcluded', () => {
  it('excludes the participation line by default', () => {
    expect(isRedraftExcluded('Dratini', null)).toBe(true);
  });

  it('excludes a line flagged cosmog (participation locks the redraft in the example pack)', () => {
    expect(epbPack.participationPoints.locksRedraft).toBe(true);
    expect(isRedraftExcluded('Dragonair', { cosmog: true })).toBe(true);
  });

  it('excludes lines with no_redraft special rule', () => {
    expect(isRedraftExcluded('Pikachu', { no_redraft: true })).toBe(true);
  });

  it('allows normal lines', () => {
    expect(isRedraftExcluded('Charmander', null)).toBe(false);
    expect(isRedraftExcluded('Charmander', {})).toBe(false);
    expect(isRedraftExcluded('Grubbin', null)).toBe(false);
  });
});

// ─── Instant Final Stage ───────────────────────────────────────────

describe('handleInstantFinalStage', () => {
  const line = { base_pokemon: 'Grubbin', stage2_pokemon: 'Charjabug', stage3_pokemon: 'Vikavolt', stage2_kos: 1 };

  it('no evolution below threshold', () => {
    const result = handleInstantFinalStage(line, 0);
    expect(result.evolvedToStage2).toBe(false);
    expect(result.evolvedToStage3).toBe(false);
    expect(result.events).toHaveLength(0);
  });

  it('instant double evolution at threshold (1/0), described from the stage names', () => {
    const result = handleInstantFinalStage(line, 1);
    expect(result.evolvedToStage2).toBe(true);
    expect(result.evolvedToStage3).toBe(true);
    expect(result.events).toEqual([
      { new_stage: 2, description: 'Grubbin evolved into Charjabug' },
      { new_stage: 3, description: 'Charjabug evolved into Vikavolt' },
    ]);
  });

  it('also triggers with excess kills', () => {
    const result = handleInstantFinalStage(line, 5);
    expect(result.evolvedToStage2).toBe(true);
    expect(result.evolvedToStage3).toBe(true);
  });

  it('a two-stage line only reaches stage 2', () => {
    const result = handleInstantFinalStage({ ...line, stage3_pokemon: null }, 1);
    expect(result.evolvedToStage3).toBe(false);
    expect(result.events).toHaveLength(1);
  });
});

// ─── Participation Line ────────────────────────────────────────────

// The 2:1 Comeback conversion of the participation line is dropped: it takes every token
// source 1:1 (progress-engine.test covers the legacy distribution).

describe('shouldAwardCosmoPoint', () => {
  const until = epbPack.participationPoints.untilStage;

  it('awards below the pack untilStage', () => {
    for (let stage = 1; stage < until; stage++) expect(shouldAwardCosmoPoint(stage)).toBe(true);
  });

  it('stops at untilStage', () => {
    expect(shouldAwardCosmoPoint(until)).toBe(false);
    expect(shouldAwardCosmoPoint(until + 1)).toBe(false);
  });
});

// ─── No-Cocoon Line ────────────────────────────────────────────────

describe('applyNoCocoonRule', () => {
  it('does not modify values (no cocoon rule)', () => {
    const result = applyNoCocoonRule(2, 10);
    expect(result).toEqual({ killsToStage2: 2, additionalKillsToStage3: 10 });
  });
});

// ─── Cumulative Thresholds ─────────────────────────────────────────

describe('toCumulativeThresholds', () => {
  it('computes cumulative stage3_kos', () => {
    const result = toCumulativeThresholds(4, 10);
    expect(result).toEqual({ stage2_kos: 4, stage3_kos: 14 });
  });

  it('handles null stage3', () => {
    const result = toCumulativeThresholds(3, null);
    expect(result).toEqual({ stage2_kos: 3, stage3_kos: null });
  });

  it('instant-final-stage 1/0 → cumulative 1', () => {
    const result = toCumulativeThresholds(1, 0);
    expect(result).toEqual({ stage2_kos: 1, stage3_kos: 1 });
  });

  it('3/8 → cumulative 11 (sheet values before an override)', () => {
    const result = toCumulativeThresholds(3, 8);
    expect(result).toEqual({ stage2_kos: 3, stage3_kos: 11 });
  });
});

// ── Next-Stage Resolution ────────────────────────────────────

describe('resolveNextStageTarget', () => {
  const threeStageLine = {
    stage2_pokemon: 'Haunter',
    stage3_pokemon: 'Gengar',
    kills_to_stage2: 5,
    additional_kills_to_stage3: 10,
  };
  const twoStageLine = {
    stage2_pokemon: 'Raichu',
    stage3_pokemon: null,
    kills_to_stage2: 8,
    additional_kills_to_stage3: null,
  };

  it('stage 1 targets stage 2 with the cumulative stage-2 threshold', () => {
    expect(resolveNextStageTarget(threeStageLine, 1)).toEqual({
      nextForm: 'Haunter',
      requirement: 5,
    });
  });

  it('stage 2 with a stage 3 targets stage 3 with the cumulative threshold', () => {
    expect(resolveNextStageTarget(threeStageLine, 2)).toEqual({
      nextForm: 'Gengar',
      requirement: 15,
    });
  });

  it('returns null at stage 2 of a two-stage line (fully evolved)', () => {
    expect(resolveNextStageTarget(twoStageLine, 2)).toBeNull();
  });

  it('returns null at stage 3 (fully evolved)', () => {
    expect(resolveNextStageTarget(threeStageLine, 3)).toBeNull();
  });

  it('stage 1 of a two-stage line still targets stage 2', () => {
    expect(resolveNextStageTarget(twoStageLine, 1)).toEqual({
      nextForm: 'Raichu',
      requirement: 8,
    });
  });
});
