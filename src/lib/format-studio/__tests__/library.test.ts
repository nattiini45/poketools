import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, contentHash, ltext, resolveLText, type FormatDefinition, type LText } from '@/lib/format-kit';
import type { SessionPlayer } from '@/types/auth';
import { FormatStudioError } from '../errors';
import type { FormatDefinitionMeta, FormatVersion } from '../library-types';

vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  countFormatVersions: vi.fn(),
  countSeasonFormatsOfDefinition: vi.fn(),
  createFormatDefinition: vi.fn(),
  deleteFormatDefinition: vi.fn(),
  getFormatDefinitionDraft: vi.fn(),
  getFormatDefinitionMeta: vi.fn(),
  getFormatVersion: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
  listFormatVersions: vi.fn(),
  publishFormatVersion: vi.fn(),
  saveFormatDraft: vi.fn(),
  setFormatVisibility: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn() }));

import {
  countFormatVersions,
  countSeasonFormatsOfDefinition,
  createFormatDefinition,
  deleteFormatDefinition,
  getFormatDefinitionDraft,
  getFormatDefinitionMeta,
  getFormatVersion,
  getLatestPublishedVersion,
  listFormatVersions,
  publishFormatVersion,
  saveFormatDraft,
  setFormatVisibility,
} from '@/lib/supabase/queries/format-definitions';
import { resolvePlayerNames } from '@/lib/supabase/queries/players';
import {
  MAX_CHECK_DIAGNOSTICS,
  assertCanEditDraft,
  changeVisibility,
  checkDocument,
  createFromBody,
  forkDefinition,
  forkPreset,
  getFormatDetail,
  publish,
  removeDefinition,
  saveDraft,
  summariseDefinition,
} from '../library';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OWNER,
  name: 'Owner Name',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

const meta = (overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta => ({
  id: DEFINITION_ID,
  slug: 'spring-cup',
  name: ltext('en', 'Spring cup'),
  description: null,
  kind: 'custom',
  owner_id: OWNER,
  visibility: 'private',
  forked_from: null,
  draft_rev: 4,
  current_version_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const cup = (): FormatDefinition => structuredClone(PRESETS.find((p) => p.id === 'cup')!.definition);

/** What the database returns for an insert: the meta the input describes. */
function echoCreate() {
  vi.mocked(createFormatDefinition).mockImplementation(async (input) =>
    meta({
      id: 'new-id',
      slug: input.slug,
      name: input.name,
      description: input.description,
      owner_id: input.ownerId,
      forked_from: input.forkedFrom,
      draft_rev: 1,
    }),
  );
}

const slugTaken = () => new FormatStudioError('format_slug_taken');

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw');
}
const codeOf = (err: unknown) => (err as FormatStudioError).code;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(resolvePlayerNames).mockResolvedValue({ [OWNER]: 'Owner Name' });
  vi.mocked(listFormatVersions).mockResolvedValue([]);
});

describe('checkDocument', () => {
  it('compiles a valid document', () => {
    const check = checkDocument(cup());
    expect(check.ok).toBe(true);
    expect(check.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(check.truncated).toBe(false);
    expect(check.diagnostics.some((d) => d.severity === 'error')).toBe(false);
  });

  it('reports the errors of a skeleton and no hash', () => {
    const check = checkDocument({ schema_version: 1, identity: { name: ltext('en', 'x') }, stages: [] });
    expect(check.ok).toBe(false);
    expect(check.hash).toBeNull();
    expect(check.diagnostics.length).toBeGreaterThan(0);
  });

  it('caps the diagnostics at 200 and says so, errors first', () => {
    const definition = cup();
    // Many stages with the same key: one error each.
    definition.stages = Array.from({ length: 50 }, () => structuredClone(definition.stages[0]));
    definition.edges = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(definition.edges[0]), key: `edge_${i}`, from: 'nowhere', to: 'nowhere2' }));
    const check = checkDocument(definition);
    expect(check.diagnostics.length).toBeLessThanOrEqual(MAX_CHECK_DIAGNOSTICS);
    if (check.truncated) expect(check.diagnostics).toHaveLength(MAX_CHECK_DIAGNOSTICS);
    expect(check.diagnostics[0].severity).toBe('error');
  });

  it('never throws for a hostile value', () => {
    expect(checkDocument(null).ok).toBe(false);
    expect(checkDocument([1]).ok).toBe(false);
    expect(checkDocument('text').ok).toBe(false);
  });
});

describe('assertCanEditDraft', () => {
  it('lets the owner of a custom row and a site admin through', () => {
    expect(() => assertCanEditDraft(player(), meta())).not.toThrow();
    expect(() => assertCanEditDraft(player({ playerId: OTHER, isAdmin: true }), meta())).not.toThrow();
  });

  it('answers a plain 403 to anyone else', () => {
    let error: unknown;
    try {
      assertCanEditDraft(player({ playerId: OTHER }), meta({ visibility: 'league' }));
    } catch (err) {
      error = err;
    }
    expect(error).toMatchObject({ statusCode: 403, code: 'forbidden' });
  });

  it('answers format_preset_locked for a preset row, to its owner too', () => {
    let error: unknown;
    try {
      assertCanEditDraft(player(), meta({ kind: 'preset' }));
    } catch (err) {
      error = err;
    }
    expect(codeOf(error)).toBe('format_preset_locked');
    expect(() => assertCanEditDraft(player({ isAdmin: true }), meta({ kind: 'preset' }))).not.toThrow();
  });
});

describe('summariseDefinition', () => {
  it('maps the owner to id and name only and the newest version to its head', async () => {
    vi.mocked(listFormatVersions).mockResolvedValue([
      { id: 'v2', version_no: 2, schema_version: 1, content_hash: 'h2', changelog: null, created_by: OWNER, created_at: '2026-10-03T00:00:00.000Z' },
    ]);
    const summary = await summariseDefinition(meta({ current_version_id: 'v2' }));
    expect(summary.owner).toEqual({ id: OWNER, name: 'Owner Name' });
    expect(summary.current_version).toEqual({ id: 'v2', version_no: 2, content_hash: 'h2', created_at: '2026-10-03T00:00:00.000Z' });
    expect(summary).not.toHaveProperty('owner_id');
    expect(summary).not.toHaveProperty('current_version_id');
    expect(listFormatVersions).toHaveBeenCalledWith(DEFINITION_ID, 1);
  });

  it('reads nothing for an ownerless, unpublished definition', async () => {
    const summary = await summariseDefinition(meta({ owner_id: null }));
    expect(summary.owner).toBeNull();
    expect(summary.current_version).toBeNull();
    expect(resolvePlayerNames).not.toHaveBeenCalled();
    expect(listFormatVersions).not.toHaveBeenCalled();
  });
});

describe('createFromBody', () => {
  beforeEach(echoCreate);

  it('creates from a document: name and summary follow the identity, slug follows the name', async () => {
    const definition = cup();
    const created = await createFromBody(player(), { document: definition as unknown as Record<string, unknown> });
    expect(createFormatDefinition).toHaveBeenCalledTimes(1);
    expect(createFormatDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'cup',
        name: definition.identity.name,
        description: definition.identity.summary,
        ownerId: OWNER,
        forkedFrom: null,
        document: definition,
      }),
    );
    expect(created.definition.owner).toEqual({ id: OWNER, name: 'Owner Name' });
    expect(created.definition.visibility).toBe('private');
    expect(created.definition.current_version).toBeNull();
    expect(created.check.ok).toBe(true);
  });

  it('answers format_document_name_required for a document without a valid name', async () => {
    const err = await failure(createFromBody(player(), { document: { schema_version: 1, identity: { name: 'plain' }, stages: [] } }));
    expect(codeOf(err)).toBe('format_document_name_required');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('answers format_document_name_required for a name the localized text cannot hold, and inserts nothing', async () => {
    const err = await failure(createFromBody(player(), { name: 'Spring\u0000cup', base_locale: 'en' }));
    expect(codeOf(err)).toBe('format_document_name_required');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('creates a skeleton from a name; the check reports it incomplete', async () => {
    const created = await createFromBody(player(), { name: 'Frühlings Cup', base_locale: 'de' });
    expect(createFormatDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'fruhlings-cup',
        name: { base: 'de', de: { v: 'Frühlings Cup', s: 'human' } },
        document: { schema_version: 1, identity: { name: { base: 'de', de: { v: 'Frühlings Cup', s: 'human' } } }, stages: [] },
      }),
    );
    expect(created.check.ok).toBe(false);
  });

  it('uses an explicit slug as given, once: a taken one answers format_slug_taken', async () => {
    vi.mocked(createFormatDefinition).mockRejectedValue(slugTaken());
    const err = await failure(createFromBody(player(), { name: 'Cup', base_locale: 'en', slug: 'my-cup' }));
    expect(codeOf(err)).toBe('format_slug_taken');
    expect(createFormatDefinition).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createFormatDefinition).mock.calls[0][0].slug).toBe('my-cup');
  });

  it('retries a generated slug with -2, -3 and so on', async () => {
    vi.mocked(createFormatDefinition)
      .mockRejectedValueOnce(slugTaken())
      .mockRejectedValueOnce(slugTaken())
      .mockImplementationOnce(async (input) => meta({ slug: input.slug }));
    const created = await createFromBody(player(), { name: 'Cup', base_locale: 'en' });
    expect(vi.mocked(createFormatDefinition).mock.calls.map(([input]) => input.slug)).toEqual(['cup', 'cup-2', 'cup-3']);
    expect(created.definition.slug).toBe('cup-3');
  });

  it('ends with four random hex digits and then gives up with format_slug_taken', async () => {
    vi.mocked(createFormatDefinition).mockRejectedValue(slugTaken());
    const err = await failure(createFromBody(player(), { name: 'Cup', base_locale: 'en' }));
    expect(codeOf(err)).toBe('format_slug_taken');
    const slugs = vi.mocked(createFormatDefinition).mock.calls.map(([input]) => input.slug);
    expect(slugs).toHaveLength(10);
    expect(slugs.slice(0, 9)).toEqual(['cup', 'cup-2', 'cup-3', 'cup-4', 'cup-5', 'cup-6', 'cup-7', 'cup-8', 'cup-9']);
    expect(slugs[9]).toMatch(/^cup-[0-9a-f]{4}$/);
  });

  it('does not retry any other error', async () => {
    vi.mocked(createFormatDefinition).mockRejectedValue(new Error('database down'));
    await expect(createFromBody(player(), { name: 'Cup', base_locale: 'en' })).rejects.toThrow('database down');
    expect(createFormatDefinition).toHaveBeenCalledTimes(1);
  });
});

describe('forkDefinition', () => {
  beforeEach(echoCreate);

  const published = (spec: FormatDefinition): FormatVersion => ({
    id: 'v1',
    definition_id: DEFINITION_ID,
    version_no: 1,
    schema_version: 1,
    content_hash: 'h'.repeat(64),
    changelog: null,
    created_by: OWNER,
    created_at: '2026-10-03T00:00:00.000Z',
    spec,
    status: 'published',
  });

  it('copies the latest published spec, sets based_on and forked_from, and is owned by the caller', async () => {
    const spec = cup();
    spec.identity.name = ltext('en', 'Published name');
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(published(spec));
    const forked = await forkDefinition(player({ playerId: OTHER, name: 'Other Name' }), meta({ visibility: 'league', current_version_id: 'v1' }));
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect(input.ownerId).toBe(OTHER);
    expect(input.forkedFrom).toBe(DEFINITION_ID);
    expect(input.slug).toBe('spring-cup-copy');
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('spring-cup');
    expect(input.name).toEqual(spec.identity.name);
    // The source spec is not touched.
    expect(spec.identity.based_on).toBeUndefined();
    expect(forked.definition.owner).toEqual({ id: OTHER, name: 'Other Name' });
    expect(forked.definition.forked_from).toBe(DEFINITION_ID);
    expect(forked.check.ok).toBe(true);
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
  });

  it('never copies the draft for someone who is not the owner: format_not_published', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    const err = await failure(forkDefinition(player({ playerId: OTHER }), meta({ visibility: 'league' })));
    expect(codeOf(err)).toBe('format_not_published');
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });

  it('copies the draft for the owner when nothing is published', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 4 });
    await forkDefinition(player(), meta());
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('spring-cup');
  });

  it('copies the draft for a site admin; a draft with a broken identity keeps the source name', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: { schema_version: 1, stages: [] }, draft_rev: 2 });
    await forkDefinition(player({ playerId: OTHER, isAdmin: true }), meta({ owner_id: OWNER }));
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect(input.name).toEqual(ltext('en', 'Spring cup'));
    expect((input.document as { identity: unknown }).identity).toEqual({ based_on: 'spring-cup' });
  });

  it('takes an explicit slug', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(published(cup()));
    await forkDefinition(player(), meta(), 'my-own');
    expect(vi.mocked(createFormatDefinition).mock.calls[0][0].slug).toBe('my-own');
  });
});

describe('forkPreset', () => {
  beforeEach(echoCreate);

  it('forks a shipped example with based_on set to its id and no forked_from', async () => {
    const forked = await forkPreset(player(), 'cup');
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    expect(input.forkedFrom).toBeNull();
    expect(input.slug).toBe('cup');
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('cup');
    expect(forked.check.ok).toBe(true);
    expect(forked.definition.kind).toBe('custom');
    expect(forked.definition.visibility).toBe('private');
  });

  it('pre-picks a rule preset on every stage, names it in the copy and in its slug', async () => {
    const forked = await forkPreset(player(), 'cup', { rulesetPreset: 'gen9vgc' });
    const input = vi.mocked(createFormatDefinition).mock.calls[0][0];
    const document = input.document as { identity: { based_on: string }; stages: { ruleset: unknown; doubles: boolean; series: { best_of: number } }[] };
    expect(document.stages.map((s) => s.ruleset)).toEqual([
      { kind: 'preset', preset: 'gen9vgc' },
      { kind: 'preset', preset: 'gen9vgc' },
    ]);
    expect(document.stages.every((s) => s.doubles && s.series.best_of === 3)).toBe(true);
    expect(document.identity.based_on).toBe('cup');
    expect(resolveLText(input.name as LText, { viewer: 'en' })?.value).toMatch(/ \(Gen 9 VGC\)$/);
    expect(input.slug).toBe('cup-gen9vgc');
    expect(forked.check.ok).toBe(true);
  });

  it('an explicit slug wins over the derived one', async () => {
    await forkPreset(player(), 'cup', { slug: 'my-cup', rulesetPreset: 'gen9ou' });
    expect(vi.mocked(createFormatDefinition).mock.calls[0][0].slug).toBe('my-cup');
  });

  it('does not change the shipped constant', async () => {
    await forkPreset(player(), 'swiss-top-cut', { rulesetPreset: 'gen9ou' });
    expect(PRESETS.find((p) => p.id === 'swiss-top-cut')!.definition.stages[0].ruleset).toEqual({ kind: 'season_default' });
    await forkPreset(player(), 'swiss-top-cut');
    expect(PRESETS.find((p) => p.id === 'swiss-top-cut')!.definition.identity.based_on).toBeUndefined();
  });

  it('answers format_preset_not_found for an unknown or malformed id', async () => {
    expect(codeOf(await failure(forkPreset(player(), 'no-such-preset')))).toBe('format_preset_not_found');
    expect(codeOf(await failure(forkPreset(player(), '../etc')))).toBe('format_preset_not_found');
    expect(codeOf(await failure(forkPreset(player(), '__proto__')))).toBe('format_preset_not_found');
    expect(createFormatDefinition).not.toHaveBeenCalled();
  });
});

describe('saveDraft', () => {
  const document = (): Record<string, unknown> => cup() as unknown as Record<string, unknown>;

  it('saves with the revision the client saw and syncs name and description from the identity', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 5, updated_at: '2026-10-05T00:00:00.000Z' });
    const doc = document();
    const saved = await saveDraft(meta(), { draftRev: 4, document: doc });
    const call = vi.mocked(saveFormatDraft).mock.calls[0][0];
    expect(call).toMatchObject({ id: DEFINITION_ID, expectedRev: 4, document: doc });
    expect(call.name).toEqual((doc as unknown as FormatDefinition).identity.name);
    expect(call.description).toEqual((doc as unknown as FormatDefinition).identity.summary);
    expect(saved).toMatchObject({ draft_rev: 5, updated_at: '2026-10-05T00:00:00.000Z' });
    expect(saved.check.ok).toBe(true);
  });

  it('keeps the stored name when the identity name is not valid; a draft may be invalid', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 5, updated_at: 'now' });
    const saved = await saveDraft(meta(), { draftRev: 4, document: { schema_version: 1, identity: { name: 'plain' }, stages: [] } });
    const call = vi.mocked(saveFormatDraft).mock.calls[0][0];
    expect(call).not.toHaveProperty('name');
    // No summary in the document: the description is cleared, not left stale.
    expect(call.description).toBeNull();
    expect(saved.name).toEqual(ltext('en', 'Spring cup'));
    expect(saved.check.ok).toBe(false);
  });

  it('keeps the stored description when the summary is present but not valid', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 5, updated_at: 'now' });
    const doc = document();
    (doc.identity as Record<string, unknown>).summary = 'plain text';
    await saveDraft(meta({ description: ltext('en', 'old') }), { draftRev: 4, document: doc });
    expect(vi.mocked(saveFormatDraft).mock.calls[0][0]).not.toHaveProperty('description');
  });

  it('clears the description when the summary was removed from the document', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 5, updated_at: 'now' });
    const doc = document();
    delete (doc.identity as Record<string, unknown>).summary;
    await saveDraft(meta({ description: ltext('en', 'old') }), { draftRev: 4, document: doc });
    expect(vi.mocked(saveFormatDraft).mock.calls[0][0].description).toBeNull();
  });

  it.each(['league', 'gallery'] as const)(
    'leaves name and description alone for a definition shared as %s, and answers with the stored name',
    async (visibility) => {
      vi.mocked(saveFormatDraft).mockResolvedValue({ draft_rev: 5, updated_at: 'now' });
      const doc = document();
      const stored = meta({ visibility, description: ltext('en', 'old summary') });
      const saved = await saveDraft(stored, { draftRev: 4, document: doc });
      const call = vi.mocked(saveFormatDraft).mock.calls[0][0];
      expect(call).toMatchObject({ id: DEFINITION_ID, expectedRev: 4, document: doc });
      expect(call).not.toHaveProperty('name');
      expect(call).not.toHaveProperty('description');
      expect(saved.name).toEqual(ltext('en', 'Spring cup'));
    },
  );

  it('answers 409 format_stale_revision with the current revision when the compare-and-set misses', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ draft_rev: 9 }));
    const err = (await failure(saveDraft(meta(), { draftRev: 4, document: document() }))) as FormatStudioError;
    expect(err.code).toBe('format_stale_revision');
    expect(err.statusCode).toBe(409);
    expect(err.params).toMatchObject({ draft_rev: 9 });
  });

  it('answers 404 when the definition was deleted in the meantime', async () => {
    vi.mocked(saveFormatDraft).mockResolvedValue(null);
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(null);
    const err = (await failure(saveDraft(meta(), { draftRev: 4, document: document() }))) as FormatStudioError;
    expect(err.code).toBe('format_not_found');
    expect(err.statusCode).toBe(404);
  });
});

describe('publish', () => {
  const draftOf = (document: unknown, rev = 4) => vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document, draft_rev: rev });
  const storedVersion = (no: number): FormatVersion => ({
    id: 'v-new',
    definition_id: DEFINITION_ID,
    version_no: no,
    schema_version: 1,
    content_hash: 'c'.repeat(64),
    changelog: null,
    created_by: OWNER,
    created_at: '2026-10-06T00:00:00.000Z',
    spec: cup(),
    status: 'published',
  });

  it('publishes the parsed definition with its canonical hash', async () => {
    const draft = cup();
    draftOf(draft);
    vi.mocked(publishFormatVersion).mockResolvedValue({ versionId: 'v-new', versionNo: 1 });
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion(1));
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ current_version_id: 'v-new' }));
    vi.mocked(listFormatVersions).mockResolvedValue([storedVersion(1)]);
    const changelog = ltext('en', 'First version');

    const result = await publish(player(), meta(), { draftRev: 4, changelog });

    const call = vi.mocked(publishFormatVersion).mock.calls[0][0];
    expect(call.definitionId).toBe(DEFINITION_ID);
    expect(call.expectedRev).toBe(4);
    expect(call.actorId).toBe(OWNER);
    expect(call.changelog).toEqual(changelog);
    expect(call.specJson).toEqual(draft);
    expect(call.contentHash).toBe(contentHash(call.specJson));
    expect(result.version.version_no).toBe(1);
    expect(result.version).not.toHaveProperty('spec');
    expect(result.definition.current_version).toMatchObject({ id: 'v-new' });
  });

  it('hands the database the identity the list columns are set from, and answers with the refreshed row', async () => {
    const draft = cup();
    draft.identity.name = ltext('en', 'Published name');
    draft.identity.summary = ltext('en', 'Published summary');
    draftOf(draft);
    vi.mocked(publishFormatVersion).mockResolvedValue({ versionId: 'v-new', versionNo: 2 });
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion(2));
    // The function wrote the columns in the same transaction as the version; the answer re-reads them afterwards.
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(
      meta({
        visibility: 'league',
        current_version_id: 'v-new',
        name: ltext('en', 'Published name'),
        description: ltext('en', 'Published summary'),
      }),
    );

    const result = await publish(player(), meta({ visibility: 'league', current_version_id: 'v1' }), { draftRev: 4, changelog: null });

    const spec = vi.mocked(publishFormatVersion).mock.calls[0][0].specJson;
    expect(spec.identity.name).toEqual(ltext('en', 'Published name'));
    expect(spec.identity.summary).toEqual(ltext('en', 'Published summary'));
    expect(vi.mocked(getFormatDefinitionMeta).mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(publishFormatVersion).mock.invocationCallOrder[0],
    );
    expect(result.definition.name).toEqual(ltext('en', 'Published name'));
    expect(result.definition.description).toEqual(ltext('en', 'Published summary'));
    // The publish does not write the columns itself: no draft-save write happens.
    expect(saveFormatDraft).not.toHaveBeenCalled();
  });

  it('answers an early 409 with the current revision, before compiling or calling the database function', async () => {
    draftOf(cup(), 7);
    const err = (await failure(publish(player(), meta(), { draftRev: 4, changelog: null }))) as FormatStudioError;
    expect(err.code).toBe('format_stale_revision');
    expect(err.params).toMatchObject({ draft_rev: 7 });
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('refuses a draft with an error diagnostic with 422 and the error count, and calls no function', async () => {
    draftOf({ schema_version: 1, identity: { name: ltext('en', 'x') }, stages: [] });
    const err = (await failure(publish(player(), meta(), { draftRev: 4, changelog: null }))) as FormatStudioError;
    expect(err.code).toBe('format_publish_invalid');
    expect(err.statusCode).toBe(422);
    expect(err.params?.count).toBeGreaterThanOrEqual(1);
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('refuses a gallery definition for its owner and a preset row for a non-admin', async () => {
    const gallery = await failure(publish(player(), meta({ visibility: 'gallery' }), { draftRev: 4, changelog: null }));
    expect(codeOf(gallery)).toBe('format_published_locked');
    const preset = await failure(publish(player(), meta({ kind: 'preset' }), { draftRev: 4, changelog: null }));
    expect(codeOf(preset)).toBe('format_preset_locked');
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expect(publishFormatVersion).not.toHaveBeenCalled();
  });

  it('lets a site admin publish a gallery definition', async () => {
    draftOf(cup());
    vi.mocked(publishFormatVersion).mockResolvedValue({ versionId: 'v-new', versionNo: 2 });
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion(2));
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ visibility: 'gallery' }));
    await publish(player({ playerId: OTHER, isAdmin: true }), meta({ visibility: 'gallery' }), { draftRev: 4, changelog: null });
    expect(publishFormatVersion).toHaveBeenCalledTimes(1);
  });

  it('lets the database function refuse an unchanged draft', async () => {
    draftOf(cup());
    vi.mocked(publishFormatVersion).mockRejectedValue(new FormatStudioError('format_nothing_to_publish'));
    const err = await failure(publish(player(), meta({ current_version_id: 'v1' }), { draftRev: 4, changelog: null }));
    expect(codeOf(err)).toBe('format_nothing_to_publish');
  });

  it('answers format_not_found when the draft is gone', async () => {
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue(null);
    expect(codeOf(await failure(publish(player(), meta(), { draftRev: 4, changelog: null })))).toBe('format_not_found');
  });
});

describe('changeVisibility', () => {
  it('moves an owner between private and league once a version is published', async () => {
    vi.mocked(setFormatVisibility).mockResolvedValue(meta({ visibility: 'league', current_version_id: 'v1' }));
    const updated = await changeVisibility(player(), meta({ current_version_id: 'v1' }), 'league');
    expect(setFormatVisibility).toHaveBeenCalledWith(DEFINITION_ID, 'league');
    expect(updated.visibility).toBe('league');
  });

  it('needs a published version to share, but not to make private', async () => {
    expect(codeOf(await failure(changeVisibility(player(), meta(), 'league')))).toBe('format_not_published');
    expect(codeOf(await failure(changeVisibility(player({ isAdmin: true }), meta(), 'gallery')))).toBe('format_not_published');
    expect(setFormatVisibility).not.toHaveBeenCalled();
    vi.mocked(setFormatVisibility).mockResolvedValue(meta());
    await changeVisibility(player(), meta(), 'private');
    expect(setFormatVisibility).toHaveBeenCalledTimes(1);
  });

  it('refuses the gallery for an owner and any change for another admin', async () => {
    expect(codeOf(await failure(changeVisibility(player(), meta({ current_version_id: 'v1' }), 'gallery')))).toBe('format_visibility_forbidden');
    expect(codeOf(await failure(changeVisibility(player({ playerId: OTHER }), meta({ visibility: 'league' }), 'private')))).toBe('format_visibility_forbidden');
    expect(codeOf(await failure(changeVisibility(player(), meta({ kind: 'preset', current_version_id: 'v1' }), 'private')))).toBe('format_preset_locked');
    expect(setFormatVisibility).not.toHaveBeenCalled();
  });

  it('lets a site admin move a gallery definition', async () => {
    vi.mocked(setFormatVisibility).mockResolvedValue(meta({ visibility: 'private' }));
    await changeVisibility(player({ playerId: OTHER, isAdmin: true }), meta({ visibility: 'gallery', current_version_id: 'v1' }), 'private');
    expect(setFormatVisibility).toHaveBeenCalledWith(DEFINITION_ID, 'private');
  });
});

describe('removeDefinition', () => {
  it('deletes a never-published, unattached definition', async () => {
    vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(0);
    vi.mocked(countFormatVersions).mockResolvedValue(0);
    await removeDefinition(player(), meta());
    expect(deleteFormatDefinition).toHaveBeenCalledWith(DEFINITION_ID);
  });

  it('refuses an attached definition with the count, before looking at versions', async () => {
    vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(2);
    const err = (await failure(removeDefinition(player(), meta()))) as FormatStudioError;
    expect(err.code).toBe('format_attached');
    expect(err.params).toMatchObject({ count: 2 });
    expect(countFormatVersions).not.toHaveBeenCalled();
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });

  it('refuses a definition that has versions', async () => {
    vi.mocked(countSeasonFormatsOfDefinition).mockResolvedValue(0);
    vi.mocked(countFormatVersions).mockResolvedValue(1);
    expect(codeOf(await failure(removeDefinition(player(), meta())))).toBe('format_has_versions');
    expect(deleteFormatDefinition).not.toHaveBeenCalled();
  });

  it('follows the edit rule', async () => {
    expect(codeOf(await failure(removeDefinition(player(), meta({ kind: 'preset' }))))).toBe('format_preset_locked');
    await expect(removeDefinition(player({ playerId: OTHER }), meta({ visibility: 'league' }))).rejects.toMatchObject({ statusCode: 403 });
    expect(countSeasonFormatsOfDefinition).not.toHaveBeenCalled();
  });
});

describe('getFormatDetail', () => {
  const version = (spec: FormatDefinition): FormatVersion => ({
    id: 'v1',
    definition_id: DEFINITION_ID,
    version_no: 1,
    schema_version: 1,
    content_hash: 'h'.repeat(64),
    changelog: null,
    created_by: OWNER,
    created_at: '2026-10-03T00:00:00.000Z',
    spec,
    status: 'published',
  });

  beforeEach(() => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(version(cup()));
    vi.mocked(getFormatDefinitionDraft).mockResolvedValue({ document: cup(), draft_rev: 4 });
    vi.mocked(listFormatVersions).mockResolvedValue([]);
  });

  it('gives the owner the draft, the versions and the check', async () => {
    const detail = await getFormatDetail(player(), meta({ current_version_id: 'v1' }));
    expect(detail.draft).toMatchObject({ draft_rev: 4 });
    expect(detail.check?.ok).toBe(true);
    expect(detail.published?.version_no).toBe(1);
    expect(detail.published?.spec).toBeDefined();
    expect(listFormatVersions).toHaveBeenCalledWith(DEFINITION_ID, 100);
  });

  it('gives another admin only the summary and the published spec: no draft, no versions, no check', async () => {
    const detail = await getFormatDetail(player({ playerId: OTHER }), meta({ visibility: 'league', current_version_id: 'v1' }));
    expect(detail.draft).toBeNull();
    expect(detail.check).toBeNull();
    expect(detail.versions).toEqual([]);
    expect(detail.published).not.toBeNull();
    expect(getFormatDefinitionDraft).not.toHaveBeenCalled();
    expect(listFormatVersions).not.toHaveBeenCalledWith(DEFINITION_ID, 100);
  });

  it('gives a site admin the owner view', async () => {
    const detail = await getFormatDetail(player({ playerId: OTHER, isAdmin: true }), meta());
    expect(detail.draft).not.toBeNull();
  });

  it('has no published block for a definition that was never published', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    const detail = await getFormatDetail(player(), meta());
    expect(detail.published).toBeNull();
    expect(detail.definition.current_version).toBeNull();
  });
});
