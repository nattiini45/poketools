import { describe, expect, it } from 'vitest';
import { newRulesetDocument } from '../../document';
import { IMPORT_MAX_BYTES, prepareImport } from '../../editor/import-file';

const valid = () => JSON.stringify(newRulesetDocument('Imported', 'en', 'gen9ou'));

describe('prepareImport', () => {
  it('accepts a ruleset document and returns it as parsed', () => {
    const result = prepareImport(valid());
    expect(result).toMatchObject({ ok: true, report: { issues: [] } });
    if (result.ok) expect(result.report.document).toEqual(JSON.parse(valid()));
  });

  it('refuses an empty file, a file that is not JSON and one that is not an object', () => {
    expect(prepareImport('')).toEqual({ ok: false, reason: 'empty' });
    expect(prepareImport('  \n ')).toEqual({ ok: false, reason: 'empty' });
    expect(prepareImport('{nope')).toEqual({ ok: false, reason: 'not_json' });
    expect(prepareImport('[1,2]')).toEqual({ ok: false, reason: 'not_object' });
    expect(prepareImport('"text"')).toEqual({ ok: false, reason: 'not_object' });
  });

  it('refuses by size before it parses, from the byte count when the caller knows it', () => {
    expect(prepareImport('{}', IMPORT_MAX_BYTES + 1)).toEqual({ ok: false, reason: 'too_large' });
    expect(prepareImport(JSON.stringify({ text: 'x'.repeat(300_000) }))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses a file nested too deeply or with too many entries', () => {
    expect(prepareImport('['.repeat(70_000) + ']'.repeat(70_000))).toEqual({ ok: false, reason: 'not_object' });
    expect(prepareImport(`{"a":${'{"a":'.repeat(80)}1${'}'.repeat(80)}}`)).toEqual({ ok: false, reason: 'too_deep' });
    expect(prepareImport(JSON.stringify({ list: Array.from({ length: 160_000 }, () => 1) }))).toEqual({ ok: false, reason: 'too_many_nodes' });
  });

  it('needs a valid name under identity', () => {
    const doc = JSON.parse(valid());
    delete doc.identity.name;
    expect(prepareImport(JSON.stringify(doc))).toEqual({ ok: false, reason: 'name_required' });
    expect(prepareImport(JSON.stringify({ ...doc, identity: 'no' }))).toEqual({ ok: false, reason: 'name_required' });
  });

  it('reports structure problems instead of storing them', () => {
    const doc = JSON.parse(valid());
    doc.pokemon.ban = ['Not An Id'];
    doc.surprise = true;
    const result = prepareImport(JSON.stringify(doc));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.issues.length).toBeGreaterThan(0);
    expect(result.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['unknown_key', 'bad_id']));
  });

  it('never executes the text: an own __proto__ key is ordinary data', () => {
    const result = prepareImport('{"__proto__":{"polluted":true},"identity":{"name":{"base":"en","en":{"v":"x","s":"human"}}}}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});
