import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ltext } from '@/lib/studio-core/ltext';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import { newRulesetDocument } from '../document';
import type { RulesetDefinitionMeta, RulesetVersion } from '../library-types';
import type { SessionPlayer } from '@/types/auth';

vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  countOwnedRulesetDefinitions: vi.fn(),
  createRulesetDefinition: vi.fn(),
  deleteRulesetDefinition: vi.fn(),
  getLatestPublishedRulesetVersion: vi.fn(),
  getRulesetDefinitionDraft: vi.fn(),
  getRulesetDefinitionMeta: vi.fn(),
  getRulesetVersion: vi.fn(),
  listPinnedTargets: vi.fn(),
  listRulesetVersions: vi.fn(),
  listVersionIds: vi.fn(),
  publishRulesetVersion: vi.fn(),
  saveRulesetDraft: vi.fn(),
  setRulesetVisibility: vi.fn(),
  getDefinitionOfVersion: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/players', () => ({ resolvePlayerNames: vi.fn(async () => ({})) }));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));

import {
  countOwnedRulesetDefinitions,
  createRulesetDefinition,
  deleteRulesetDefinition,
  getLatestPublishedRulesetVersion,
  getRulesetDefinitionDraft,
  getRulesetDefinitionMeta,
  getRulesetVersion,
  listPinnedTargets,
  listRulesetVersions,
  listVersionIds,
  publishRulesetVersion,
  saveRulesetDraft,
  setRulesetVisibility,
} from '@/lib/supabase/queries/ruleset-definitions';
import {
  MAX_OWNED_RULESETS,
  assertCanEditDraft,
  changeVisibility,
  checkDocument,
  createFromBody,
  createPublished,
  forkDefinition,
  forkPreset,
  publish,
  removeDefinition,
  saveDraft,
} from '../library';
import { RulesetStudioError } from '../errors';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: OWNER,
  name: 'League Admin',
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
  ...overrides,
});

const meta = (overrides: Partial<RulesetDefinitionMeta> = {}): RulesetDefinitionMeta => ({
  id: ID,
  slug: 'spring-ou',
  name: ltext('en', 'Spring OU'),
  description: null,
  kind: 'custom',
  owner_id: OWNER,
  visibility: 'private',
  season_id: null,
  forked_from: null,
  draft_rev: 3,
  current_version_id: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

const document = (preset = 'gen9ou') => newRulesetDocument('Spring OU', 'en', preset) as unknown as Record<string, unknown>;
/** A document whose identity holds the given `based_on` (`undefined`: none). */
const documentBasedOn = (basedOn: string | undefined): Record<string, unknown> => {
  const doc = document();
  const identity = { ...(doc.identity as Record<string, unknown>) };
  if (basedOn === undefined) delete identity.based_on;
  else identity.based_on = basedOn;
  return { ...doc, identity };
};
const slugTaken = () => new RulesetStudioError('ruleset_slug_taken');
const codeOf = async (promise: Promise<unknown>) => ((await promise.then(() => null, (e: unknown) => e)) as RulesetStudioError | null)?.code;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(countOwnedRulesetDefinitions).mockResolvedValue(0);
  vi.mocked(createRulesetDefinition).mockImplementation(async (input) => meta({ slug: input.slug, name: input.name, forked_from: input.forkedFrom }));
  vi.mocked(listRulesetVersions).mockResolvedValue([]);
  vi.mocked(deleteRulesetDefinition).mockResolvedValue(undefined);
});

describe('checkDocument', () => {
  it('compiles with the dex-backed preset: a clean preset document is ok and carries both hashes', () => {
    const check = checkDocument(document());
    expect(check.ok).toBe(true);
    expect(check.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(check.resolved_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('puts errors first and caps the list', () => {
    const doc = document();
    doc.clauses = { add: ['madeupclause'], remove: [] };
    const check = checkDocument(doc);
    expect(check.ok).toBe(false);
    expect(check.diagnostics[0]).toMatchObject({ code: 'unknown_clause', severity: 'error' });
  });
});

describe('create, fork', () => {
  it('creates a private custom definition from a name and a preset, owned by the caller', async () => {
    const created = await createFromBody(player(), { name: 'Spring OU', base_locale: 'en', preset: 'gen9ou' });
    expect(vi.mocked(createRulesetDefinition).mock.calls[0][0]).toMatchObject({ slug: 'spring-ou', ownerId: OWNER, forkedFrom: null });
    expect(created.definition.owner).toEqual({ id: OWNER, name: 'League Admin' });
    expect(created.check.ok).toBe(true);
  });

  it('retries a taken generated slug with suffixes, and answers ruleset_slug_taken for an explicit one', async () => {
    vi.mocked(createRulesetDefinition).mockRejectedValueOnce(slugTaken());
    await createFromBody(player(), { name: 'Spring OU', base_locale: 'en' });
    expect(vi.mocked(createRulesetDefinition).mock.calls.map(([input]) => input.slug)).toEqual(['spring-ou', 'spring-ou-2']);

    vi.mocked(createRulesetDefinition).mockRejectedValue(slugTaken());
    expect(await codeOf(createFromBody(player(), { name: 'Spring OU', base_locale: 'en', slug: 'mine' }))).toBe('ruleset_slug_taken');
  });

  it('refuses a new ruleset beyond the per-owner quota', async () => {
    vi.mocked(countOwnedRulesetDefinitions).mockResolvedValue(MAX_OWNED_RULESETS);
    expect(await codeOf(createFromBody(player(), { name: 'x', base_locale: 'en' }))).toBe('ruleset_owner_quota_exceeded');
    expect(createRulesetDefinition).not.toHaveBeenCalled();
  });

  it('a document without a valid name is refused before the insert', async () => {
    expect(await codeOf(createFromBody(player(), { document: { identity: {} } }))).toBe('ruleset_document_invalid');
    expect(createRulesetDefinition).not.toHaveBeenCalled();
  });

  it('forks the latest published document with forked_from set and a missing based_on filled; a draft only for those who may edit', async () => {
    const source = meta({ id: OTHER, owner_id: OTHER, visibility: 'gallery', slug: 'site-ou' });
    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue({ spec: documentBasedOn(undefined) } as unknown as RulesetVersion);
    await forkDefinition(player(), source, false);
    const input = vi.mocked(createRulesetDefinition).mock.calls[0][0];
    expect(input).toMatchObject({ forkedFrom: OTHER, ownerId: OWNER, slug: 'site-ou-copy' });
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('site-ou');

    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue(null);
    expect(await codeOf(forkDefinition(player(), source, false))).toBe('ruleset_not_published');
    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: document(), draft_rev: 1 });
    await expect(forkDefinition(player(), source, true)).resolves.toBeDefined();
  });

  it('a fork keeps the based_on the source already holds (it decides the format key of a blank base)', async () => {
    const source = meta({ id: OTHER, owner_id: OTHER, visibility: 'gallery', slug: 'r-name-abc123' });
    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue({ spec: documentBasedOn('gen9vgc2025') } as unknown as RulesetVersion);
    await forkDefinition(player(), source, false);
    const input = vi.mocked(createRulesetDefinition).mock.calls[0][0];
    expect((input.document as { identity: { based_on: string } }).identity.based_on).toBe('gen9vgc2025');
    expect(input.forkedFrom).toBe(OTHER);
  });

  it('forks a catalog preset into a document based on it; an unknown preset is ruleset_preset_unknown', async () => {
    await forkPreset(player(), 'gen9ou');
    const input = vi.mocked(createRulesetDefinition).mock.calls[0][0];
    expect((input.document as { base: unknown }).base).toEqual({ kind: 'preset', preset: 'gen9ou' });
    expect(await codeOf(forkPreset(player(), 'gen99zz'))).toBe('ruleset_preset_unknown');
  });

  it('a preset fork without the toggle adds nothing on top of the preset', async () => {
    await forkPreset(player(), 'gen9natdexdraft', { tourOverlay: false });
    const doc = vi.mocked(createRulesetDefinition).mock.calls[0][0].document as unknown as RulesetDocument;
    expect(doc.clauses).toEqual({ add: [], remove: [] });
    expect(doc.moves.ban).toEqual([]);
  });

  it('"add Smogon tour bans" writes the documented extras as ordinary, editable entries and the document stays valid', async () => {
    const created = await forkPreset(player(), 'gen9natdexdraft', { tourOverlay: true });
    const doc = vi.mocked(createRulesetDefinition).mock.calls[0][0].document as unknown as RulesetDocument;
    expect(doc.base).toEqual({ kind: 'preset', preset: 'gen9natdexdraft' });
    // Clauses of the tour, bans of moves, items and abilities; the overlay bans no Pokémon.
    expect(doc.clauses.add.length).toBeGreaterThan(0);
    expect(doc.moves.ban).toEqual(expect.arrayContaining(['hiddenpower', 'lastrespects', 'shedtail']));
    expect(doc.abilities.ban).toEqual(expect.arrayContaining(['moody', 'powerconstruct']));
    expect(doc.items.ban.length).toBeGreaterThan(0);
    expect(doc.pokemon.ban).toEqual([]);
    // Nothing the preset already bans is repeated, so the compile has no redundancy to report.
    expect(created.check.ok).toBe(true);
    expect(created.check.diagnostics.map((d) => d.code)).not.toContain('ban_redundant');
  });

  it('the toggle on a preset without documented extras is ruleset_preset_unknown and creates nothing', async () => {
    expect(await codeOf(forkPreset(player(), 'gen9ou', { tourOverlay: true }))).toBe('ruleset_preset_unknown');
    expect(createRulesetDefinition).not.toHaveBeenCalled();
    expect(await codeOf(createFromBody(player(), { name: 'x', base_locale: 'en', preset: 'gen9ou', tour_overlay: true }))).toBe('ruleset_preset_unknown');
  });

  it('a create body with a name, a preset and the toggle applies it under the typed name', async () => {
    await createFromBody(player(), { name: 'Our NatDex draft', base_locale: 'en', preset: 'gen9natdexdraft', tour_overlay: true });
    const input = vi.mocked(createRulesetDefinition).mock.calls[0][0];
    expect(input.slug).toBe('our-natdex-draft');
    expect((input.document as unknown as RulesetDocument).moves.ban).toContain('hiddenpower');
  });
});

describe('save, publish', () => {
  it('a private definition\'s list name follows the draft; a shared one keeps its columns', async () => {
    vi.mocked(saveRulesetDraft).mockResolvedValue({ draft_rev: 4, updated_at: 'now' });
    const doc = newRulesetDocument('Renamed', 'en', 'gen9ou') as unknown as Record<string, unknown>;
    await saveDraft(meta(), { draftRev: 3, document: doc });
    expect(vi.mocked(saveRulesetDraft).mock.calls[0][0]).toMatchObject({ id: ID, expectedRev: 3, name: ltext('en', 'Renamed') });
    await saveDraft(meta({ visibility: 'league' }), { draftRev: 3, document: doc });
    expect(vi.mocked(saveRulesetDraft).mock.calls[1][0]).not.toHaveProperty('name');
  });

  it('a stale revision is a 409 carrying the current one; a vanished definition a 404', async () => {
    vi.mocked(saveRulesetDraft).mockResolvedValue(null);
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta({ draft_rev: 9 }));
    const err = (await saveDraft(meta(), { draftRev: 3, document: document() }).catch((e: unknown) => e)) as RulesetStudioError;
    expect(err).toMatchObject({ code: 'ruleset_stale_revision', params: { draft_rev: 9 } });
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(null);
    expect(await codeOf(saveDraft(meta(), { draftRev: 3, document: document() }))).toBe('ruleset_not_found');
  });

  it('publishes the parsed document with its frozen resolved rules, both hashes and the catalog version', async () => {
    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: document(), draft_rev: 3 });
    vi.mocked(publishRulesetVersion).mockResolvedValue({ versionId: 'v1', versionNo: 1 });
    vi.mocked(getRulesetVersion).mockResolvedValue({ id: 'v1', version_no: 1, spec: document(), resolved: {}, name_text: 'Spring OU' } as unknown as RulesetVersion);
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta({ current_version_id: 'v1' }));

    const published = await publish(player(), meta(), { draftRev: 3, changelog: null });

    const call = vi.mocked(publishRulesetVersion).mock.calls[0][0];
    expect(call).toMatchObject({ definitionId: ID, expectedRev: 3, actorId: OWNER, changelog: null });
    expect(call.resolved.pokemon.ids.length).toBeGreaterThan(10);
    expect(call.resolved.format_key).toBe('gen9ou');
    expect(call.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.resolvedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.catalogVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(published.version.version_no).toBe(1);
  });

  it('refuses a publish with a compile error, a stale revision, or without the right to publish', async () => {
    const bad = document();
    bad.clauses = { add: ['madeupclause'], remove: [] };
    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: bad, draft_rev: 3 });
    expect(await codeOf(publish(player(), meta(), { draftRev: 3, changelog: null }))).toBe('ruleset_document_invalid');

    vi.mocked(getRulesetDefinitionDraft).mockResolvedValue({ document: document(), draft_rev: 5 });
    expect(await codeOf(publish(player(), meta(), { draftRev: 3, changelog: null }))).toBe('ruleset_stale_revision');

    expect(await codeOf(publish(player(), meta({ visibility: 'gallery' }), { draftRev: 3, changelog: null }))).toBe('ruleset_published_locked');
    expect(await codeOf(publish(player(), meta({ kind: 'preset' }), { draftRev: 3, changelog: null }))).toBe('ruleset_preset_locked');
    expect(publishRulesetVersion).not.toHaveBeenCalled();
  });

  it('createPublished compiles first, publishes version 1 and discards the definition if the publish fails', async () => {
    vi.mocked(publishRulesetVersion).mockResolvedValue({ versionId: 'v1', versionNo: 1 });
    const input = { name: ltext('en', 'League · OU'), slugBase: 'league ou', document: document(), ownerId: OWNER, kind: 'custom' as const, visibility: 'private' as const, seasonId: ID, changelog: null };
    await expect(createPublished(input)).resolves.toEqual({ definitionId: ID, versionId: 'v1' });
    expect(vi.mocked(createRulesetDefinition).mock.calls[0][0]).toMatchObject({ visibility: 'private', seasonId: ID, kind: 'custom' });

    vi.mocked(publishRulesetVersion).mockRejectedValue(new Error('rpc down'));
    await expect(createPublished(input)).rejects.toThrow('rpc down');
    expect(deleteRulesetDefinition).toHaveBeenCalledWith(ID);

    const invalid = { ...input, document: { ...document(), clauses: { add: ['madeupclause'], remove: [] } } };
    expect(await codeOf(createPublished(invalid))).toBe('ruleset_document_invalid');
  });
});

describe('visibility, delete', () => {
  it('sharing needs a published version; the rule decides first', async () => {
    expect(await codeOf(changeVisibility(player(), meta(), 'league'))).toBe('ruleset_not_published');
    expect(await codeOf(changeVisibility(player(), meta(), 'gallery'))).toBe('ruleset_visibility_forbidden');
    expect(await codeOf(changeVisibility(player(), meta({ kind: 'preset' }), 'league'))).toBe('ruleset_preset_locked');
    vi.mocked(setRulesetVisibility).mockResolvedValue(meta({ visibility: 'league', current_version_id: 'v1' }));
    const updated = await changeVisibility(player(), meta({ current_version_id: 'v1' }), 'league');
    expect(updated.visibility).toBe('league');
  });

  it('deleting is refused with the number of pins; an unpinned ruleset is deleted', async () => {
    vi.mocked(listVersionIds).mockResolvedValue(['v1', 'v2']);
    vi.mocked(listPinnedTargets).mockResolvedValue({
      seasons: [{ id: 's1', name: 'L', status: 'active', season_id: null, ruleset_id: 'v1' }],
      tournaments: [{ id: 't1', name: 'P', status: 'active', season_id: 's1', ruleset_id: 'v2' }],
    });
    const err = (await removeDefinition({ playerId: OWNER, isAdmin: false }, meta()).catch((e: unknown) => e)) as RulesetStudioError;
    expect(err).toMatchObject({ code: 'ruleset_in_use', params: { count: 2 } });
    expect(deleteRulesetDefinition).not.toHaveBeenCalled();

    vi.mocked(listPinnedTargets).mockResolvedValue({ seasons: [], tournaments: [] });
    await removeDefinition({ playerId: OWNER, isAdmin: false }, meta());
    expect(deleteRulesetDefinition).toHaveBeenCalledWith(ID);
    await expect(removeDefinition({ playerId: OTHER, isAdmin: false }, meta())).rejects.toMatchObject({ code: 'forbidden', statusCode: 403 });
  });

  it('assertCanEditDraft: a site catalog ruleset answers ruleset_preset_locked, anything else the plain 403', () => {
    const actor = { playerId: OTHER, isAdmin: false };
    expect(() => assertCanEditDraft(actor, meta({ kind: 'preset' }))).toThrow(expect.objectContaining({ code: 'ruleset_preset_locked' }));
    expect(() => assertCanEditDraft(actor, meta())).toThrow(expect.objectContaining({ code: 'forbidden', statusCode: 403 }));
    expect(() => assertCanEditDraft({ playerId: OWNER, isAdmin: false }, meta())).not.toThrow();
  });
});
