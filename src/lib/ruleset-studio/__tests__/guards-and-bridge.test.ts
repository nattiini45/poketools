import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ltext } from '@/lib/format-kit';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import { legacyFormToDocument } from '@/lib/ruleset-kit/legacy';
import type { SessionPlayer } from '@/types/auth';
import type { RulesetFormData } from '@/types/ruleset';
import { newRulesetDocument } from '../document';
import type { RulesetDefinitionMeta, RulesetVersion } from '../library-types';

vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
  requireAnyAdmin: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/resource-admins', () => ({ isResourceAdminFor: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({
  getDefinitionOfVersion: vi.fn(),
  getLatestPublishedRulesetVersion: vi.fn(),
  getRulesetDefinitionMeta: vi.fn(),
  isVersionPinned: vi.fn(),
  publishRulesetVersion: vi.fn(),
  saveRulesetDraft: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ getRulesetById: vi.fn() }));
vi.mock('../library', () => ({ createPublished: vi.fn(), removeDefinition: vi.fn(), toActor: (p: SessionPlayer) => ({ playerId: p.playerId, isAdmin: p.isAdmin }) }));

import { requireAnyAdmin } from '@/lib/auth/helpers';
import { isResourceAdminFor } from '@/lib/supabase/queries/resource-admins';
import {
  getDefinitionOfVersion,
  getLatestPublishedRulesetVersion,
  getRulesetDefinitionMeta,
  isVersionPinned,
  publishRulesetVersion,
  saveRulesetDraft,
} from '@/lib/supabase/queries/ruleset-definitions';
import { getRulesetById } from '@/lib/supabase/queries/rulesets';
import { makeRuleset } from '@/test/ruleset-fixtures';
import { readExposedRuleset } from '../exposure';
import { assertDefinitionsUsable, assertRulesetUsable, requireRulesetOwner, requireRulesetViewer } from '../guards';
import { createLegacyRuleset, deleteLegacyRuleset, isFlatDocument, rulesetToFormData, updateLegacyRuleset } from '../legacy-bridge';
import { createPublished, removeDefinition } from '../library';
import { assertRulesetChangeAllowed, assertRulesetUsableForCreate } from '../pin-change';
import { compileDocument } from '../compile.server';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DEF = '33333333-3333-4333-8333-333333333333';
const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const V2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const LEAGUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const player = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ME, name: 'Admin', isAdmin: false, isResourceAdmin: true, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active', ...overrides,
});
const meta = (overrides: Partial<RulesetDefinitionMeta> = {}): RulesetDefinitionMeta => ({
  id: DEF, slug: 's', name: ltext('en', 'S'), description: null, kind: 'custom', owner_id: OTHER, visibility: 'private', season_id: null,
  forked_from: null, draft_rev: 1, current_version_id: V1, created_at: '', updated_at: '', ...overrides,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAnyAdmin).mockResolvedValue(player());
  vi.mocked(isResourceAdminFor).mockResolvedValue(false);
});

describe('requireRulesetViewer / requireRulesetOwner', () => {
  it('a malformed or unknown id is 404 ruleset_not_found, for everyone', async () => {
    await expect(requireRulesetViewer('nope')).rejects.toMatchObject({ code: 'ruleset_not_found' });
    expect(getRulesetDefinitionMeta).not.toHaveBeenCalled();
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(null);
    await expect(requireRulesetViewer(DEF)).rejects.toMatchObject({ code: 'ruleset_not_found' });
  });

  it('another admin\'s private ruleset is a 403; a shared one is readable but not editable', async () => {
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta());
    await expect(requireRulesetViewer(DEF)).rejects.toMatchObject({ statusCode: 403 });
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta({ visibility: 'gallery' }));
    await expect(requireRulesetViewer(DEF)).resolves.toMatchObject({ definition: { id: DEF } });
    await expect(requireRulesetOwner(DEF)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('the admins of the league that owns a league-made ruleset pass the owner guard (one resource_admins read, only for such rows)', async () => {
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta({ season_id: LEAGUE }));
    vi.mocked(isResourceAdminFor).mockResolvedValue(true);
    const access = await requireRulesetOwner(DEF);
    expect(isResourceAdminFor).toHaveBeenCalledWith(ME, 'season', LEAGUE);
    expect(access.actor.leagueIds).toEqual(new Set([LEAGUE]));

    vi.mocked(isResourceAdminFor).mockClear();
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta({ owner_id: ME }));
    await requireRulesetOwner(DEF);
    expect(isResourceAdminFor).not.toHaveBeenCalled();
  });
});

describe('assertRulesetUsable / assertDefinitionsUsable', () => {
  it('a version id of a ruleset the player may not see is 403 ruleset_forbidden; an unknown one is 404', async () => {
    vi.mocked(getDefinitionOfVersion).mockResolvedValue(null);
    await expect(assertRulesetUsable(player(), V1)).rejects.toMatchObject({ code: 'ruleset_not_found' });
    await expect(assertRulesetUsable(player(), 'nope')).rejects.toMatchObject({ code: 'ruleset_not_found' });
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 1 });
    await expect(assertRulesetUsable(player(), V1)).rejects.toMatchObject({ code: 'ruleset_forbidden', statusCode: 403 });
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta({ owner_id: ME }), version_no: 1 });
    await expect(assertRulesetUsable(player(), V1)).resolves.toMatchObject({ version_no: 1 });
  });

  it('a format that names a ruleset the attacher may not use is format_attach_ruleset_forbidden; an unpublished one is not usable either', async () => {
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValueOnce(meta()).mockResolvedValueOnce(meta({ owner_id: ME, current_version_id: null })).mockResolvedValueOnce(null);
    await expect(assertDefinitionsUsable(player(), [DEF])).rejects.toMatchObject({ code: 'format_attach_ruleset_forbidden', statusCode: 403 });
    await expect(assertDefinitionsUsable(player(), [DEF])).rejects.toMatchObject({ code: 'format_attach_ruleset_forbidden' });
    // An id that names nothing is the compile's business (ruleset_not_found diagnostic).
    await expect(assertDefinitionsUsable(player(), [DEF])).resolves.toBeUndefined();
  });
});

describe('exposure and pin changes', () => {
  it('a version of a private ruleset is read only while a league pins it', async () => {
    vi.mocked(getRulesetById).mockResolvedValue(makeRuleset({ id: V1 }));
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta({ visibility: 'private' }), version_no: 1 });
    vi.mocked(isVersionPinned).mockResolvedValue(false);
    expect(await readExposedRuleset(V1)).toBeNull();
    vi.mocked(isVersionPinned).mockResolvedValue(true);
    expect(await readExposedRuleset(V1)).toMatchObject({ id: V1 });
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta({ visibility: 'gallery' }), version_no: 1 });
    vi.mocked(isVersionPinned).mockClear();
    expect(await readExposedRuleset(V1)).toMatchObject({ id: V1 });
    expect(isVersionPinned).not.toHaveBeenCalled();
    vi.mocked(getDefinitionOfVersion).mockResolvedValue(null);
    expect(await readExposedRuleset(V2)).toBeNull();
  });

  it('resending the stored ruleset or sending none is no change and checks nothing', async () => {
    for (const requested of [undefined, null, V1]) {
      await assertRulesetChangeAllowed({ player: player(), current: V1, requested, started: true });
    }
    await assertRulesetUsableForCreate(player(), undefined);
    expect(getDefinitionOfVersion).not.toHaveBeenCalled();
  });

  it('a new ruleset must be usable; once started the pin moves only through the pin route', async () => {
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta({ owner_id: ME }), version_no: 2 });
    await expect(assertRulesetChangeAllowed({ player: player(), current: V1, requested: V2, started: false })).resolves.toBeUndefined();
    await expect(assertRulesetChangeAllowed({ player: player(), current: V1, requested: V2, started: true })).rejects.toMatchObject({ code: 'ruleset_pin_started' });
    // A league that has no ruleset yet may pick one even after it started.
    await expect(assertRulesetChangeAllowed({ player: player(), current: null, requested: V2, started: true })).resolves.toBeUndefined();
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 2 });
    await expect(assertRulesetChangeAllowed({ player: player(), current: V1, requested: V2, started: false })).rejects.toMatchObject({ code: 'ruleset_forbidden' });
    await expect(assertRulesetUsableForCreate(player(), V2)).rejects.toMatchObject({ code: 'ruleset_forbidden' });
  });
});

describe('the legacy builder bridge', () => {
  const form = (overrides: Partial<RulesetFormData> = {}): RulesetFormData => ({
    name: 'Gen 9 OU', base_format: 'gen9ou', is_doubles: false, clauses: ['Species Clause'], banned_pokemon: ['Koraidon'], banned_moves: [], banned_items: [], banned_abilities: [],
    added_pokemon: [], custom_rules_string: '', min_shared_type_pct: 0, team_constraints: null, ...overrides,
  });

  it('knows which documents the flat form can hold', () => {
    expect(isFlatDocument(legacyFormToDocument(form()))).toBe(true);
    expect(isFlatDocument(newRulesetDocument('X', 'en', 'gen9ou'))).toBe(false);
    const allow = legacyFormToDocument(form());
    allow.items.allow = ['leftovers'];
    expect(isFlatDocument(allow)).toBe(false);
    const unban = legacyFormToDocument(form());
    unban.moves.unban = ['x'];
    expect(isFlatDocument(unban)).toBe(false);
  });

  it('round-trips the flat fields of a published ruleset', () => {
    const ruleset = makeRuleset({ name: 'Spring', bans: { pokemon: ['Koraidon'], moves: ['Baton Pass'], items: [], abilities: ['Moody'] }, additions: { pokemon: ['Pikachu'] }, min_shared_type_pct: 40 });
    expect(rulesetToFormData(ruleset)).toMatchObject({ name: 'Spring', banned_pokemon: ['Koraidon'], banned_moves: ['Baton Pass'], banned_abilities: ['Moody'], added_pokemon: ['Pikachu'], min_shared_type_pct: 40 });
  });

  it('create publishes a gallery ruleset owned by the admin from the flat form (ids, blank base, standard universe)', async () => {
    vi.mocked(createPublished).mockResolvedValue({ definitionId: DEF, versionId: V1 });
    vi.mocked(getRulesetById).mockResolvedValue(makeRuleset({ id: V1 }));
    await createLegacyRuleset(ME, form({ banned_pokemon: ['Flabébé', 'Mr. Mime'] }));
    const call = vi.mocked(createPublished).mock.calls[0][0];
    expect(call).toMatchObject({ ownerId: ME, kind: 'custom', visibility: 'gallery', seasonId: null });
    expect(call.document).toMatchObject({ base: { kind: 'blank', gen: 9, universe: 'standard' }, pokemon: { ban: ['flabebe', 'mrmime'] }, identity: { based_on: 'gen9ou' } });
  });

  it('an edit publishes a NEW version of the definition the id belongs to; an edit that changes nothing returns the head', async () => {
    const head = { id: V1, content_hash: 'x', resolved_hash: 'y', spec: legacyFormToDocument(form()) } as unknown as RulesetVersion;
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 1 });
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue(head);
    const current = makeRuleset({ id: V1, name: 'Gen 9 OU', base_format: 'gen9ou', bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] } });
    vi.mocked(getRulesetById).mockResolvedValueOnce(current).mockResolvedValueOnce(makeRuleset({ id: V2, name: 'Gen 9 OU (new)' }));
    vi.mocked(saveRulesetDraft).mockResolvedValue({ draft_rev: 2, updated_at: 'now' });
    vi.mocked(publishRulesetVersion).mockResolvedValue({ versionId: V2, versionNo: 2 });

    const updated = await updateLegacyRuleset(ME, V1, { banned_moves: ['Baton Pass'] });
    expect(updated.id).toBe(V2);
    expect(vi.mocked(publishRulesetVersion).mock.calls[0][0]).toMatchObject({ definitionId: DEF, actorId: ME });
    expect(vi.mocked(publishRulesetVersion).mock.calls[0][0].resolved.moves.ids).toEqual(['batonpass']);

  });

  it('an edit that changes nothing publishes nothing and returns the current head', async () => {
    const current = makeRuleset({ id: V1, name: 'Gen 9 OU', base_format: 'gen9ou', bans: { pokemon: ['Koraidon'], moves: [], items: [], abilities: [] } });
    const doc = legacyFormToDocument(rulesetToFormData(current));
    const { result } = compileDocument(doc);
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 1 });
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue({ id: V1, spec: doc, content_hash: result.content_hash, resolved_hash: result.resolved_hash } as unknown as RulesetVersion);
    vi.mocked(getRulesetById).mockResolvedValue(current);

    expect(await updateLegacyRuleset(ME, V1, {})).toBe(current);
    expect(saveRulesetDraft).not.toHaveBeenCalled();
    expect(publishRulesetVersion).not.toHaveBeenCalled();
  });

  it('a ruleset the flat form cannot hold is read-only here, never flattened', async () => {
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 1 });
    vi.mocked(getRulesetDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getLatestPublishedRulesetVersion).mockResolvedValue({ id: V1, spec: newRulesetDocument('X', 'en', 'gen9ou') } as unknown as RulesetVersion);
    await expect(updateLegacyRuleset(ME, V1, { name: 'New' })).rejects.toMatchObject({ code: 'ruleset_legacy_editor_unsupported' });
    expect(saveRulesetDraft).not.toHaveBeenCalled();
    vi.mocked(getDefinitionOfVersion).mockResolvedValue(null);
    await expect(updateLegacyRuleset(ME, V1, {})).rejects.toMatchObject({ code: 'ruleset_not_found' });
    await expect(deleteLegacyRuleset(player(), V1)).rejects.toMatchObject({ code: 'ruleset_not_found' });
  });

  it('delete removes the definition behind the version id through the library rule', async () => {
    vi.mocked(getDefinitionOfVersion).mockResolvedValue({ definition: meta(), version_no: 1 });
    vi.mocked(removeDefinition).mockResolvedValue(undefined);
    await deleteLegacyRuleset(player({ isAdmin: true }), V1);
    expect(removeDefinition).toHaveBeenCalledWith({ playerId: ME, isAdmin: true }, expect.objectContaining({ id: DEF }));
  });
});

describe('rulesFromBans fixture parity', () => {
  it('the bridge document and the fixture agree on what a ban list means', () => {
    expect(rulesFromBans({ gen: 9, bans: { pokemon: ['Mr. Mime'] } }).pokemon.ids).toEqual(legacyFormToDocument({ name: 'x', base_format: 'gen9', is_doubles: false, clauses: [], banned_pokemon: ['Mr. Mime'], banned_moves: [], banned_items: [], banned_abilities: [], added_pokemon: [], custom_rules_string: '', min_shared_type_pct: 0, team_constraints: null }).pokemon.ban);
  });
});
