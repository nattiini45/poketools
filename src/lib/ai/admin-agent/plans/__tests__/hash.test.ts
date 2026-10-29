import { describe, expect, it } from 'vitest';
import { JsonError } from '@/lib/studio-core/json';
import {
  canonicalJson,
  computeArgsHash,
  computePreviewHash,
  computeProposalHash,
  hashJson,
  planCode,
  planDocHash,
  sha256Hex,
  type ArgsHashInput,
} from '../hash';
import { parsePlanDocument } from '../schema';
import { workedExample } from './fixtures';

const args = (over: Partial<ArgsHashInput> = {}): ArgsHashInput => ({
  v: 1,
  op: 'phase_create',
  method: 'POST',
  route_template: '/api/seasons/[id]/phases',
  path_params: { id: { $ref: 'league.id' } },
  query: {},
  body_template: { name: 'Playoffs', best_of_default: 3 },
  admin_id: 'a',
  conversation_id: 'c',
  proposal_id: 'p',
  step_key: 'phase.playoffs',
  ...over,
});

describe('canonical JSON and SHA-256', () => {
  it('sorts keys, drops whitespace and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: [3, 1, 2], c: { z: null, y: 'x' } })).toBe('{"a":[3,1,2],"b":1,"c":{"y":"x","z":null}}');
  });

  it('hashes the same value to the same digest whatever the key order', () => {
    expect(hashJson({ a: 1, b: { c: 2, d: 3 } })).toBe(hashJson({ b: { d: 3, c: 2 }, a: 1 }));
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
    expect(hashJson([1, 2])).not.toBe(hashJson([2, 1]));
  });

  it('is the standard SHA-256', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashJson('abc')).toBe(sha256Hex('"abc"'));
  });

  it('refuses anything that is not plain JSON', () => {
    expect(() => canonicalJson({ a: undefined })).toThrow(JsonError);
    expect(() => canonicalJson(Number.NaN)).toThrow(JsonError);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(JsonError);
    expect(() => canonicalJson(new Date())).toThrow(JsonError);
  });
});

describe('plan hash', () => {
  it('hashes the normalised document, so parsing twice or reordering keys changes nothing', () => {
    const plan = workedExample();
    expect(planDocHash(plan)).toBe(planDocHash(plan));
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (typeof value !== 'object' || value === null) return value;
      return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]));
    };
    const parsed = parsePlanDocument(reverseKeys(plan));
    expect(parsed.ok && planDocHash(parsed.plan)).toBe(planDocHash(plan));
    const changed = parsePlanDocument({ ...plan, title: 'Other' });
    expect(changed.ok && planDocHash(changed.plan)).not.toBe(planDocHash(plan));
  });
});

describe('confirmation protocol hashes (plan 4.5)', () => {
  it('args_hash covers every field, and hashes the $ref template, not a resolved value', () => {
    const base = computeArgsHash(args());
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(computeArgsHash(args())).toBe(base);
    const variants: Array<Partial<ArgsHashInput>> = [
      { v: 2 },
      { op: 'phase_update' },
      { method: 'PATCH' },
      { route_template: '/api/seasons/[id]/phases/[phaseId]' },
      { path_params: { id: 'x' } },
      { query: { dry_run: true } },
      { body_template: { name: 'Finals', best_of_default: 3 } },
      { admin_id: 'b' },
      { conversation_id: 'd' },
      { proposal_id: 'q' },
      { step_key: 'phase.finals' },
    ];
    for (const variant of variants) expect(computeArgsHash(args(variant)), JSON.stringify(variant)).not.toBe(base);
  });

  it('proposal_hash is order-sensitive over steps and order-insensitive over acknowledgements', () => {
    const base = { stepArgsHashes: ['a', 'b'], preconditionsHash: 'p', acksRequired: ['visible_publicly', 'outward_effects'] };
    const hash = computeProposalHash(base);
    expect(computeProposalHash({ ...base, acksRequired: ['outward_effects', 'visible_publicly', 'outward_effects'] })).toBe(hash);
    expect(computeProposalHash({ ...base, stepArgsHashes: ['b', 'a'] })).not.toBe(hash);
    expect(computeProposalHash({ ...base, preconditionsHash: 'q' })).not.toBe(hash);
    expect(computeProposalHash({ ...base, acksRequired: [] })).not.toBe(hash);
  });

  it('preview_hash covers the preview, the outward effects, the targets and the locale', () => {
    const base = { preview: { steps: 4 }, outwardEffects: [], targets: ['league'], locale: 'en' };
    const hash = computePreviewHash(base);
    expect(computePreviewHash({ ...base, preview: { steps: 5 } })).not.toBe(hash);
    expect(computePreviewHash({ ...base, outwardEffects: ['round_generated'] })).not.toBe(hash);
    expect(computePreviewHash({ ...base, targets: [] })).not.toBe(hash);
    expect(computePreviewHash({ ...base, locale: 'de' })).not.toBe(hash);
  });

  it('shows the first eight hex digits as the plan code', () => {
    expect(planCode(sha256Hex('abc'))).toBe('ba7816bf');
  });
});
