import { describe, expect, it } from 'vitest';
import {
  lineLookup,
  resolveEpbStage,
  resolveEpbStageTransitions,
  type LineThresholds,
} from '@/lib/match/epb-stage-resolution';
import { effectiveThresholds } from '@/lib/draft/line-catalog-data';

/** The example pack's instant-final-stage line. */
const instantLine: LineThresholds = {
  base_pokemon: 'Grubbin',
  stage2_pokemon: 'Charjabug',
  stage3_pokemon: 'Vikavolt',
  stage2_kos: 1,
  stage3_kos: 1,
};

/** The example sheet row says 3 / +8; the example pack's override makes it 5 / +5 (cumulative 5 / 10). */
const overriddenSheetRow = {
  base_pokemon: 'Dratini',
  stage2_pokemon: 'Dragonair',
  stage3_pokemon: 'Dragonite',
  kills_to_stage2: 3,
  additional_kills_to_stage3: 8,
};
const overriddenThresholds = effectiveThresholds(overriddenSheetRow);
const overriddenLine: LineThresholds = {
  line_id: overriddenThresholds.line_id,
  base_pokemon: 'Dratini',
  stage2_pokemon: 'Dragonair',
  stage3_pokemon: 'Dragonite',
  stage2_kos: overriddenThresholds.stage2_kos,
  stage3_kos: overriddenThresholds.stage3_kos,
};

describe('resolveEpbStageTransitions', () => {
  it('emits Charjabug then Vikavolt for the instant-final-stage line at 1 KO', () => {
    const transitions = resolveEpbStageTransitions(
      instantLine,
      1,
      'Grubbin',
      1,
      null
    );

    expect(transitions).toEqual([
      { form: 'Charjabug', stage: 2 },
      { form: 'Vikavolt', stage: 3 },
    ]);
  });

  it('the instant-final-stage line reaches its final stage even when the sheet asks for more kills', () => {
    // the pack rule, not the threshold, makes the double evolution
    expect(resolveEpbStageTransitions({ ...instantLine, stage3_kos: 9 }, 1, 'Grubbin', 1, null)).toEqual([
      { form: 'Charjabug', stage: 2 },
      { form: 'Vikavolt', stage: 3 },
    ]);
  });

  it('keeps the instant-final-stage jump on a recheck when the sheet asks for more kills', () => {
    // Regression: resolveEpbStage reported stage 2 below stage3_kos, so the next recheck after the
    // jump devolved the line back to Charjabug.
    const line = { ...instantLine, stage3_kos: 9 };
    expect(resolveEpbStage(line, 1, null)).toEqual({ form: 'Vikavolt', stage: 3 });
    expect(resolveEpbStageTransitions(line, 3, 'Vikavolt', 1, null)).toEqual([]);
    expect(resolveEpbStageTransitions(line, 3, 'Vikavolt', 2, null)).toEqual([]);
    // Below stage2_kos it is still the base form.
    expect(resolveEpbStage(line, 0, null)).toEqual({ form: 'Grubbin', stage: 1 });
  });

  it('advances an instant-final-stage line that already sits at stage 2 when the sheet asks for more kills', () => {
    // Regression: a tracker at stage 2 (e.g. written by a redraft transfer) never reached stage 3,
    // because the step-3 branch still waited for the stored stage3_kos.
    const line = { ...instantLine, stage3_kos: 9 };
    expect(resolveEpbStageTransitions(line, 2, 'Charjabug', 1, null)).toEqual([{ form: 'Vikavolt', stage: 3 }]);
    expect(resolveEpbStageTransitions(line, 2, 'Charjabug', 0, null)).toEqual([{ form: 'Grubbin', stage: 1 }]);
  });

  it('emits both stage transitions when a 3/8 line crosses both thresholds at once', () => {
    const gastlyLine: LineThresholds = {
      base_pokemon: 'Gastly',
      stage2_pokemon: 'Haunter',
      stage3_pokemon: 'Gengar',
      stage2_kos: 3,
      stage3_kos: 11,
    };

    const transitions = resolveEpbStageTransitions(
      gastlyLine,
      1,
      'Gastly',
      11,
      null
    );

    expect(transitions).toEqual([
      { form: 'Haunter', stage: 2 },
      { form: 'Gengar', stage: 3 },
    ]);
  });

  it('overridden cumulative thresholds are 5 / 10 (example override 5 + 5)', () => {
    expect(overriddenLine).toMatchObject({ line_id: 'dratini--dragonite', stage2_kos: 5, stage3_kos: 10 });
    expect(resolveEpbStage(overriddenLine, 4, null)).toEqual({ form: 'Dratini', stage: 1 });
    expect(resolveEpbStage(overriddenLine, 5, null)).toEqual({ form: 'Dragonair', stage: 2 });
    expect(resolveEpbStage(overriddenLine, 9, null)).toEqual({
      form: 'Dragonair',
      stage: 2,
    });
    expect(resolveEpbStage(overriddenLine, 10, 'Dragonite')).toEqual({
      form: 'Dragonite',
      stage: 3,
    });
  });

  it('transferred progress counts: 10 total progress evolves the line straight to stage 3', () => {
    // e.g. 6 transferred + 2 real kills + 2 Cosmo Tokens = total_kos 10
    expect(resolveEpbStageTransitions(overriddenLine, 1, 'Dratini', 10, 'Dragonite')).toEqual([
      { form: 'Dragonair', stage: 2 },
      { form: 'Dragonite', stage: 3 },
    ]);
  });
});

describe('lineLookup', () => {
  const samurott: LineThresholds = {
    line_id: 'oshawott--samurott',
    base_pokemon: 'Oshawott',
    stage2_pokemon: 'Dewott',
    stage3_pokemon: 'Samurott',
    stage2_kos: 3,
    stage3_kos: 9,
  };
  const hisui: LineThresholds = { ...samurott, line_id: 'oshawott--samurotthisui', stage3_pokemon: 'Samurott-Hisui', stage3_kos: 11 };
  const lineOf = lineLookup([samurott, hisui]);

  it('resolves a tracker by its line id (both branches of one base)', () => {
    expect(lineOf({ line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott' })).toBe(hisui);
    expect(lineOf({ line_id: 'oshawott--samurott', base_pokemon: 'Oshawott' })).toBe(samurott);
  });

  it('falls back to base + locked stage 3, then the first line of the base, for legacy trackers', () => {
    expect(lineOf({ line_id: null, base_pokemon: 'Oshawott', locked_stage3_pokemon: 'Samurott-Hisui' })).toBe(hisui);
    expect(lineOf({ base_pokemon: 'Oshawott' })).toBe(samurott);
  });

  it('matches lines loaded without ids (evolution-tier leagues) by their derived line id', () => {
    const legacy = lineLookup([{ ...samurott, line_id: null }, { ...hisui, line_id: null }]);
    expect(legacy({ line_id: 'oshawott--samurott', base_pokemon: 'Oshawott' })?.stage3_pokemon).toBe('Samurott');
    expect(legacy({ line_id: 'oshawott--samurotthisui', base_pokemon: 'Oshawott' })?.stage3_pokemon).toBe('Samurott-Hisui');
  });

  it('returns undefined for a tracker line id that matches no line (no base guess)', () => {
    // Same base, unknown branch: a base fallback would wrongly hand back Samurott.
    expect(lineOf({ line_id: 'oshawott--unknown', base_pokemon: 'Oshawott' })).toBeUndefined();
    expect(
      lineOf({ line_id: 'oshawott--unknown', base_pokemon: 'Oshawott', locked_stage3_pokemon: 'Samurott-Hisui' }),
    ).toBeUndefined();
  });

  it('uses the base fallback only when the tracker line id is null or absent', () => {
    expect(lineOf({ line_id: null, base_pokemon: 'Oshawott' })).toBe(samurott);
    expect(lineOf({ line_id: '', base_pokemon: 'Oshawott', locked_stage3_pokemon: 'Samurott-Hisui' })).toBe(hisui);
  });

  it('returns undefined for an unknown base', () => {
    expect(lineOf({ base_pokemon: 'Pichu' })).toBeUndefined();
  });
});
