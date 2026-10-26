import { describe, expect, it } from 'vitest';
import {
  formatCreateSchema,
  formatDraftSchema,
  formatForkSchema,
  formatListQuerySchema,
  formatPublishSchema,
  presetForkSchema,
  formatVisibilitySchema,
  seasonFormatAttachSchema,
  seasonFormatQuerySchema,
  validationFailedResponse,
} from '../api-schemas';

const UUID = '0b0c2f0e-1f4a-4f0b-9d7e-2f1f5c3a8b11';

describe('formatListQuerySchema', () => {
  it('applies the defaults', () => {
    expect(formatListQuerySchema.parse({})).toEqual({ scope: 'all', limit: 50, offset: 0 });
  });

  it('coerces the text values of a query string', () => {
    expect(formatListQuerySchema.parse({ scope: 'mine', limit: '25', offset: '10', kind: 'custom', visibility: 'league' })).toEqual({
      scope: 'mine',
      limit: 25,
      offset: 10,
      kind: 'custom',
      visibility: 'league',
    });
  });

  it('bounds limit and offset', () => {
    expect(formatListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(formatListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(formatListQuerySchema.safeParse({ offset: '-1' }).success).toBe(false);
    expect(formatListQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
  });

  it('rejects an unknown scope, filter value or parameter', () => {
    expect(formatListQuerySchema.safeParse({ scope: 'everything' }).success).toBe(false);
    expect(formatListQuerySchema.safeParse({ visibility: 'public' }).success).toBe(false);
    expect(formatListQuerySchema.safeParse({ owner: 'x' }).success).toBe(false);
  });
});

describe('formatCreateSchema', () => {
  it('takes a document, with or without a slug', () => {
    expect(formatCreateSchema.safeParse({ document: { schema_version: 1 } }).success).toBe(true);
    expect(formatCreateSchema.safeParse({ document: {}, slug: 'my-format' }).success).toBe(true);
  });

  it('takes a name and a base language', () => {
    expect(formatCreateSchema.parse({ name: '  Spring cup  ', base_locale: 'de' })).toEqual({ name: 'Spring cup', base_locale: 'de' });
  });

  it('keeps the document by reference', () => {
    const document = { schema_version: 1 };
    const parsed = formatCreateSchema.parse({ document });
    expect('document' in parsed && parsed.document).toBe(document);
  });

  it('rejects an envelope that is neither shape', () => {
    expect(formatCreateSchema.safeParse({}).success).toBe(false);
    expect(formatCreateSchema.safeParse({ slug: 'x' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ document: { a: 1 }, name: 'x', base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'x' }).success).toBe(false);
  });

  it('rejects a document that is not an object', () => {
    expect(formatCreateSchema.safeParse({ document: [] }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ document: null }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ document: 'x' }).success).toBe(false);
  });

  it('rejects a name with a NUL character or a lone surrogate', () => {
    expect(formatCreateSchema.safeParse({ name: 'Spring\u0000cup', base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'Spring\uD800cup', base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'Spring\uDC00cup', base_locale: 'de' }).success).toBe(false);
    // A complete pair (an emoji) is fine.
    expect(formatCreateSchema.safeParse({ name: 'Spring \u{1F3C6} cup', base_locale: 'en' }).success).toBe(true);
  });

  it('bounds the name and checks the slug', () => {
    expect(formatCreateSchema.safeParse({ name: '', base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: '   ', base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'x'.repeat(121), base_locale: 'en' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'x', base_locale: 'fr' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ name: 'x', base_locale: 'en', slug: 'Not A Slug' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ document: {}, slug: '-leading' }).success).toBe(false);
    expect(formatCreateSchema.safeParse({ document: {}, slug: 'a'.repeat(64) }).success).toBe(false);
  });
});

describe('formatDraftSchema', () => {
  it('needs a revision of at least 1 and a document', () => {
    expect(formatDraftSchema.safeParse({ draft_rev: 1, document: {} }).success).toBe(true);
    expect(formatDraftSchema.safeParse({ draft_rev: 0, document: {} }).success).toBe(false);
    expect(formatDraftSchema.safeParse({ draft_rev: 1.5, document: {} }).success).toBe(false);
    expect(formatDraftSchema.safeParse({ draft_rev: '1', document: {} }).success).toBe(false);
    expect(formatDraftSchema.safeParse({ draft_rev: 1 }).success).toBe(false);
    expect(formatDraftSchema.safeParse({ draft_rev: 3_000_000_000, document: {} }).success).toBe(false);
  });

  it('is strict', () => {
    expect(formatDraftSchema.safeParse({ draft_rev: 1, document: {}, name: 'x' }).success).toBe(false);
  });
});

describe('formatPublishSchema', () => {
  it('takes an optional localized changelog', () => {
    expect(formatPublishSchema.safeParse({ draft_rev: 2 }).success).toBe(true);
    expect(formatPublishSchema.safeParse({ draft_rev: 2, changelog: { base: 'en', en: { v: 'Fixed pairing', s: 'human' } } }).success).toBe(true);
  });

  it('rejects a changelog that is not a localized text', () => {
    expect(formatPublishSchema.safeParse({ draft_rev: 2, changelog: 'text' }).success).toBe(false);
    expect(formatPublishSchema.safeParse({ draft_rev: 2, changelog: { base: 'en' } }).success).toBe(false);
    expect(formatPublishSchema.safeParse({ draft_rev: 2, changelog: { base: 'en', en: { v: '', s: 'human' } } }).success).toBe(false);
  });

  it('needs the revision and nothing else', () => {
    expect(formatPublishSchema.safeParse({}).success).toBe(false);
    expect(formatPublishSchema.safeParse({ draft_rev: 2, visibility: 'gallery' }).success).toBe(false);
  });
});

describe('formatVisibilitySchema', () => {
  it('accepts the three visibilities only', () => {
    for (const visibility of ['private', 'league', 'gallery']) {
      expect(formatVisibilitySchema.safeParse({ visibility }).success).toBe(true);
    }
    expect(formatVisibilitySchema.safeParse({ visibility: 'public' }).success).toBe(false);
    expect(formatVisibilitySchema.safeParse({}).success).toBe(false);
    expect(formatVisibilitySchema.safeParse({ visibility: 'league', owner_id: UUID }).success).toBe(false);
  });
});

describe('formatForkSchema', () => {
  it('has an optional slug and nothing else', () => {
    expect(formatForkSchema.safeParse({}).success).toBe(true);
    expect(formatForkSchema.safeParse({ slug: 'my-copy' }).success).toBe(true);
    expect(formatForkSchema.safeParse({ slug: 'My Copy' }).success).toBe(false);
    expect(formatForkSchema.safeParse({ owner_id: UUID }).success).toBe(false);
  });
});

describe('presetForkSchema', () => {
  it('takes a slug and an optional rule preset of the catalog, and nothing else', () => {
    expect(presetForkSchema.safeParse({}).success).toBe(true);
    expect(presetForkSchema.safeParse({ slug: 'my-copy', ruleset_preset: 'gen9ou' }).success).toBe(true);
    expect(presetForkSchema.safeParse({ ruleset_preset: 'gen9vgc' }).success).toBe(true);
    expect(presetForkSchema.safeParse({ ruleset_preset: 'gen9natdexdraft' }).success).toBe(true);
    expect(presetForkSchema.safeParse({ showdown_format: 'gen9ou' }).success).toBe(false);
    expect(presetForkSchema.safeParse({ ruleset_preset: 'gen99xx' }).success).toBe(false);
    expect(presetForkSchema.safeParse({ ruleset_preset: 'blank' }).success).toBe(false);
    expect(presetForkSchema.safeParse({ ruleset_preset: 7 }).success).toBe(false);
    expect(presetForkSchema.safeParse({ owner_id: UUID }).success).toBe(false);
  });
});

describe('seasonFormatAttachSchema', () => {
  it('needs a definition id and takes an optional version number', () => {
    expect(seasonFormatAttachSchema.safeParse({ definition_id: UUID }).success).toBe(true);
    expect(seasonFormatAttachSchema.safeParse({ definition_id: UUID, version_no: 3 }).success).toBe(true);
    expect(seasonFormatAttachSchema.safeParse({}).success).toBe(false);
    expect(seasonFormatAttachSchema.safeParse({ definition_id: 'not-a-uuid' }).success).toBe(false);
    expect(seasonFormatAttachSchema.safeParse({ definition_id: UUID, version_no: 0 }).success).toBe(false);
    expect(seasonFormatAttachSchema.safeParse({ definition_id: UUID, version_no: 1.5 }).success).toBe(false);
    expect(seasonFormatAttachSchema.safeParse({ definition_id: UUID, season_id: UUID }).success).toBe(false);
  });
});

describe('seasonFormatQuerySchema', () => {
  it('knows one include value', () => {
    expect(seasonFormatQuerySchema.safeParse({}).success).toBe(true);
    expect(seasonFormatQuerySchema.safeParse({ include: 'spec' }).success).toBe(true);
    expect(seasonFormatQuerySchema.safeParse({ include: 'seed' }).success).toBe(false);
    expect(seasonFormatQuerySchema.safeParse({ other: '1' }).success).toBe(false);
  });
});

describe('validationFailedResponse', () => {
  it('answers 400 validation_failed with the issues as text and param', async () => {
    const parsed = formatVisibilitySchema.safeParse({ visibility: 'public' });
    if (parsed.success) throw new Error('expected a failure');
    const response = validationFailedResponse(parsed.error);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('validation_failed');
    expect(body.error).toContain('visibility');
    expect(body.params.issues).toBe(body.error);
  });
});
