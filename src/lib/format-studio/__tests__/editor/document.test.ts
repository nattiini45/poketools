import { describe, expect, it } from 'vitest';
import { KEY_PATTERN, PRESETS } from '@/lib/format-kit/client';
import { ltext, type LText } from '@/lib/studio-core/ltext';
import {
  blankDocument,
  documentSignature,
  editLText,
  newStage,
  normalizeDraft,
  uniqueKey,
} from '../../editor/document';
import { compileDraft } from '../../editor/preview';

const SKELETON = { schema_version: 1, identity: { name: ltext('en', 'Cup night') }, stages: [] };

function normalized(raw: unknown) {
  const result = normalizeDraft(raw);
  if (!result.ok) throw new Error(`expected a showable draft, got ${result.reason}`);
  return result;
}

describe('normalizeDraft', () => {
  it('fills the defaults of the skeleton a new format starts from', () => {
    const { doc, preservedKeys } = normalized(SKELETON);
    expect(preservedKeys).toEqual([]);
    expect(doc).toEqual({
      schema_version: 1,
      identity: { name: ltext('en', 'Cup night') },
      stages: [],
      edges: [],
      views: [],
      rules: [],
      text: { sections: [] },
      theme: { world: 'auto' },
      modules: [],
    });
  });

  it('leaves the summary absent', () => {
    expect(normalized(SKELETON).doc.identity).not.toHaveProperty('summary');
  });

  it.each(PRESETS.map((preset) => [preset.id, preset.definition] as const))('keeps the preset %s as it is', (_id, definition) => {
    const result = normalized(structuredClone(definition));
    expect(result.doc).toEqual(definition);
    expect(result.preservedKeys).toEqual([]);
  });

  it('fills the defaults of every list item', () => {
    const { doc } = normalized({
      schema_version: 1,
      identity: { name: ltext('en', 'x') },
      stages: [
        {
          key: 'a',
          name: ltext('en', 'A'),
          participants: { from: 'roster', seeding: 'rating' },
          groups: { count: 2 },
          pairing: { kind: 'round_robin' },
          series: { best_of: 1, overrides: [{ round: 2, best_of: 3 }] },
          scoring: { win: 3 },
        },
        { key: 'b', name: ltext('en', 'B'), participants: { from: 'edges', seeding: 'edge_order' }, pairing: { kind: 'single_elim' }, series: { best_of: 1 }, scoring: { win: 1 } },
        { key: 'c', name: ltext('en', 'C'), participants: { from: 'edges', seeding: 'edge_order' }, pairing: { kind: 'double_elim' }, series: { best_of: 1 }, scoring: { win: 1 } },
        { key: 'd', name: ltext('en', 'D'), participants: { from: 'edges', seeding: 'edge_order' }, pairing: { kind: 'swiss', rounds: 3 }, series: { best_of: 1 }, scoring: { win: 1 } },
      ],
      edges: [{ key: 'e', from: 'a', to: 'b', select: [{ kind: 'top_n', n: 2 }] }],
      rules: [{ kind: 'rule.custom', id: 'r', text: ltext('en', 'Be nice') }],
      text: { sections: [{ id: 's', title: ltext('en', 'T'), body: ltext('en', 'B') }] },
    });
    const [a, b, c, d] = doc.stages;
    expect(a.ruleset).toEqual({ kind: 'season_default' });
    expect(a.doubles).toBe(false);
    expect(a.players_per_match).toBe(2);
    expect(a.scoring).toEqual({ win: 3, loss: 0, bye: 0 });
    expect(a.rank).toEqual([]);
    expect(a.columns).toEqual([]);
    expect(a.series).toEqual({ best_of: 1, allow_draw: false, overrides: [{ round: 2, from: 'start', best_of: 3 }] });
    expect(a.groups).toEqual({ count: 2, method: 'serpentine' });
    expect(a.pairing).toEqual({ kind: 'round_robin', legs: 1, mirror_legs: true });
    expect(b.pairing).toEqual({ kind: 'single_elim', third_place: false });
    expect(c.pairing).toEqual({ kind: 'double_elim', bracket_reset: false });
    expect(d.pairing).toEqual({ kind: 'swiss', rounds: 3, avoid_repeats: true });
    expect(doc.edges[0]).toMatchObject({ seeding: 'rank', gate: 'admin_confirm' });
    expect(doc.rules[0]).toMatchObject({ scope: { kind: 'season' }, verify: 'admin_checklist', when: 'once', visible_to_players: true });
    expect(doc.theme).toEqual({ world: 'auto' });
  });

  it('keeps an explicit value over a default', () => {
    const { doc } = normalized({ ...SKELETON, theme: { world: 'sakura' }, stages: [] });
    expect(doc.theme.world).toBe('sakura');
  });

  it('keeps members it does not know, and lists the top-level ones', () => {
    const raw = {
      ...SKELETON,
      attributes: [{ key: 'x' }],
      note: 'hello',
      stages: [
        {
          key: 'a',
          name: ltext('en', 'A'),
          participants: { from: 'roster', seeding: 'rating' },
          pairing: { kind: 'manual' },
          series: { best_of: 1 },
          scoring: { win: 1 },
          mystery: 7,
        },
      ],
    };
    const result = normalized(raw);
    expect(result.preservedKeys).toEqual(['attributes', 'note']);
    expect((result.doc as unknown as Record<string, unknown>).note).toBe('hello');
    expect((result.doc.stages[0] as unknown as Record<string, unknown>).mystery).toBe(7);

    const pointers = compileDraft(result.doc).diagnostics.filter((d) => d.code === 'schema_unknown_key').map((d) => d.json_pointer);
    expect(pointers).toContain('/note');
    expect(pointers).toContain('/stages/0/mystery');
  });

  it('does not mutate its input', () => {
    const raw = structuredClone(SKELETON);
    const snapshot = JSON.stringify(raw);
    normalized(raw);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });

  it.each([
    ['an array', []],
    ['null', null],
    ['a string', 'x'],
    ['a number', 7],
  ])('refuses %s as not an object', (_name, raw) => {
    expect(normalizeDraft(raw)).toEqual({ ok: false, reason: 'not_object' });
  });

  const stage = () => ({
    key: 'a',
    name: ltext('en', 'A'),
    participants: { from: 'roster', seeding: 'rating' },
    pairing: { kind: 'manual' },
    series: { best_of: 1 },
    scoring: { win: 1 },
  });
  const withDoc = (extra: Record<string, unknown>) => ({ ...SKELETON, ...extra });

  it.each([
    ['stages that are not a list', withDoc({ stages: {} })],
    ['a stage that is a string', withDoc({ stages: ['a'] })],
    ['a stage without a scoring object', withDoc({ stages: [{ ...stage(), scoring: 3 }] })],
    ['a stage name that is a string', withDoc({ stages: [{ ...stage(), name: 'A' }] })],
    ['rank steps that are not a list', withDoc({ stages: [{ ...stage(), rank: 'points' }] })],
    ['an override that is not an object', withDoc({ stages: [{ ...stage(), series: { best_of: 1, overrides: [3] } }] })],
    ['edges that are not a list', withDoc({ edges: 'none' })],
    ['an edge that is null', withDoc({ edges: [null] })],
    ['an edge without a selection list', withDoc({ edges: [{ key: 'e', from: 'a', to: 'b' }] })],
    ['rules that are not a list', withDoc({ rules: {} })],
    ['a rule whose text is a string', withDoc({ rules: [{ kind: 'rule.custom', id: 'r', text: 'x' }] })],
    ['views that are not a list', withDoc({ views: 3 })],
    ['a view without a stage list', withDoc({ views: [{ key: 'v' }] })],
    ['modules that are not a list', withDoc({ modules: {} })],
    ['text sections that are not a list', withDoc({ text: { sections: {} } })],
    ['a text section without a body object', withDoc({ text: { sections: [{ id: 's', title: ltext('en', 'T'), body: 'b' }] } })],
    ['text that is not an object', withDoc({ text: [] })],
    ['a theme that is not an object', withDoc({ theme: 'sakura' })],
    ['a missing identity', { schema_version: 1, stages: [] }],
    ['an identity that is a string', withDoc({ identity: 'x' })],
    ['an identity name that is a string', withDoc({ identity: { name: 'x' } })],
    ['a summary that is a string', withDoc({ identity: { name: ltext('en', 'x'), summary: 'x' } })],
  ])('refuses %s as a bad shape', (_name, raw) => {
    expect(normalizeDraft(raw)).toEqual({ ok: false, reason: 'shape' });
  });

  it('accepts values of the wrong type inside a showable shape (the Issues tab flags them)', () => {
    const result = normalized(withDoc({ stages: [{ ...stage(), key: 5, scoring: { win: 'many' } }] }));
    const codes = compileDraft(result.doc).diagnostics.map((d) => d.code);
    expect(codes).toContain('schema_type');
  });

  it('is idempotent', () => {
    const corpus: unknown[] = [SKELETON, ...PRESETS.map((p) => p.definition), withDoc({ attributes: [], stages: [stage()] })];
    for (const raw of corpus) {
      const first = normalized(raw);
      const second = normalized(first.doc);
      expect(second.doc).toEqual(first.doc);
      expect(second.preservedKeys).toEqual(first.preservedKeys);
    }
  });

  it('keeps an own __proto__ key as data and does not touch the prototype', () => {
    const raw = JSON.parse(
      '{"schema_version":1,"identity":{"name":{"base":"en","en":{"v":"x","s":"human"}}},"stages":[],"__proto__":{"polluted":true}}',
    ) as unknown;
    const result = normalized(raw);
    expect(result.preservedKeys).toContain('__proto__');
    expect(Object.prototype.hasOwnProperty.call(result.doc, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result.doc)).toBe(Object.prototype);
  });

  it('adds a missing schema version', () => {
    expect(normalized({ identity: SKELETON.identity, stages: [] }).doc.schema_version).toBe(1);
  });
});

describe('blankDocument', () => {
  it.each(['en', 'de'] as const)('compiles without an error and is written in %s', (base) => {
    const doc = blankDocument('My format', base);
    expect(doc.identity.name.base).toBe(base);
    expect(doc.identity.name[base]?.v).toBe('My format');
    expect(doc.stages).toHaveLength(1);
    expect(doc.stages[0].key).toBe('stage_1');
    expect(doc.stages[0].name[base]?.v).toBe(base === 'en' ? 'Stage 1' : 'Phase 1');
    const result = compileDraft(doc);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('normalises to itself', () => {
    const doc = blankDocument('x', 'en');
    expect(normalized(doc).doc).toEqual(doc);
  });

  it('newStage builds the documented default stage', () => {
    expect(newStage('k', ltext('en', 'K'))).toMatchObject({
      key: 'k',
      participants: { from: 'roster', seeding: 'rating' },
      pairing: { kind: 'round_robin', legs: 1, mirror_legs: true },
      series: { best_of: 1, allow_draw: false, overrides: [] },
      ruleset: { kind: 'season_default' },
      scoring: { win: 3, loss: 0, bye: 0 },
      rank: [{ kind: 'metric', metric: 'points', direction: 'desc' }],
    });
  });
});

describe('documentSignature', () => {
  it('ignores key order', () => {
    expect(documentSignature({ a: 1, b: { c: 2, d: 3 } })).toBe(documentSignature({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('changes with a value', () => {
    expect(documentSignature({ a: 1 })).not.toBe(documentSignature({ a: 2 }));
  });

  it('does not throw for a value that is not JSON, and never equals a JSON signature', () => {
    const bad = documentSignature({ a: undefined });
    expect(bad.startsWith('!')).toBe(true);
    expect(bad).not.toBe(documentSignature({}));
  });
});

describe('uniqueKey', () => {
  it('returns the base when it is free', () => {
    expect(uniqueKey([], 'stage')).toBe('stage');
    expect(uniqueKey(['other'], 'stage')).toBe('stage');
  });

  it('counts up from _2', () => {
    expect(uniqueKey(['stage'], 'stage')).toBe('stage_2');
    expect(uniqueKey(['stage', 'stage_2', 'stage_3'], 'stage')).toBe('stage_4');
  });

  it('never exceeds 32 characters and always matches the key pattern', () => {
    const long = 'a'.repeat(40);
    const taken = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      const key = uniqueKey(taken, long);
      expect(key.length).toBeLessThanOrEqual(32);
      expect(KEY_PATTERN.test(key)).toBe(true);
      expect(taken.has(key)).toBe(false);
      taken.add(key);
    }
  });

  it('turns text into a key', () => {
    expect(uniqueKey([], 'Group Stage!')).toBe('group_stage_');
    expect(KEY_PATTERN.test(uniqueKey([], '1st round'))).toBe(true);
    expect(KEY_PATTERN.test(uniqueKey([], '_x'))).toBe(true);
    expect(KEY_PATTERN.test(uniqueKey([], ''))).toBe(true);
    expect(KEY_PATTERN.test(uniqueKey([], '__proto__'))).toBe(true);
    expect(uniqueKey([], '__proto__')).not.toBe('__proto__');
  });

  it('ignores values that are not strings', () => {
    expect(uniqueKey([5 as unknown as string, undefined as unknown as string], 'a')).toBe('a');
  });
});

describe('editLText', () => {
  const en = (v: string) => ({ v, s: 'human' as const });
  const both: LText = { base: 'en', en: en('Hello'), de: en('Hallo') };

  it('sets a language to a human value', () => {
    expect(editLText({ base: 'en', en: { v: 'old', s: 'machine' } }, 'en', 'new', 'en')).toEqual({ base: 'en', en: en('new') });
  });

  it('adds a second language', () => {
    expect(editLText({ base: 'en', en: en('Hello') }, 'de', 'Hallo', 'en')).toEqual(both);
  });

  it('keeps the base and other members when editing', () => {
    const result = editLText(both, 'de', 'Servus', 'en');
    expect(result).toEqual({ base: 'en', en: en('Hello'), de: en('Servus') });
  });

  it('deletes a non-base language when it is emptied', () => {
    expect(editLText(both, 'de', '', 'en')).toEqual({ base: 'en', en: en('Hello') });
  });

  it('keeps an empty base language when it is the only one, so the field is flagged', () => {
    expect(editLText({ base: 'en', en: en('Hello') }, 'en', '', 'en')).toEqual({ base: 'en', en: en('') });
  });

  it('moves the base to the other language when the base is emptied', () => {
    expect(editLText(both, 'en', '', 'en')).toEqual({ base: 'de', de: en('Hallo') });
  });

  it('does not move the base to a language without text', () => {
    expect(editLText({ base: 'en', en: en('Hello'), de: en('') }, 'en', '', 'en')).toEqual({ base: 'en', en: en(''), de: en('') });
  });

  it('creates a text from nothing with the edited language as the base', () => {
    expect(editLText(undefined, 'de', 'Hallo', 'en')).toEqual({ base: 'de', de: en('Hallo') });
  });

  it('leaves an absent text absent when the value is empty', () => {
    expect(editLText(undefined, 'en', '', 'en')).toBeUndefined();
  });

  it('gives a text without a valid base the author base', () => {
    const broken = { en: en('x') } as unknown as LText;
    expect(editLText(broken, 'de', 'y', 'de')).toMatchObject({ base: 'de', en: en('x'), de: en('y') });
  });

  it('never mutates its input', () => {
    const input = Object.freeze({ base: 'en', en: Object.freeze(en('Hello')), de: Object.freeze(en('Hallo')) }) as LText;
    expect(() => editLText(input, 'en', '', 'en')).not.toThrow();
    expect(input.base).toBe('en');
  });
});
