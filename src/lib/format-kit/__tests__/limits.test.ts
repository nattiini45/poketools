import { describe, expect, it } from 'vitest';
import * as exprLimits from '../expr/limits';
import { KEY_PATTERN } from '@/lib/studio-core/keys';
import * as limits from '../limits';

describe('document limits', () => {
  it('match the design (any change here is a deliberate, breaking one)', () => {
    expect(limits.DOCUMENT_LIMITS).toEqual({
      maxBodyBytes: 262_144,
      jsonMaxNodes: 150_000,
      jsonMaxDepth: 64,
      maxStages: 50,
      maxEdges: 100,
      maxRules: 200,
      maxTextSections: 32,
      maxViews: 8,
      maxModules: 3,
      maxFacts: 64,
      maxRankSteps: 12,
      maxColumns: 12,
      maxSelects: 4,
      maxOverrides: 32,
      minGroups: 2,
      maxGroups: 26,
      maxLegs: 4,
      maxBestOf: 15,
      minPlayersPerMatch: 2,
      maxPlayersPerMatch: 8,
      maxN: 1024,
      maxNPerGroup: 64,
      maxSwissRounds: 32,
      maxOverrideRound: 64,
      maxExpectedCount: 4096,
      maxViewStages: 50,
      ltextMaxChars: 4000,
      scoreAbsMax: 1000,
    });
  });

  it('a body is 256 KB', () => {
    expect(limits.MAX_BODY_BYTES).toBe(256 * 1024);
  });

  it('the key pattern allows 1..32 characters', () => {
    expect(KEY_PATTERN.source).toBe('^[a-z][a-z0-9_]{0,31}$');
    expect(KEY_PATTERN.test('a'.repeat(32))).toBe(true);
    expect(KEY_PATTERN.test('a'.repeat(33))).toBe(false);
    expect(KEY_PATTERN.test('')).toBe(false);
  });

  it('re-exports the expression limits unchanged', () => {
    const pairs: [keyof typeof exprLimits, number][] = [
      ['EXPR_MAX_DEPTH', 12],
      ['EXPR_MAX_NODES', 200],
      ['EXPR_STEP_BUDGET', 5000],
      ['EXPR_NUM_LIMIT', 1e9],
      ['EXPR_MAX_STRING', 64],
      ['EXPR_MAX_SOURCE_CHARS', 2000],
      ['EXPR_MAX_ARGS', 8],
      ['EXPR_MAX_SET', 32],
      ['EXPR_SCHEMA_MAX_NODES', 256],
      ['EXPR_SCHEMA_MAX_DEPTH', 32],
      ['COLLECTION_ASSUMED_MAX', 256],
    ];
    for (const [name, value] of pairs) {
      expect(exprLimits[name], name).toBe(value);
      expect((limits as Record<string, unknown>)[name], name).toBe(exprLimits[name]);
    }
  });

  it('the limit constants are plain positive integers', () => {
    for (const [name, value] of Object.entries(limits.DOCUMENT_LIMITS)) {
      expect(Number.isInteger(value) && value > 0, name).toBe(true);
    }
  });
});
