import { describe, expect, it } from 'vitest';
import {
  bestOfSchema,
  manualRoundSchema,
  phaseCreateSchema,
  phaseUpdateSchema,
  roundUpdateSchema,
  tournamentCreateSchema,
  tournamentUpdateSchema,
} from '..';

const RULESET = '00000000-0000-4000-8000-000000000002';
const PAIRING = {
  player_1_id: '00000000-0000-4000-8000-000000000011',
  player_2_id: '00000000-0000-4000-8000-000000000012',
};

const VALID = [1, 3, 15];
const INVALID = [0, 2, 4, 16];

// One entry per schema that takes a best-of: how to put `value` into a payload.
const cases: Array<[string, (value: number) => { success: boolean }]> = [
  [
    'tournamentCreateSchema.best_of_default',
    (v) => tournamentCreateSchema.safeParse({ name: 'T', bracket_type: 'swiss', ruleset_id: RULESET, best_of_default: v }),
  ],
  [
    'tournamentCreateSchema.bo_overrides',
    (v) => tournamentCreateSchema.safeParse({ name: 'T', bracket_type: 'swiss', ruleset_id: RULESET, bo_overrides: { '3': v } }),
  ],
  ['tournamentUpdateSchema.best_of_default', (v) => tournamentUpdateSchema.safeParse({ best_of_default: v })],
  ['tournamentUpdateSchema.bo_overrides', (v) => tournamentUpdateSchema.safeParse({ bo_overrides: { '2': v } })],
  [
    'phaseCreateSchema.best_of_default',
    (v) => phaseCreateSchema.safeParse({ name: 'P', bracket_type: 'swiss', ruleset_id: RULESET, best_of_default: v }),
  ],
  ['roundUpdateSchema.best_of', (v) => roundUpdateSchema.safeParse({ best_of: v })],
  ['manualRoundSchema.best_of', (v) => manualRoundSchema.safeParse({ best_of: v, pairings: [PAIRING] })],
];

describe('bestOfSchema', () => {
  it.each(VALID)('accepts %s', (value) => {
    expect(bestOfSchema.safeParse(value).success).toBe(true);
  });

  it.each([...INVALID, 1.5, -1])('rejects %s', (value) => {
    expect(bestOfSchema.safeParse(value).success).toBe(false);
  });

  it('names the odd rule for an even value', () => {
    const result = bestOfSchema.safeParse(4);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe('best of must be an odd number');
  });
});

describe.each(cases)('%s', (_name, parse) => {
  it.each(VALID)('accepts %s', (value) => {
    expect(parse(value).success).toBe(true);
  });

  it.each(INVALID)('rejects %s', (value) => {
    expect(parse(value).success).toBe(false);
  });
});

// A phase update tolerates a stored even value (the form sends the record back); the route
// refuses an even value the phase does not hold (phases/[phaseId]/__tests__/patch.test.ts).
describe('phaseUpdateSchema best-of', () => {
  it.each([1, 2, 4, 15])('parses %s', (value) => {
    expect(phaseUpdateSchema.safeParse({ best_of_default: value, bo_overrides: { '1': value } }).success).toBe(true);
  });

  it.each([0, 16, 1.5, -1])('rejects %s', (value) => {
    expect(phaseUpdateSchema.safeParse({ best_of_default: value }).success).toBe(false);
    expect(phaseUpdateSchema.safeParse({ bo_overrides: { '1': value } }).success).toBe(false);
  });
});

describe('tournamentCreateSchema best_of_default default', () => {
  it('still defaults to 1', () => {
    const result = tournamentCreateSchema.parse({ name: 'T', bracket_type: 'swiss', ruleset_id: RULESET });
    expect(result.best_of_default).toBe(1);
  });
});
