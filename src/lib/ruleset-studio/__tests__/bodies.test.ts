import { describe, expect, it } from 'vitest';
import { assertDocument } from '../document-guard';
import { assertEnvelopeDocument, MAX_REQUEST_BODY_BYTES, readBoundedJson, readBoundedJsonOrEmpty } from '../api-body';
import { rulesetCreateSchema, rulesetDraftSchema, rulesetForkSchema, rulesetListQuerySchema, rulesetPinsSchema, rulesetPublishSchema, rulesetVisibilitySchema } from '../api-schemas';
import { slugFromName, withSlugSuffix } from '../slug';

const request = (body: string, headers: Record<string, string> = {}) => ({ headers: new Headers(headers), text: async () => body });
const ID = '11111111-1111-4111-8111-111111111111';

describe('assertDocument', () => {
  it('accepts a plain object and refuses everything else with a typed error', () => {
    expect(() => assertDocument({ a: 1 })).not.toThrow();
    for (const bad of [null, [], 'x', 3]) expect(() => assertDocument(bad)).toThrow(expect.objectContaining({ code: 'ruleset_document_not_object' }));
  });

  it('refuses a document that is too deep or too large before any parse', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = { x: deep };
    expect(() => assertDocument(deep)).toThrow(expect.objectContaining({ code: 'ruleset_document_too_deep' }));
    expect(() => assertDocument({ text: 'x'.repeat(300_000) })).toThrow(expect.objectContaining({ code: 'ruleset_document_too_large' }));
  });
});

describe('bounded bodies', () => {
  it('refuses a declared or an actual oversize body (413) and bad JSON (400)', async () => {
    await expect(readBoundedJson(request('{}', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }))).rejects.toMatchObject({ code: 'ruleset_document_too_large' });
    await expect(readBoundedJson(request('x'.repeat(MAX_REQUEST_BODY_BYTES + 1)))).rejects.toMatchObject({ code: 'ruleset_document_too_large' });
    await expect(readBoundedJson(request('{nope'))).rejects.toMatchObject({ code: 'invalid_json', statusCode: 400 });
    await expect(readBoundedJson(request('  '))).rejects.toMatchObject({ code: 'invalid_json' });
    expect(await readBoundedJson(request('{"a":1}'))).toEqual({ a: 1 });
  });

  it('an optional body reads blank as an empty object', async () => {
    expect(await readBoundedJsonOrEmpty(request(''))).toEqual({});
    await expect(readBoundedJsonOrEmpty(request('{bad'))).rejects.toMatchObject({ code: 'invalid_json' });
  });

  it('runs the document pre-check only on an envelope that has a document member', () => {
    expect(() => assertEnvelopeDocument({ draft_rev: 1 })).not.toThrow();
    expect(() => assertEnvelopeDocument({ document: [] })).toThrow(expect.objectContaining({ code: 'ruleset_document_not_object' }));
    expect(() => assertEnvelopeDocument(null)).not.toThrow();
  });
});

describe('request envelopes', () => {
  it('create: a document, or a name with a base language and an optional catalog preset', () => {
    expect(rulesetCreateSchema.safeParse({ document: { a: 1 } }).success).toBe(true);
    expect(rulesetCreateSchema.safeParse({ name: 'Spring OU', base_locale: 'en', preset: 'gen9ou' }).success).toBe(true);
    expect(rulesetCreateSchema.safeParse({ name: 'Spring OU', base_locale: 'en', preset: 'gen99zz' }).success).toBe(false);
    expect(rulesetCreateSchema.safeParse({ name: '  ', base_locale: 'en' }).success).toBe(false);
    expect(rulesetCreateSchema.safeParse({ name: 'x\u0000', base_locale: 'en' }).success).toBe(false);
    expect(rulesetCreateSchema.safeParse({ name: 'x', base_locale: 'fr' }).success).toBe(false);
    expect(rulesetCreateSchema.safeParse({ document: {}, name: 'x', base_locale: 'en' }).success).toBe(false);
  });

  it('draft, publish, visibility and fork are strict', () => {
    expect(rulesetDraftSchema.safeParse({ draft_rev: 1, document: {} }).success).toBe(true);
    expect(rulesetDraftSchema.safeParse({ draft_rev: 0, document: {} }).success).toBe(false);
    expect(rulesetDraftSchema.safeParse({ draft_rev: 1, document: {}, extra: 1 }).success).toBe(false);
    expect(rulesetPublishSchema.safeParse({ draft_rev: 2 }).success).toBe(true);
    expect(rulesetVisibilitySchema.safeParse({ visibility: 'public' }).success).toBe(false);
    expect(rulesetForkSchema.safeParse({}).success).toBe(true);
    expect(rulesetForkSchema.safeParse({ slug: 'Bad Slug' }).success).toBe(false);
  });

  it('pins: 1 to 50 targets, uuids only, a version number', () => {
    const ok = { to_version_no: 2, targets: [{ kind: 'season', id: ID }], confirm_started: [ID] };
    expect(rulesetPinsSchema.safeParse(ok).success).toBe(true);
    expect(rulesetPinsSchema.safeParse({ ...ok, targets: [] }).success).toBe(false);
    expect(rulesetPinsSchema.safeParse({ ...ok, targets: Array.from({ length: 51 }, () => ({ kind: 'tournament', id: ID })) }).success).toBe(false);
    expect(rulesetPinsSchema.safeParse({ ...ok, targets: [{ kind: 'league', id: ID }] }).success).toBe(false);
    expect(rulesetPinsSchema.safeParse({ ...ok, to_version_no: 0 }).success).toBe(false);
  });

  it('list query: defaults and bounds', () => {
    expect(rulesetListQuerySchema.parse({})).toMatchObject({ scope: 'all', limit: 50, offset: 0 });
    expect(rulesetListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(rulesetListQuerySchema.safeParse({ scope: 'nope' }).success).toBe(false);
  });
});

describe('slugs', () => {
  it('folds a name to a slug and falls back to "ruleset"', () => {
    expect(slugFromName('Gen 9 OU · Straße')).toBe('gen-9-ou-strasse');
    expect(slugFromName('✨✨')).toBe('ruleset');
    expect(slugFromName('x'.repeat(100)).length).toBe(63);
  });

  it('suffixes: -2 to -9, then four hex digits', () => {
    expect(withSlugSuffix('spring', 1)).toBe('spring');
    expect(withSlugSuffix('spring', 3)).toBe('spring-3');
    expect(withSlugSuffix('spring', 10, 'abcd')).toBe('spring-abcd');
    expect(withSlugSuffix('x'.repeat(63), 2).length).toBe(63);
    expect(() => withSlugSuffix('spring', 0)).toThrow(RangeError);
  });
});
