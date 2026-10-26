import { describe, expect, it } from 'vitest';
import { MAX_ISSUES, type SchemaIssue } from '../issues';
import { canonicalizeJson } from '../json';
import { RESERVED_PAIRING_TAGS } from '../registry/manifest';
import type { Spec } from '../registry/spec';
import {
  classifyRuleEntry,
  cloneJson,
  createSpecOut,
  precheckInput,
  prepareDocument,
  validateSpec,
} from '../registry/validate-spec';
import { lt, minimalDoc } from './fixtures/docs';
import { setAt } from './fixtures/invalid';

function run(spec: Spec, value: unknown, pointer = ''): { value: unknown; issues: SchemaIssue[]; notes: ReturnType<typeof createSpecOut>['notes'] } {
  const out = createSpecOut();
  const result = validateSpec(spec, value, pointer, out);
  return { value: result, issues: out.issues, notes: out.notes };
}
const summary = (issues: SchemaIssue[]) => issues.map((i) => `${i.code} ${i.pointer}`);

const STR: Spec = { t: 'str', min: 1, max: 3, pattern: 'key' };
const OBJ: Spec = {
  t: 'obj',
  fields: [
    { name: 'a', spec: { t: 'int', min: 1, max: 5 } },
    { name: 'b', spec: { t: 'bool' }, default: false },
    { name: 'c', spec: { t: 'str', min: 0, max: 10 }, optional: true },
  ],
};

describe('scalar specs', () => {
  it('bool', () => {
    expect(run({ t: 'bool' }, true).value).toBe(true);
    expect(run({ t: 'bool' }, false).issues).toEqual([]);
    expect(run({ t: 'bool' }, 1).issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'boolean' } }]);
    expect(run({ t: 'bool' }, 'true').issues).toHaveLength(1);
  });

  it('int: type, integer-ness and range', () => {
    const spec: Spec = { t: 'int', min: 1, max: 5 };
    expect(run(spec, 3).value).toBe(3);
    expect(run(spec, 1).issues).toEqual([]);
    expect(run(spec, 5).issues).toEqual([]);
    expect(run(spec, 0).issues).toEqual([{ code: 'range', pointer: '', params: {} }]);
    expect(run(spec, 6).issues[0].code).toBe('range');
    expect(run(spec, 2.5).issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'integer' } }]);
    expect(run(spec, 99.5).issues.map((i) => i.code)).toEqual(['type']);
    expect(run(spec, '3').issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'number' } }]);
    expect(run(spec, 1e300).issues.map((i) => i.code)).toEqual(['range']);
    expect(run(spec, null).issues[0].code).toBe('type');
  });

  it('num: range only', () => {
    const spec: Spec = { t: 'num', min: -1, max: 1 };
    expect(run(spec, 0.5).value).toBe(0.5);
    expect(run(spec, -1.5).issues[0].code).toBe('range');
    expect(run(spec, '0').issues[0].code).toBe('type');
  });

  it('str: length and pattern are both reported', () => {
    expect(run(STR, 'abc').value).toBe('abc');
    expect(run(STR, '').issues.map((i) => i.code)).toEqual(['length', 'pattern']);
    expect(run(STR, 'abcd').issues.map((i) => i.code)).toEqual(['length']);
    expect(run(STR, 'ABC').issues.map((i) => i.code)).toEqual(['pattern']);
    expect(run(STR, 5).issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'string' } }]);
    expect(run(STR, []).issues.map((i) => i.code)).toEqual(['type']);
  });

  it('str: every named pattern', () => {
    const named = (pattern: 'key' | 'slug' | 'uuid' | 'kind' | 'text'): Spec => ({ t: 'str', min: 0, max: 100, pattern });
    expect(run(named('key'), 'a_b1').issues).toEqual([]);
    expect(run(named('key'), '1a').issues).toHaveLength(1);
    expect(run(named('key'), '__proto__').issues).toHaveLength(1);
    expect(run(named('slug'), 'a-b-1').issues).toEqual([]);
    expect(run(named('slug'), 'A').issues).toHaveLength(1);
    expect(run(named('uuid'), '123e4567-e89b-42d3-a456-426614174000').issues).toEqual([]);
    expect(run(named('uuid'), 'nope').issues).toHaveLength(1);
    expect(run(named('kind'), 'rule.custom').issues).toEqual([]);
    expect(run(named('kind'), 'Rule').issues).toHaveLength(1);
    expect(run(named('text'), 'anything goes').issues).toEqual([]);
    expect(run(named('text'), 'a\u0000b').issues).toHaveLength(1);
  });

  it('enum: strict equality, any other value is an enum issue', () => {
    const spec: Spec = { t: 'enum', values: ['a', 'b', 1] };
    expect(run(spec, 'a').value).toBe('a');
    expect(run(spec, 1).issues).toEqual([]);
    for (const bad of ['c', '1', 2, null, true, [], {}, 'constructor']) {
      expect(run(spec, bad).issues, JSON.stringify(bad)).toEqual([{ code: 'enum', pointer: '', params: {} }]);
    }
  });
});

describe('ltext spec', () => {
  const spec: Spec = { t: 'ltext' };
  it('accepts a text and returns a fresh object', () => {
    const input = lt('Hello', 'Hallo');
    const result = run(spec, input);
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual(input);
    expect(result.value).not.toBe(input);
  });
  it('requires the base language text, with a refine issue', () => {
    expect(run(spec, { base: 'de', en: { v: 'x', s: 'human' } }).issues).toEqual([
      { code: 'refine', pointer: '', params: { rule: 'ltext_base_present' } },
    ]);
  });
  it('reports type, required, enum, unknown key and length problems', () => {
    expect(summary(run(spec, 5).issues)).toEqual(['type ']);
    expect(summary(run(spec, {}).issues)).toEqual(['required /base']);
    expect(summary(run(spec, { base: 'fr' }).issues)).toEqual(['enum /base']);
    expect(summary(run(spec, { base: 'en', en: { v: 'x' } }).issues)).toEqual(['required /en/s']);
    expect(summary(run(spec, { base: 'en', en: { v: 'x', s: 'human', z: 1 } }).issues)).toEqual(['unknown_key /en/z']);
    expect(summary(run(spec, { base: 'en', en: { v: '', s: 'human' } }).issues)).toEqual(['length /en/v']);
    expect(summary(run(spec, { base: 'en', en: 'x' }).issues)).toEqual(['type /en']);
  });
  it('does not run the refine when a field is broken, but does after a mere length problem', () => {
    expect(summary(run(spec, { base: 'de', en: { v: 5, s: 'human' } }).issues)).toEqual(['type /en/v']);
    expect(summary(run(spec, { base: 'de', en: { v: 'x'.repeat(4001), s: 'human' } }).issues)).toEqual(['length /en/v', 'refine ']);
  });
});

describe('obj spec', () => {
  it('builds a fresh object from spec keys and applies defaults', () => {
    const input = { a: 2 };
    const result = run(OBJ, input);
    expect(result.value).toEqual({ a: 2, b: false });
    expect(result.value).not.toBe(input);
  });

  it('reports required, nested issues and unknown keys once each', () => {
    expect(summary(run(OBJ, {}).issues)).toEqual(['required /a']);
    expect(summary(run(OBJ, { a: 9, zz: 1, yy: 2 }).issues)).toEqual(['range /a', 'unknown_key /zz', 'unknown_key /yy']);
    expect(summary(run(OBJ, [], '/x').issues)).toEqual(['type /x']);
    expect(summary(run(OBJ, null).issues)).toEqual(['type ']);
  });

  it('escapes the key of an unknown key in the pointer', () => {
    expect(summary(run(OBJ, { a: 1, 'k/e~y': 1 }).issues)).toEqual(['unknown_key /k~1e~0y']);
  });

  it('reserved fields are not_available_yet, not unknown keys', () => {
    const spec: Spec = { t: 'obj', fields: [], reserved: ['later'] };
    const result = run(spec, { later: { anything: 1 }, other: 1 });
    expect(result.issues).toEqual([
      { code: 'not_available_yet', pointer: '/later', params: { what: 'later' } },
      { code: 'unknown_key', pointer: '/other', params: {} },
    ]);
  });

  it('defaults are deep-cloned: mutating one result does not change another', () => {
    const spec: Spec = {
      t: 'obj',
      fields: [{ name: 'list', spec: { t: 'arr', item: { t: 'int', min: 0, max: 9 }, min: 0, max: 9 }, default: [1, 2] }],
    };
    const a = run(spec, {}).value as { list: number[] };
    const b = run(spec, {}).value as { list: number[] };
    a.list.push(3);
    expect(b.list).toEqual([1, 2]);
    expect((spec as unknown as { fields: { default: number[] }[] }).fields[0].default).toEqual([1, 2]);
  });

  it('output keys come from the spec: hostile input keys never reach it', () => {
    const hostile = JSON.parse('{"a":1,"__proto__":{"polluted":true},"constructor":{"x":1},"toString":2}') as unknown;
    const result = run(OBJ, hostile);
    expect(Object.keys(result.value as object).sort()).toEqual(['a', 'b']);
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(summary(result.issues).sort()).toEqual(['unknown_key /__proto__', 'unknown_key /constructor', 'unknown_key /toString'].sort());

    const lenient: Spec = { t: 'obj', fields: [{ name: 'a', spec: { t: 'int', min: 0, max: 9 } }] };
    const clean = run(lenient, { a: 1 });
    expect(Object.keys(clean.value as object)).toEqual(['a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('a field named like a prototype member is only read as an own property', () => {
    const spec: Spec = { t: 'obj', fields: [{ name: 'constructor', spec: { t: 'int', min: 0, max: 9 } }] };
    expect(summary(run(spec, {}).issues)).toEqual(['required /constructor']);
    expect(run(spec, { constructor: 3 }).value).toEqual({ constructor: 3 });
  });

  it('a 5000-key object stays cheap and reports at most MAX_ISSUES unknown keys', () => {
    const big: Record<string, unknown> = { a: 1 };
    for (let i = 0; i < 5000; i += 1) big[`k${i}`] = i;
    const first = run(OBJ, big);
    expect(first.issues).toHaveLength(MAX_ISSUES);
    expect(first.issues.every((i) => i.code === 'unknown_key')).toBe(true);
    const started = process.hrtime.bigint();
    for (let i = 0; i < 50; i += 1) run(OBJ, big);
    expect(Number(process.hrtime.bigint() - started) / 1e6).toBeLessThan(200);
  });
});

describe('arr spec', () => {
  const spec: Spec = { t: 'arr', item: { t: 'int', min: 0, max: 9 }, min: 1, max: 3 };
  it('validates items with their index in the pointer', () => {
    expect(run(spec, [1, 2]).value).toEqual([1, 2]);
    expect(summary(run(spec, [1, 'x', 20], '/list').issues)).toEqual(['type /list/1', 'range /list/2']);
  });
  it('checks the length even when an item failed', () => {
    expect(summary(run(spec, []).issues)).toEqual(['length ']);
    expect(summary(run(spec, [1, 2, 3, 'x']).issues)).toEqual(['type /3', 'length ']);
  });
  it('rejects a non-array', () => {
    expect(run(spec, 'abc').issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'array' } }]);
    expect(run(spec, {}).issues[0].code).toBe('type');
  });
});

describe('union spec', () => {
  const spec: Spec = {
    t: 'union',
    tag: 'kind',
    variants: [
      { tag: 'a', spec: { t: 'obj', fields: [{ name: 'kind', spec: { t: 'enum', values: ['a'] } }, { name: 'n', spec: { t: 'int', min: 0, max: 9 }, default: 1 }] } },
      { tag: 'b', spec: { t: 'obj', fields: [{ name: 'kind', spec: { t: 'enum', values: ['b'] } }] } },
    ],
    reservedTags: ['later'],
  };

  it('picks the variant by tag and applies its defaults', () => {
    expect(run(spec, { kind: 'a' }).value).toEqual({ kind: 'a', n: 1 });
    expect(run(spec, { kind: 'b' }).value).toEqual({ kind: 'b' });
  });
  it('an unknown tag is enum, an absent tag is required, a non-object is a type issue', () => {
    expect(run(spec, { kind: 'c' }).issues).toEqual([{ code: 'enum', pointer: '/kind', params: {} }]);
    expect(run(spec, { kind: 5 }).issues[0].code).toBe('enum');
    expect(run(spec, { kind: 'constructor' }).issues[0].code).toBe('enum');
    expect(run(spec, {}).issues).toEqual([{ code: 'required', pointer: '/kind', params: {} }]);
    expect(run(spec, 'a').issues).toEqual([{ code: 'type', pointer: '', params: { expected: 'object' } }]);
    expect(run(spec, [{ kind: 'a' }]).issues[0].code).toBe('type');
  });
  it('a reserved tag is not_available_yet and nothing else', () => {
    expect(run(spec, { kind: 'later', junk: [1] }, '/u').issues).toEqual([
      { code: 'not_available_yet', pointer: '/u', params: { what: 'later' } },
    ]);
  });
  it('variant issues carry the variant pointer, unknown keys included', () => {
    expect(summary(run(spec, { kind: 'a', n: 12, extra: 1 }).issues)).toEqual(['range /n', 'unknown_key /extra']);
  });
});

describe('union spec in degrade_rule mode', () => {
  const rules: Spec = {
    t: 'union',
    tag: 'kind',
    variants: [
      {
        tag: 'rule.custom',
        spec: {
          t: 'obj',
          fields: [
            { name: 'kind', spec: { t: 'enum', values: ['rule.custom'] } },
            { name: 'id', spec: { t: 'str', min: 0, max: 99, pattern: 'key' } },
            { name: 'text', spec: { t: 'ltext' } },
            { name: 'degraded_from', spec: { t: 'str', min: 0, max: 99, pattern: 'kind' }, optional: true },
          ],
        },
      },
    ],
    reservedTags: ['rule.on_event'],
    unknown: 'degrade_rule',
  };

  it('degrades an unknown kind to the known card and notes it', () => {
    const result = run(rules, { kind: 'rule.future', id: 'x', other: 1 }, '/rules/4');
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual({
      kind: 'rule.custom',
      id: 'x',
      text: { base: 'en', en: { v: 'rule.future', s: 'machine' } },
      degraded_from: 'rule.future',
    });
    expect(result.notes).toEqual([{ code: 'unknown_primitive', pointer: '/rules/4', params: { kind: 'rule.future' } }]);
  });

  it('keeps a known kind as is, with no note', () => {
    const result = run(rules, { kind: 'rule.custom', id: 'x', text: lt('T') });
    expect(result.issues).toEqual([]);
    expect(result.notes).toEqual([]);
  });

  it('reports reserved, malformed and missing kinds', () => {
    expect(run(rules, { kind: 'rule.on_event' }, '/r').issues).toEqual([{ code: 'not_available_yet', pointer: '/r', params: { what: 'rule.on_event' } }]);
    expect(summary(run(rules, { kind: 'Not Valid' }, '/r').issues)).toEqual(['pattern /r/kind']);
    expect(summary(run(rules, { kind: 4 }, '/r').issues)).toEqual(['type /r/kind']);
    expect(summary(run(rules, {}, '/r').issues)).toEqual(['required /r/kind']);
    expect(summary(run(rules, { kind: 'rule.future' }, '/r').issues)).toEqual(['required /r/id']);
  });
});

describe('oneof spec', () => {
  const spec: Spec = { t: 'oneof', options: [{ t: 'int', min: 1, max: 5 }, { t: 'enum', values: ['auto'] }] };
  it('accepts the first matching option', () => {
    expect(run(spec, 3).value).toBe(3);
    expect(run(spec, 'auto').value).toBe('auto');
  });
  it('reports the issue of the one option that recognised the type', () => {
    expect(run(spec, 6).issues).toEqual([{ code: 'range', pointer: '', params: {} }]);
  });
  it('otherwise one type issue', () => {
    for (const bad of ['many', 2.5, null, {}, [], true]) {
      expect(run(spec, bad).issues, JSON.stringify(bad)).toEqual([{ code: 'type', pointer: '', params: { expected: 'union' } }]);
    }
  });
});

describe('expr spec', () => {
  const spec: Spec = { t: 'expr', type: 'boolean' };
  const expr = { k: 'cmp', op: '>=', a: { k: 'ref', name: 'points', t: 'number' }, b: { k: 'num', v: 3 } };
  it('accepts a valid expression and returns a copy', () => {
    const result = run(spec, expr, '/when');
    expect(result.issues).toEqual([]);
    expect(result.value).toEqual(expr);
    expect(result.value).not.toBe(expr);
  });
  it('prefixes the expression issue pointers with the slot', () => {
    expect(summary(run(spec, { k: 'cmp', op: '??', a: expr.a, b: expr.b }, '/when').issues)).toEqual(['enum /when/op']);
    expect(summary(run(spec, 7, '/when').issues)).toEqual(['type /when']);
  });
});

describe('cloneJson', () => {
  it('copies deeply and keeps an own __proto__ key as data', () => {
    const source = JSON.parse('{"a":[1,{"b":2}],"__proto__":{"x":1}}') as Record<string, unknown>;
    const copy = cloneJson(source);
    expect(canonicalizeJson(copy)).toBe(canonicalizeJson(source));
    expect(copy).not.toBe(source);
    expect((copy.a as unknown[])[1]).not.toBe((source.a as unknown[])[1]);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.keys(copy)).toContain('__proto__');
  });
});

describe('precheckInput', () => {
  it('accepts a normal document', () => {
    expect(precheckInput(minimalDoc())).toBeNull();
  });
  it('maps each failure to one limit or type issue', () => {
    expect(precheckInput(undefined)).toEqual({ code: 'type', pointer: '', params: { limit: 'not_json' } });
    expect(precheckInput({ a: 'x'.repeat(300_000) })).toEqual({ code: 'limit', pointer: '/a', params: { limit: 'body_bytes' } });
    expect(precheckInput({ a: Array.from({ length: 160_000 }, () => 0) })?.params).toEqual({ limit: 'nodes' });
    let deep: unknown = [];
    for (let i = 0; i < 70; i += 1) deep = [deep];
    expect(precheckInput(deep)?.params).toEqual({ limit: 'depth' });
    expect(precheckInput({ a: 'nul\u0000' })?.params).toEqual({ limit: 'not_json' });
  });
});

describe('prepareDocument', () => {
  it('returns the input untouched when there is nothing to prepare', () => {
    const doc = minimalDoc();
    const prepared = prepareDocument(doc);
    expect(prepared.doc).toBe(doc);
    expect(prepared.issues).toEqual([]);
    expect(prepared.notes).toEqual([]);
    expect(prepareDocument(5).doc).toBe(5);
    expect(prepareDocument(null).doc).toBeNull();
  });

  it('copies on write and never mutates the input', () => {
    const doc = { ...minimalDoc(), attributes: {}, rules: [{ kind: 'rule.future', id: 'x' }, { kind: 'rule.custom', id: 'y', text: lt('T') }] };
    setAt(doc, ['stages', 0, 'constraints'], []);
    setAt(doc, ['stages', 0, 'pairing'], { kind: 'filter' });
    const before = canonicalizeJson(doc);
    const prepared = prepareDocument(doc);
    expect(canonicalizeJson(doc)).toBe(before);
    expect(prepared.doc).not.toBe(doc);
    const out = prepared.doc as Record<string, unknown>;
    expect('attributes' in out).toBe(false);
    const stage = (out.stages as Record<string, unknown>[])[0];
    expect('constraints' in stage).toBe(false);
    expect(stage.pairing).toEqual({ kind: 'manual' });
    expect((out.rules as Record<string, unknown>[])[1]).toBe((doc.rules as Record<string, unknown>[])[1]);
    expect(prepared.issues.map((i) => `${i.code} ${i.pointer} ${String(i.params.what)}`).sort()).toEqual(
      ['not_available_yet /attributes attributes', 'not_available_yet /stages/0/constraints constraints', 'not_available_yet /stages/0/pairing pairing.filter'].sort(),
    );
    expect(prepared.notes).toEqual([{ code: 'unknown_primitive', pointer: '/rules/0', params: { kind: 'rule.future' } }]);
  });

  it('covers every reserved pairing tag', () => {
    for (const tag of RESERVED_PAIRING_TAGS) {
      const prepared = prepareDocument(setAt(minimalDoc(), ['stages', 0, 'pairing'], { kind: tag }));
      expect(prepared.issues).toHaveLength(1);
    }
  });

  it('copes with hostile shapes', () => {
    expect(prepareDocument({ stages: 'x', rules: 5 }).issues).toEqual([]);
    expect(prepareDocument({ stages: [null, 1, 'x', []] }).issues).toEqual([]);
    expect(prepareDocument({ rules: [null, 1, 'x'] }).issues).toEqual([]);
    const hostile = JSON.parse('{"stages":[{"__proto__":{"constraints":1}}]}') as unknown;
    expect(prepareDocument(hostile).issues).toEqual([]);
  });
});

describe('classifyRuleEntry', () => {
  it('keeps a non-object and a known card, flags kind problems, degrades the rest', () => {
    expect(classifyRuleEntry('x', '/r')).toEqual({ action: 'keep' });
    expect(classifyRuleEntry({ kind: 'rule.custom' }, '/r')).toEqual({ action: 'keep' });
    expect(classifyRuleEntry({}, '/r')).toMatchObject({ action: 'issue', issue: { code: 'required', pointer: '/r/kind' } });
    expect(classifyRuleEntry({ kind: 1 }, '/r')).toMatchObject({ action: 'issue', issue: { code: 'type' } });
    expect(classifyRuleEntry({ kind: 'player.action' }, '/r')).toMatchObject({ action: 'issue', issue: { code: 'not_available_yet', pointer: '/r' } });
    expect(classifyRuleEntry({ kind: 'BAD' }, '/r')).toMatchObject({ action: 'issue', issue: { code: 'pattern' } });
    const degraded = classifyRuleEntry({ kind: 'rule.new', text: lt('Mine') }, '/r');
    expect(degraded.action).toBe('degrade');
    if (degraded.action === 'degrade') {
      expect(degraded.node.text).toEqual(lt('Mine'));
      expect('id' in degraded.node).toBe(false);
    }
  });
});
