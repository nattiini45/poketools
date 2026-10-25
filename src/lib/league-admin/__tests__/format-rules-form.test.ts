import { describe, expect, it } from 'vitest';
import { epbPack } from '@/lib/format-pack';
import { formatRulesSchema } from '@/lib/validation/schemas';
import { DEFAULT_BANNED_ITEMS, DEFAULT_BANNED_MOVES, type FormatRules } from '@/types/format-rules';
import {
  BANNED_NAME_MAX_LENGTH,
  FORMAT_RULES_LIMITS,
  FORMAT_RULES_NUMBER_FIELDS,
  TIEBREAKER_STEPS,
  addTiebreakerStep,
  buildFormatRulesPayload,
  changedFormatRulesFields,
  defaultFormatRulesPayload,
  formatRulesFormDirty,
  formatRulesToForm,
  moveTiebreakerStep,
  removeTiebreakerStep,
  unusedTiebreakerSteps,
  validateFormatRulesForm,
  type FormatRulesFormValues,
  type FormatRulesNumberField,
} from '../format-rules-form';

const RULES: FormatRules = {
  id: 'fr-1',
  season_id: 's1',
  banned_moves: ['Baton Pass', 'Shed Tail'],
  banned_items: ['King’s Rock'],
  tera_rules: { ...epbPack.teraByStage },
  tiebreaker_order: ['match_points', 'evolution_points', 'kill_difference', 'head_to_head', 'decision_match'],
  draft_budget: 180,
  draft_picks: 9,
  draft_token_ratio: 3,
  draft_token_max: 2,
  draft_token_max_per_line: 1,
  redraft_phase_open: true,
  created_at: '2026-01-01T00:00:00Z',
};

function form(overrides: Partial<FormatRulesFormValues> = {}): FormatRulesFormValues {
  return { ...formatRulesToForm(RULES), ...overrides };
}

describe('limits parity with formatRulesSchema', () => {
  it.each(FORMAT_RULES_NUMBER_FIELDS)('%s: min and max are accepted on both sides', (field) => {
    const { min, max } = FORMAT_RULES_LIMITS[field];
    for (const value of [min, max]) {
      const values = form({ [field]: String(value) });
      expect(validateFormatRulesForm(values)).toEqual([]);
      expect(formatRulesSchema.safeParse(buildFormatRulesPayload(values)).success, `${field}=${value}`).toBe(true);
    }
  });

  it.each(FORMAT_RULES_NUMBER_FIELDS)('%s: below min, above max, a fraction and empty fail on both sides', (field) => {
    const { min, max } = FORMAT_RULES_LIMITS[field];
    for (const text of [String(min - 1), String(max + 1), '1.5', '']) {
      const values = form({ [field]: text });
      expect(
        validateFormatRulesForm(values).some((e) => e.field === field),
        `client ${field}="${text}"`,
      ).toBe(true);
      expect(formatRulesSchema.safeParse(buildFormatRulesPayload(values)).success, `server ${field}="${text}"`).toBe(
        false,
      );
    }
  });

  it('reports which bound was crossed', () => {
    const { min, max } = FORMAT_RULES_LIMITS.draft_picks;
    expect(validateFormatRulesForm(form({ draft_picks: String(min - 1) }))).toEqual([
      { field: 'draft_picks', code: 'too_small', limit: min },
    ]);
    expect(validateFormatRulesForm(form({ draft_picks: String(max + 1) }))).toEqual([
      { field: 'draft_picks', code: 'too_big', limit: max },
    ]);
    expect(validateFormatRulesForm(form({ draft_picks: '' }))).toEqual([{ field: 'draft_picks', code: 'required' }]);
    expect(validateFormatRulesForm(form({ draft_picks: '1.5' }))).toEqual([
      { field: 'draft_picks', code: 'not_integer' },
    ]);
    expect(validateFormatRulesForm(form({ draft_picks: 'abc' }))).toEqual([
      { field: 'draft_picks', code: 'not_integer' },
    ]);
  });

  it('pins the limits the editor shows', () => {
    expect(FORMAT_RULES_LIMITS).toEqual({
      draft_budget: { min: 1, max: 999 },
      draft_picks: { min: 1, max: 20 },
      draft_token_ratio: { min: 1, max: 10 },
      draft_token_max: { min: 0, max: 5 },
      draft_token_max_per_line: { min: 0, max: 3 },
    });
  });

  it('the banned name length matches the schema', () => {
    const ok = 'x'.repeat(BANNED_NAME_MAX_LENGTH);
    const tooLong = 'x'.repeat(BANNED_NAME_MAX_LENGTH + 1);
    expect(formatRulesSchema.safeParse({ banned_moves: [ok] }).success).toBe(true);
    expect(formatRulesSchema.safeParse({ banned_moves: [tooLong] }).success).toBe(false);
    expect(validateFormatRulesForm(form({ banned_moves: [ok] }))).toEqual([]);
    expect(validateFormatRulesForm(form({ banned_items: [tooLong] }))).toEqual([
      { field: 'banned_items', code: 'too_long', limit: BANNED_NAME_MAX_LENGTH },
    ]);
  });

  it('TIEBREAKER_STEPS are exactly the steps the schema accepts', () => {
    for (const step of TIEBREAKER_STEPS) {
      expect(formatRulesSchema.safeParse({ tiebreaker_order: [step] }).success, step).toBe(true);
    }
    expect(formatRulesSchema.safeParse({ tiebreaker_order: ['coin_flip'] }).success).toBe(false);
    expect(TIEBREAKER_STEPS).toHaveLength(5);
  });
});

describe('buildFormatRulesPayload', () => {
  it('is always the full object: the eight editable fields, nothing partial', () => {
    const payload = buildFormatRulesPayload(formatRulesToForm(RULES));
    expect(payload).toEqual({
      banned_moves: ['Baton Pass', 'Shed Tail'],
      banned_items: ['King’s Rock'],
      tiebreaker_order: RULES.tiebreaker_order,
      draft_budget: 180,
      draft_picks: 9,
      draft_token_ratio: 3,
      draft_token_max: 2,
      draft_token_max_per_line: 1,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        'banned_items',
        'banned_moves',
        'draft_budget',
        'draft_picks',
        'draft_token_max',
        'draft_token_max_per_line',
        'draft_token_ratio',
        'tiebreaker_order',
      ].sort(),
    );
  });

  it('keeps an empty ban list in the body (a missing key would reset it on the server)', () => {
    const payload = buildFormatRulesPayload(form({ banned_moves: [], banned_items: [] }));
    expect(payload.banned_moves).toEqual([]);
    expect(payload.banned_items).toEqual([]);
  });

  it('never carries tera_rules or redraft_phase_open', () => {
    const payload = buildFormatRulesPayload(formatRulesToForm(RULES));
    expect(payload).not.toHaveProperty('tera_rules');
    expect(payload).not.toHaveProperty('redraft_phase_open');
    expect(payload).not.toHaveProperty('comeback_spend_open');
  });

  it('parses the typed text into whole numbers, and is accepted by the server schema', () => {
    const payload = buildFormatRulesPayload(form({ draft_budget: ' 050 ', draft_token_max: '0' }));
    expect(payload.draft_budget).toBe(50);
    expect(payload.draft_token_max).toBe(0);
    expect(formatRulesSchema.safeParse(payload).success).toBe(true);
  });

  it('copies the lists instead of sharing them with the form', () => {
    const values = formatRulesToForm(RULES);
    const payload = buildFormatRulesPayload(values);
    expect(payload.banned_moves).not.toBe(values.banned_moves);
    expect(payload.tiebreaker_order).not.toBe(values.tiebreaker_order);
  });
});

describe('formatRulesToForm', () => {
  it('writes numbers as text and copies the lists', () => {
    const values = formatRulesToForm(RULES);
    expect(values.draft_budget).toBe('180');
    expect(values.draft_token_max_per_line).toBe('1');
    expect(values.banned_moves).toEqual(RULES.banned_moves);
    expect(values.banned_moves).not.toBe(RULES.banned_moves);
  });
});

describe('dirty detection', () => {
  const baseline = formatRulesToForm(RULES);

  it('is clean for the baseline itself and for equal numbers typed differently', () => {
    expect(formatRulesFormDirty(baseline, formatRulesToForm(RULES))).toBe(false);
    expect(formatRulesFormDirty(form({ draft_picks: '5' }), form({ draft_picks: '05' }))).toBe(false);
    expect(formatRulesFormDirty(baseline, form({ draft_budget: ' 180 ' }))).toBe(false);
  });

  it('ignores the order of the ban lists', () => {
    expect(formatRulesFormDirty(baseline, form({ banned_moves: ['Shed Tail', 'Baton Pass'] }))).toBe(false);
  });

  it('sees an added or removed ban', () => {
    expect(formatRulesFormDirty(baseline, form({ banned_moves: ['Baton Pass'] }))).toBe(true);
    expect(formatRulesFormDirty(baseline, form({ banned_items: [...baseline.banned_items, 'Soul Dew'] }))).toBe(true);
  });

  it('respects the tiebreaker order', () => {
    const swapped = moveTiebreakerStep(baseline.tiebreaker_order, 0, 1);
    expect(formatRulesFormDirty(baseline, form({ tiebreaker_order: swapped }))).toBe(true);
  });

  it('sees a changed number', () => {
    expect(formatRulesFormDirty(baseline, form({ draft_budget: '181' }))).toBe(true);
  });

  it('lists the changed fields in form order', () => {
    const changed = changedFormatRulesFields(
      baseline,
      form({ draft_token_max: '3', draft_budget: '200', banned_items: [], tiebreaker_order: ['match_points'] }),
    );
    expect(changed).toEqual(['draft_budget', 'draft_token_max', 'banned_items', 'tiebreaker_order']);
    expect(changedFormatRulesFields(baseline, baseline)).toEqual([]);
  });

  it('treats unparsable text as input of its own', () => {
    expect(formatRulesFormDirty(baseline, form({ draft_budget: '' }))).toBe(true);
    expect(formatRulesFormDirty(form({ draft_budget: 'x' }), form({ draft_budget: ' x ' }))).toBe(false);
  });
});

describe('moveTiebreakerStep', () => {
  const order = ['match_points', 'kill_difference', 'head_to_head'] as const;

  it('swaps a step with its neighbour', () => {
    expect(moveTiebreakerStep(order, 1, -1)).toEqual(['kill_difference', 'match_points', 'head_to_head']);
    expect(moveTiebreakerStep(order, 1, 1)).toEqual(['match_points', 'head_to_head', 'kill_difference']);
  });

  it('leaves the order alone at both ends and for a bad index, without mutating the input', () => {
    expect(moveTiebreakerStep(order, 0, -1)).toEqual([...order]);
    expect(moveTiebreakerStep(order, 2, 1)).toEqual([...order]);
    expect(moveTiebreakerStep(order, 5, -1)).toEqual([...order]);
    expect(moveTiebreakerStep(order, -1, 1)).toEqual([...order]);
    expect(order).toEqual(['match_points', 'kill_difference', 'head_to_head']);
  });
});

describe('tiebreaker order rules', () => {
  it('requires at least one step', () => {
    expect(validateFormatRulesForm(form({ tiebreaker_order: [] }))).toEqual([
      { field: 'tiebreaker_order', code: 'empty' },
    ]);
  });

  it('keeps a decision match last', () => {
    expect(
      validateFormatRulesForm(form({ tiebreaker_order: ['decision_match', 'match_points'] })),
    ).toEqual([{ field: 'tiebreaker_order', code: 'decision_last' }]);
    expect(validateFormatRulesForm(form({ tiebreaker_order: ['match_points', 'decision_match'] }))).toEqual([]);
    expect(validateFormatRulesForm(form({ tiebreaker_order: ['decision_match'] }))).toEqual([]);
  });

  it('refuses a step twice', () => {
    expect(validateFormatRulesForm(form({ tiebreaker_order: ['match_points', 'match_points'] }))).toEqual([
      { field: 'tiebreaker_order', code: 'duplicate' },
    ]);
  });

  it('adds a step before the decision match, removes by position and lists the unused steps', () => {
    expect(addTiebreakerStep(['match_points', 'decision_match'], 'head_to_head')).toEqual([
      'match_points',
      'head_to_head',
      'decision_match',
    ]);
    expect(addTiebreakerStep(['match_points'], 'decision_match')).toEqual(['match_points', 'decision_match']);
    expect(addTiebreakerStep(['match_points'], 'match_points')).toEqual(['match_points']);
    expect(removeTiebreakerStep(['match_points', 'head_to_head'], 0)).toEqual(['head_to_head']);
    expect(unusedTiebreakerSteps(['match_points', 'decision_match'])).toEqual([
      'evolution_points',
      'kill_difference',
      'head_to_head',
    ]);
    expect(unusedTiebreakerSteps(TIEBREAKER_STEPS)).toEqual([]);
  });
});

describe('ban list rules', () => {
  it('refuses blank and repeated names', () => {
    expect(validateFormatRulesForm(form({ banned_moves: ['Baton Pass', ' '] }))).toEqual([
      { field: 'banned_moves', code: 'empty' },
    ]);
    expect(validateFormatRulesForm(form({ banned_items: ['Soul Dew', 'Soul Dew'] }))).toEqual([
      { field: 'banned_items', code: 'duplicate' },
    ]);
  });
});

describe('validateFormatRulesForm', () => {
  it('accepts the stored rules and lists several problems in form order', () => {
    expect(validateFormatRulesForm(formatRulesToForm(RULES))).toEqual([]);
    const fields = validateFormatRulesForm(
      form({ draft_budget: '0', draft_token_max_per_line: '9', tiebreaker_order: [] }),
    ).map((e) => e.field);
    expect(fields).toEqual(['draft_budget', 'draft_token_max_per_line', 'tiebreaker_order']);
  });
});

describe('defaultFormatRulesPayload', () => {
  it('is the body Initialize sent before the editor: the pack bans and draft numbers only', () => {
    expect(defaultFormatRulesPayload()).toEqual({
      banned_moves: DEFAULT_BANNED_MOVES,
      banned_items: DEFAULT_BANNED_ITEMS,
      draft_budget: epbPack.defaults.draftBudget,
      draft_picks: epbPack.defaults.draftPicks,
      draft_token_ratio: epbPack.defaults.tokenRatio,
      draft_token_max: epbPack.defaults.tokenMax,
      draft_token_max_per_line: epbPack.defaults.tokenMaxPerLine,
    });
  });

  it('is accepted by the server schema and shares no array with the defaults', () => {
    const payload = defaultFormatRulesPayload();
    expect(formatRulesSchema.safeParse(payload).success).toBe(true);
    expect(payload.banned_moves).not.toBe(DEFAULT_BANNED_MOVES);
    expect(payload).not.toHaveProperty('tera_rules');
    expect(payload).not.toHaveProperty('redraft_phase_open');
  });

  it('covers every number field', () => {
    const payload = defaultFormatRulesPayload();
    for (const field of FORMAT_RULES_NUMBER_FIELDS satisfies readonly FormatRulesNumberField[]) {
      const { min, max } = FORMAT_RULES_LIMITS[field];
      expect(payload[field]).toBeGreaterThanOrEqual(min);
      expect(payload[field]).toBeLessThanOrEqual(max);
    }
  });
});
