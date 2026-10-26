import { describe, expect, it } from 'vitest';
import { createTranslator } from '@/i18n/core';
import { formatStudioMessages } from '@/i18n/messages/format-studio';
import { formatStudioPrimitivesMessages } from '@/i18n/messages/format-studio/primitives';
import { DIAGNOSTIC_CODES, FIX_IDS, manifestForSlot, specOf, type Spec } from '@/lib/format-kit/client';
import {
  EDGE_GATES,
  EDGE_SEEDINGS,
  GROUP_METHODS,
  HEAD_TO_HEAD_SCOPES,
  METRIC_KEYS,
  OVERRIDE_FROM,
  PAIRING_KINDS,
  PARTICIPANT_SOURCES,
  RANK_DIRECTIONS,
  RANK_STEP_KINDS,
  RULE_VERIFY_MODES,
  RULE_WHEN,
  SEEDING_EDGES,
  SEEDING_ROSTER,
  SELECT_KINDS_EDITABLE,
} from '../../editor/catalog';

const LOCALES = ['en', 'de'] as const;

/** Every option list with the primitives key each of its values is labelled by. */
const LISTS: ReadonlyArray<[string, readonly string[], (value: string) => string]> = [
  ['METRIC_KEYS', METRIC_KEYS, (v) => `metric.${v}`],
  ['PAIRING_KINDS', PAIRING_KINDS, (v) => `label.pairing_${v}`],
  ['SEEDING_ROSTER', SEEDING_ROSTER, (v) => `option.seeding_${v}`],
  ['SEEDING_EDGES', SEEDING_EDGES, (v) => `option.seeding_${v}`],
  ['GROUP_METHODS', GROUP_METHODS, (v) => `option.method_${v}`],
  ['EDGE_SEEDINGS', EDGE_SEEDINGS, (v) => `option.seeding_${v}`],
  ['EDGE_GATES', EDGE_GATES, (v) => `option.gate_${v}`],
  ['RULE_VERIFY_MODES', RULE_VERIFY_MODES, (v) => `option.verify_${v}`],
  ['RULE_WHEN', RULE_WHEN, (v) => `option.when_${v}`],
  ['SELECT_KINDS_EDITABLE', SELECT_KINDS_EDITABLE, (v) => `label.advance_${v}`],
  ['RANK_STEP_KINDS', RANK_STEP_KINDS, (v) => `label.rank_${v}`],
  ['RANK_DIRECTIONS', RANK_DIRECTIONS, (v) => `option.direction_${v}`],
  ['HEAD_TO_HEAD_SCOPES', HEAD_TO_HEAD_SCOPES, (v) => `option.scope_${v}`],
  ['OVERRIDE_FROM', OVERRIDE_FROM, (v) => `option.from_${v}`],
  ['PARTICIPANT_SOURCES', PARTICIPANT_SOURCES, (v) => `option.from_${v}`],
];

function field(spec: Spec, name: string): Spec {
  if (spec.t !== 'obj') throw new Error(`not an object spec while looking for ${name}`);
  const found = spec.fields.find((f) => f.name === name);
  if (!found) throw new Error(`no field ${name}`);
  return found.spec;
}

function variant(spec: Spec, tag: string): Spec {
  if (spec.t !== 'union') throw new Error('not a union spec');
  const found = spec.variants.find((v) => v.tag === tag);
  if (!found) throw new Error(`no variant ${tag}`);
  return found.spec;
}

function enumOf(spec: Spec): string[] {
  if (spec.t !== 'enum') throw new Error('not an enum spec');
  return spec.values.map(String);
}

const tags = (slot: Parameters<typeof manifestForSlot>[0]): string[] => manifestForSlot(slot).flatMap((entry) => (entry.tag === null ? [] : [entry.tag]));

describe('option lists', () => {
  it.each(LISTS)('%s is not empty and has no repeats', (_name, values) => {
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
  });

  describe.each(LOCALES)('labels in %s', (locale) => {
    const t = createTranslator(formatStudioPrimitivesMessages, locale);

    it.each(LISTS)('%s: every value has a label', (_name, values, keyOf) => {
      for (const value of values) {
        const key = keyOf(value);
        expect(t.has(key), key).toBe(true);
        expect(t.dynamic(key).trim(), key).not.toBe('');
      }
    });
  });
});

describe('option lists match the manifest', () => {
  const stage = specOf('stage.define');
  const edge = specOf('advance.rule');

  it('metrics are the eight builtin ones', () => {
    expect(METRIC_KEYS).toHaveLength(8);
  });

  it('pairing kinds', () => {
    expect([...PAIRING_KINDS].sort()).toEqual(tags('pairing').sort());
    expect([...PAIRING_KINDS].sort()).toEqual(enumOfUnionTags(field(stage, 'pairing')));
  });

  it('seeding of a stage fed by the roster or by edges', () => {
    const participants = field(stage, 'participants');
    expect([...SEEDING_ROSTER].sort()).toEqual(enumOf(field(variant(participants, 'roster'), 'seeding')).sort());
    expect([...SEEDING_EDGES].sort()).toEqual(enumOf(field(variant(participants, 'edges'), 'seeding')).sort());
    expect([...PARTICIPANT_SOURCES].sort()).toEqual(enumOfUnionTags(participants));
  });

  it('group methods', () => {
    expect([...GROUP_METHODS].sort()).toEqual(enumOf(field(specOf('group.form'), 'method')).sort());
  });

  it('edge seeding and gate', () => {
    expect([...EDGE_SEEDINGS].sort()).toEqual(enumOf(field(edge, 'seeding')).sort());
    expect([...EDGE_GATES].sort()).toEqual(enumOf(field(edge, 'gate')).sort());
  });

  it('rule verification and timing', () => {
    const rule = specOf('rule.custom');
    expect([...RULE_VERIFY_MODES].sort()).toEqual(enumOf(field(rule, 'verify')).sort());
    expect([...RULE_WHEN].sort()).toEqual(enumOf(field(rule, 'when')).sort());
  });

  it('selection kinds the form edits are every kind but the threshold', () => {
    expect([...SELECT_KINDS_EDITABLE].sort()).toEqual(tags('advance').filter((tag) => tag !== 'threshold').sort());
  });

  it('rank step kinds, directions and scopes', () => {
    expect([...RANK_STEP_KINDS].sort()).toEqual(tags('rank').sort());
    const rank = field(stage, 'rank');
    if (rank.t !== 'arr') throw new Error('rank is not a list');
    expect([...RANK_DIRECTIONS].sort()).toEqual(enumOf(field(variant(rank.item, 'metric'), 'direction')).sort());
    expect([...HEAD_TO_HEAD_SCOPES].sort()).toEqual(enumOf(field(specOf('rank.head_to_head'), 'scope')).sort());
  });

  it('where an override counts from', () => {
    const overrides = field(field(stage, 'series'), 'overrides');
    if (overrides.t !== 'arr') throw new Error('overrides is not a list');
    expect([...OVERRIDE_FROM].sort()).toEqual(enumOf(field(overrides.item, 'from')).sort());
  });
});

function enumOfUnionTags(spec: Spec): string[] {
  if (spec.t !== 'union') throw new Error('not a union');
  return spec.variants.map((v) => v.tag).sort();
}

describe('compiler texts', () => {
  describe.each(LOCALES)('in %s', (locale) => {
    const t = createTranslator(formatStudioMessages, locale);

    it('every fix id has a label', () => {
      for (const id of FIX_IDS) {
        expect(t.has(`fixes.${id}`), id).toBe(true);
      }
    });

    it('every diagnostic code has a sentence', () => {
      for (const code of DIAGNOSTIC_CODES) {
        expect(t.has(`diagnostics.${code}`), code).toBe(true);
      }
    });

    it('has the severity words', () => {
      for (const severity of ['error', 'warning', 'info']) expect(t.has(`severity.${severity}`), severity).toBe(true);
    });
  });
});
