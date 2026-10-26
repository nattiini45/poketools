import { describe, expect, it } from 'vitest';
import { canonicalizeJson, validateFormatDefinition as validateBrowser } from '@/lib/format-kit/client';
import { validateFormatDefinition as validateServer } from '@/lib/format-kit';
import { COMPILE_ONLY_CASES, INVALID_CASES, nestedArray } from '@/lib/format-kit/__tests__/fixtures/invalid';
import { VALID_DOCS, cupDoc, degradedRulesDoc, kitchenSinkDoc, minimalDoc } from '@/lib/format-kit/__tests__/fixtures/docs';
import { MAX_REQUEST_BODY_BYTES } from '../../api-body';
import { assertDocument } from '../../document-guard';
import { FormatStudioError } from '../../errors';
import { extractIdentity } from '@/lib/studio-core/identity';
import { IMPORT_MAX_BYTES, prepareImport, stripUnknownFields, type ImportFailure, type ImportReport } from '../../editor/import-file';

const text = (value: unknown): string => JSON.stringify(value);

function prepared(source: string, byteLength?: number): ImportReport {
  const result = prepareImport(source, byteLength);
  if (!result.ok) throw new Error(`expected a report, got ${result.reason}`);
  return result.report;
}

function failure(source: string, byteLength?: number): ImportFailure {
  const result = prepareImport(source, byteLength);
  if (result.ok) throw new Error('expected a failure');
  return result.reason;
}

describe('failures, in the order the API checks them', () => {
  it('empty text', () => {
    expect(failure('')).toBe('empty');
    expect(failure('   \n\t ')).toBe('empty');
  });

  it('a file above the request limit, by its size or by its bytes', () => {
    expect(failure(text(minimalDoc()), IMPORT_MAX_BYTES + 1)).toBe('too_large');
    expect(prepared(text(minimalDoc()), IMPORT_MAX_BYTES).errorCount).toBe(0);
    // Two bytes per character: fewer characters than the limit, more bytes.
    expect(failure('ä'.repeat(IMPORT_MAX_BYTES / 2 + 1))).toBe('too_large');
    expect(failure('x'.repeat(IMPORT_MAX_BYTES + 1))).toBe('too_large');
  });

  it('text that is not JSON', () => {
    for (const source of ['{', 'not json', "{'a':1}", '{"a":1,}', 'undefined', '{"a":NaN}']) {
      expect(failure(source), source).toBe('not_json');
    }
  });

  it('JSON that is not an object', () => {
    for (const source of ['[]', '[{"a":1}]', 'null', '"text"', '5', 'true']) {
      expect(failure(source), source).toBe('not_object');
    }
  });

  it('nesting deeper than 64 levels', () => {
    expect(failure(text({ x: nestedArray(64) }))).toBe('too_deep');
    expect(prepared(text({ ...minimalDoc(), extra: nestedArray(62) })).document).toBeDefined();
  });

  it('more than 150,000 entries', () => {
    expect(failure(text({ x: new Array(150_000).fill(0) }))).toBe('too_many_nodes');
  });

  it('a canonical body of 262,145 bytes (and not one byte less)', () => {
    const base = { ...minimalDoc(), pad: '' };
    const room = 262_145 - canonicalizeJson(base).length;
    const over = { ...base, pad: 'x'.repeat(room) };
    expect(() => canonicalizeJson(over)).toThrow();
    expect(failure(text(over))).toBe('too_large');
    const exact = { ...base, pad: 'x'.repeat(room - 1) };
    expect(canonicalizeJson(exact).length).toBe(262_144);
    expect(prepared(text(exact)).unknownFields).toEqual(['/pad']);
  });

  it('a NUL character inside a text', () => {
    const doc = minimalDoc();
    const withNul = { ...doc, identity: { ...(doc.identity as object), summary: { base: 'en', en: { v: 'a\u0000b', s: 'human' } } } };
    expect(failure(text(withNul))).toBe('not_json');
  });

  it('a document without a usable name', () => {
    const doc = minimalDoc();
    const noName = { ...doc, identity: {} };
    const noIdentity = { ...doc };
    delete (noIdentity as Record<string, unknown>).identity;
    expect(failure(text(noName))).toBe('name_required');
    expect(failure(text(noIdentity))).toBe('name_required');
    expect(failure(text({ ...doc, identity: 'x' }))).toBe('name_required');
    expect(failure(text({ ...doc, identity: { name: 'x' } }))).toBe('name_required');
    expect(failure(text({ ...doc, identity: { name: { base: 'en' } } }))).toBe('name_required');
    expect(failure(text({ ...doc, identity: { name: { base: 'en', en: { v: '', s: 'human' } } } }))).toBe('name_required');
  });
});

describe('the report', () => {
  it('a valid document has no issues and keeps the document as parsed', () => {
    const doc = cupDoc();
    const report = prepared(text(doc));
    expect(report.issues).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(report.unknownFields).toEqual([]);
    expect(report.reserved).toEqual([]);
    expect(report.document).toEqual(doc);
  });

  it('reports unknown members by pointer and does not count them as errors', () => {
    const doc = { ...minimalDoc(), extra: 1 } as Record<string, unknown>;
    (doc.stages as Array<Record<string, unknown>>)[0].mystery = true;
    const report = prepared(text(doc));
    expect([...report.unknownFields].sort()).toEqual(['/extra', '/stages/0/mystery']);
    expect(report.errorCount).toBe(0);
    expect(report.issues).toHaveLength(2);
  });

  it('reports a reserved section apart from the unknown members', () => {
    const doc = { ...minimalDoc(), attributes: [], extra: 1 };
    const report = prepared(text(doc));
    expect(report.reserved).toEqual(['/attributes']);
    expect(report.unknownFields).toEqual(['/extra']);
    expect(report.errorCount).toBe(0);
  });

  it('reports a reserved field of a stage', () => {
    const doc = minimalDoc();
    (doc.stages as Array<Record<string, unknown>>)[0].constraints = [];
    expect(prepared(text(doc)).reserved).toEqual(['/stages/0/constraints']);
  });

  it('counts real errors', () => {
    const doc = minimalDoc();
    ((doc.stages as Array<Record<string, unknown>>)[0].series as Record<string, unknown>).best_of = 99;
    const report = prepared(text({ ...doc, extra: true }));
    expect(report.errorCount).toBe(1);
    expect(report.unknownFields).toEqual(['/extra']);
  });

  it('turns an unknown rule kind into a note, not an error', () => {
    const report = prepared(text(degradedRulesDoc()));
    expect(report.errorCount).toBe(0);
    expect(report.notes.map((n) => n.params.kind).sort()).toEqual(['rule.unknown_one', 'rule.unknown_two']);
  });

  it('accepts a document with everything in it', () => {
    expect(prepared(text(kitchenSinkDoc())).errorCount).toBe(0);
  });
});

describe('stripUnknownFields', () => {
  it('removes unknown members and reserved sections and leaves nothing unknown', () => {
    const doc = { ...minimalDoc(), extra: 1, attributes: [], tunables: {} } as Record<string, unknown>;
    (doc.stages as Array<Record<string, unknown>>)[0].mystery = true;
    (doc.stages as Array<Record<string, unknown>>)[0].constraints = [];
    const report = prepared(text(doc));
    const stripped = stripUnknownFields(report);
    expect(stripped).not.toHaveProperty('extra');
    expect(stripped).not.toHaveProperty('attributes');
    expect(stripped).not.toHaveProperty('tunables');
    const after = validateBrowser(stripped);
    expect(after.ok).toBe(true);
    expect(prepared(text(stripped)).unknownFields).toEqual([]);
    expect(prepared(text(stripped)).reserved).toEqual([]);
  });

  it('does not change the report\'s document', () => {
    const report = prepared(text({ ...minimalDoc(), extra: 1 }));
    const snapshot = text(report.document);
    stripUnknownFields(report);
    expect(text(report.document)).toBe(snapshot);
    expect(report.document).toHaveProperty('extra');
  });

  it('removes several array items without shifting the ones still to go', () => {
    const doc = minimalDoc();
    const stage = (doc.stages as Array<Record<string, unknown>>)[0];
    doc.stages = [
      { ...stage, key: 'a', junk: 1 },
      { ...stage, key: 'b' },
      { ...stage, key: 'c', junk: 2 },
    ];
    const report = prepared(text(doc));
    expect(report.unknownFields).toEqual(['/stages/0/junk', '/stages/2/junk']);
    const stripped = stripUnknownFields(report) as { stages: Array<Record<string, unknown>> };
    expect(stripped.stages.map((s) => s.key)).toEqual(['a', 'b', 'c']);
    expect(stripped.stages.some((s) => 'junk' in s)).toBe(false);
  });

  it('removes an unknown item of a list of pointers in any order', () => {
    const report: ImportReport = {
      document: { list: ['a', 'b', 'c', 'd'], o: { x: 1, y: 2 } },
      issues: [],
      errorCount: 0,
      unknownFields: ['/list/0', '/list/2', '/o/x'],
      reserved: ['/list/3'],
      notes: [],
    };
    expect(stripUnknownFields(report)).toEqual({ list: ['b'], o: { y: 2 } });
  });

  it('skips a pointer that is already gone or malformed', () => {
    const report: ImportReport = { document: { a: 1 }, issues: [], errorCount: 0, unknownFields: ['/b/c', 'nope', '/a/x', ''], reserved: [], notes: [] };
    expect(stripUnknownFields(report)).toEqual({ a: 1 });
  });
});

describe('own __proto__ keys', () => {
  const source = `{"__proto__":{"polluted":true},${text(minimalDoc()).slice(1)}`;

  it('arrive as data, are reported as unknown members and pollute nothing', () => {
    const report = prepared(source);
    expect(report.unknownFields).toEqual(['/__proto__']);
    expect(Object.prototype.hasOwnProperty.call(report.document, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(report.document)).toBe(Object.prototype);
  });

  it('are removed by the strip option', () => {
    const stripped = stripUnknownFields(prepared(source));
    expect(Object.prototype.hasOwnProperty.call(stripped, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(prepared(text(stripped)).unknownFields).toEqual([]);
  });

  it('inside a stage too', () => {
    const doc = text(minimalDoc()).replace('"key":"main"', '"__proto__":{"polluted":true},"key":"main"');
    const stripped = stripUnknownFields(prepared(doc));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(prepared(text(stripped)).unknownFields).toEqual([]);
  });
});

describe('limits', () => {
  it('the import limit is the request body limit of the format routes', () => {
    expect(IMPORT_MAX_BYTES).toBe(MAX_REQUEST_BODY_BYTES);
  });
});

describe('parity with the server pair assertDocument + zod validator', () => {
  type ServerOutcome = { fail: ImportFailure } | { fail: null; pointers: string[]; notes: number };

  /** What the API does with the same text: parse, the document guard, the zod validator, the name. */
  function server(source: string): ServerOutcome {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      return { fail: 'not_json' };
    }
    try {
      assertDocument(parsed);
    } catch (error) {
      if (!(error instanceof FormatStudioError)) throw error;
      const byCode: Record<string, ImportFailure> = {
        format_document_not_object: 'not_object',
        format_document_too_deep: 'too_deep',
        format_document_too_many_nodes: 'too_many_nodes',
        format_document_too_large: 'too_large',
        format_document_not_json: 'not_json',
      };
      return { fail: byCode[String(error.code)] };
    }
    const result = validateServer(parsed);
    if (extractIdentity(parsed).name === null) return { fail: 'name_required' };
    return result.ok
      ? { fail: null, pointers: [], notes: result.notes.length }
      : { fail: null, pointers: result.issues.map((i) => `${i.code}@${i.pointer}`), notes: 0 };
  }

  function clientOutcome(source: string): ServerOutcome {
    const result = prepareImport(source);
    if (!result.ok) return { fail: result.reason };
    return { fail: null, pointers: result.report.issues.map((i) => `${i.code}@${i.pointer}`), notes: result.report.notes.length };
  }

  const corpus: Array<[string, string]> = [];
  for (const { id, build } of VALID_DOCS) corpus.push([`valid ${id}`, text(build())]);
  for (const entry of [...INVALID_CASES, ...COMPILE_ONLY_CASES]) {
    const built = 'build' in entry ? (entry as { build: () => unknown }).build() : undefined;
    const json = built === undefined ? undefined : text(built);
    if (json !== undefined) corpus.push([`case ${entry.id}`, json]);
  }
  corpus.push(
    ['array', '[]'],
    ['null', 'null'],
    ['string', '"x"'],
    ['broken', '{"a":'],
    ['no name', text({ ...minimalDoc(), identity: {} })],
    ['name with no text', text({ ...minimalDoc(), identity: { name: { base: 'en' } } })],
    ['deep', text({ x: nestedArray(64) })],
    ['with nul', text({ ...minimalDoc(), note: 'a\u0000b' })],
    ['proto', `{"__proto__":{"a":1},${text(minimalDoc()).slice(1)}`],
  );

  it('has a corpus worth the name', () => {
    expect(corpus.length).toBeGreaterThan(60);
  });

  it.each(corpus)('%s', (_name, source) => {
    expect(clientOutcome(source)).toEqual(server(source));
  });
});
