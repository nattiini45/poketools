import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, compile, contentHash, type FormatDefinition } from '@/lib/format-kit';
import type { Season } from '@/types/season';
import type { SessionPlayer } from '@/types/auth';
import { FormatStudioError } from '../errors';
import type { FormatDefinitionMeta, FormatVersion, SeasonFormatSummary } from '../library-types';

vi.mock('@/lib/supabase/queries/seasons', () => ({ getSeasonById: vi.fn() }));
vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  getFormatDefinitionMeta: vi.fn(),
  getFormatVersion: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({
  attachSeasonFormat: vi.fn(),
  detachSeasonFormat: vi.fn(),
  getExistingRulesetIds: vi.fn(),
  getSeasonFormatSummary: vi.fn(),
  getSeasonManualPhaseCount: vi.fn(),
  getSeasonShowdownRulesets: vi.fn(),
  getSeasonStartSignals: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/rulesets', () => ({ createRuleset: vi.fn(), deleteRuleset: vi.fn() }));
// The real compile, spied on, to see the environment attach hands it.
vi.mock('@/lib/format-kit/compile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/format-kit/compile')>();
  return { ...actual, compile: vi.fn(actual.compile) };
});

import { compile as compileSpy } from '@/lib/format-kit/compile';
import { getFormatDefinitionMeta, getFormatVersion, getLatestPublishedVersion } from '@/lib/supabase/queries/format-definitions';
import {
  attachSeasonFormat,
  detachSeasonFormat,
  getExistingRulesetIds,
  getSeasonFormatSummary,
  getSeasonManualPhaseCount,
  getSeasonShowdownRulesets,
  getSeasonStartSignals,
} from '@/lib/supabase/queries/season-formats';
import { createRuleset, deleteRuleset } from '@/lib/supabase/queries/rulesets';
import { getSeasonById } from '@/lib/supabase/queries/seasons';
import {
  assertFormatTypeChangeAllowed,
  assertSeasonFormatAttached,
  attachFormatToSeason,
  detachFormatFromSeason,
} from '../attach';

const SEASON_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEFINITION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RULESET = '00000000-0000-4000-8000-000000000001';
const STAGE_GROUPS = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const STAGE_KNOCKOUT = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const STAGE_OLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const NEW_RULESET = '00000000-0000-4000-8000-0000000000cc';
const OLD_RULESET = '00000000-0000-4000-8000-0000000000dd';

const actor = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
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

const season = (overrides: Partial<Season> = {}): Season =>
  ({
    id: SEASON_ID,
    name: 'League',
    description: '',
    format_type: 'custom',
    ruleset_id: RULESET,
    status: 'upcoming',
    language: 'en',
    ...overrides,
  }) as Season;

const definitionMeta = (overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta => ({
  id: DEFINITION_ID,
  slug: 'spring-cup',
  name: { base: 'en', en: { v: 'Spring cup', s: 'human' } },
  description: null,
  kind: 'custom',
  owner_id: OWNER,
  visibility: 'private',
  forked_from: null,
  draft_rev: 2,
  current_version_id: 'v1',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

/** A stored version: the parsed cup example and the hash publish stored with it. */
function storedVersion(mutate?: (spec: FormatDefinition) => void, overrides: Partial<FormatVersion> = {}): FormatVersion {
  const parsed = compile(PRESETS.find((p) => p.id === 'cup')!.definition).definition as FormatDefinition;
  const spec = structuredClone(parsed) as FormatDefinition;
  mutate?.(spec);
  return {
    id: 'v1',
    definition_id: DEFINITION_ID,
    version_no: 3,
    schema_version: 1,
    content_hash: contentHash(spec),
    changelog: null,
    created_by: OWNER,
    created_at: '2026-10-03T00:00:00.000Z',
    spec,
    status: 'published',
    ...overrides,
  };
}

const summary: SeasonFormatSummary = {
  season_id: SEASON_ID,
  definition_id: DEFINITION_ID,
  version_no: 3,
  spec_hash: 'h'.repeat(64),
  tunables: {},
  engine: 'kit',
  frozen_at: '2026-10-05T00:00:00.000Z',
  amendments: [],
};

const upcoming = { status: 'upcoming' as const, phases: [] };

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
  vi.clearAllMocks();
  vi.mocked(getSeasonById).mockResolvedValue(season());
  vi.mocked(getSeasonStartSignals).mockResolvedValue(upcoming);
  vi.mocked(getFormatDefinitionMeta).mockResolvedValue(definitionMeta());
  vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion());
  vi.mocked(getFormatVersion).mockResolvedValue(storedVersion());
  vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set());
  vi.mocked(getSeasonManualPhaseCount).mockResolvedValue(0);
  vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary);
  vi.mocked(getSeasonShowdownRulesets).mockResolvedValue({});
  vi.mocked(createRuleset).mockImplementation(
    async (input) => ({ id: NEW_RULESET, name: input.name }) as Awaited<ReturnType<typeof createRuleset>>,
  );
  vi.mocked(deleteRuleset).mockResolvedValue(undefined);
  vi.mocked(attachSeasonFormat).mockResolvedValue({
    replaced: false,
    stages: [
      { id: STAGE_KNOCKOUT, key: 'knockout' },
      { id: STAGE_GROUPS, key: 'groups' },
    ],
    removed_stage_ids: [],
    removed_ruleset_ids: [],
  });
});

describe('attachFormatToSeason: refusals, in order, with no database function call', () => {
  const attach = (extra: { versionNo?: number; actor?: SessionPlayer } = {}) =>
    attachFormatToSeason({ actor: extra.actor ?? actor(), seasonId: SEASON_ID, definitionId: DEFINITION_ID, versionNo: extra.versionNo });

  it('1. a missing league is a 404 season_not_found and nothing else is read', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    const err = (await failure(attach())) as { code: string; statusCode: number };
    expect(err).toMatchObject({ code: 'season_not_found', statusCode: 404 });
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('1. a league of a legacy type answers format_season_not_custom', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    const err = await failure(attach());
    expect(codeOf(err)).toBe('format_season_not_custom');
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('2. a started league answers format_season_started (active status, a phase that left upcoming, a round)', async () => {
    for (const signals of [
      { status: 'active' as const, phases: [] },
      { status: 'upcoming' as const, phases: [{ status: 'active' as const, rounds_total: 0 }] },
      { status: 'upcoming' as const, phases: [{ status: 'upcoming' as const, rounds_total: 1 }] },
    ]) {
      vi.mocked(getSeasonStartSignals).mockResolvedValue(signals);
      expect(codeOf(await failure(attach()))).toBe('format_season_started');
    }
    expect(getFormatDefinitionMeta).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('3. an unknown definition answers format_not_found', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(null);
    expect(codeOf(await failure(attach()))).toBe('format_not_found');
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('3. a private definition of another owner answers 403 format_attach_forbidden', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(definitionMeta({ owner_id: OTHER, visibility: 'private' }));
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.code).toBe('format_attach_forbidden');
    expect(err.statusCode).toBe(403);
    expect(getLatestPublishedVersion).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it.each(['league', 'gallery'] as const)('3. a %s definition of another owner may be attached', async (visibility) => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(definitionMeta({ owner_id: OTHER, visibility }));
    await attach();
    expect(attachSeasonFormat).toHaveBeenCalledTimes(1);
  });

  it('3. a site admin may attach any definition', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(definitionMeta({ owner_id: OTHER, visibility: 'private' }));
    await attach({ actor: actor({ playerId: '33333333-3333-4333-8333-333333333333', isAdmin: true }) });
    expect(attachSeasonFormat).toHaveBeenCalledTimes(1);
  });

  it('3. a definition with no published version answers format_not_published', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
    expect(codeOf(await failure(attach()))).toBe('format_not_published');
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('3. an explicit version number that does not exist (or is not published) answers format_not_published', async () => {
    vi.mocked(getFormatVersion).mockResolvedValue(null);
    expect(codeOf(await failure(attach({ versionNo: 9 })))).toBe('format_not_published');
    expect(getFormatVersion).toHaveBeenCalledWith(DEFINITION_ID, 9);
    expect(getLatestPublishedVersion).not.toHaveBeenCalled();
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion(undefined, { status: 'draft' }));
    expect(codeOf(await failure(attach({ versionNo: 3 })))).toBe('format_not_published');
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('4. a stored spec that no longer matches its hash is a data fault: a plain Error, logged with ids, no detail', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion(undefined, { content_hash: '0'.repeat(64) }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = await failure(attach());
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FormatStudioError);
    expect((err as Error).message).not.toContain('0000');
    expect(log).toHaveBeenCalledWith(expect.stringContaining(DEFINITION_ID));
    expect(getExistingRulesetIds).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('5. a spec with an error diagnostic answers 422 format_attach_invalid with the first error code', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(
      storedVersion((spec) => {
        spec.edges[0].to = 'nowhere';
      }),
    );
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.code).toBe('format_attach_invalid');
    expect(err.statusCode).toBe(422);
    expect(err.params).toEqual({ first: 'ref_unknown_stage' });
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('5. a ruleset that does not exist is an error, checked against the rulesets of the database', async () => {
    const version = storedVersion((spec) => {
      spec.stages[1].ruleset = { kind: 'ruleset', id: '00000000-0000-4000-8000-0000000000aa' };
    });
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(version);
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.params).toEqual({ first: 'ruleset_not_found' });
    expect(getExistingRulesetIds).toHaveBeenCalledWith(['00000000-0000-4000-8000-0000000000aa']);

    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set(['00000000-0000-4000-8000-0000000000aa']));
    await attach();
    expect(attachSeasonFormat).toHaveBeenCalledTimes(1);
  });

  it('6. a season_default stage in a league without a ruleset answers format_attach_ruleset_required with the count', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ ruleset_id: null }));
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.code).toBe('format_attach_ruleset_required');
    expect(err.params).toEqual({ count: 2 });
    expect(getSeasonManualPhaseCount).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });

  it('6. a league without a ruleset is fine when every stage names one', async () => {
    const rulesetId = '00000000-0000-4000-8000-0000000000bb';
    vi.mocked(getSeasonById).mockResolvedValue(season({ ruleset_id: null }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(
      storedVersion((spec) => {
        for (const stage of spec.stages) stage.ruleset = { kind: 'ruleset', id: rulesetId };
      }),
    );
    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set([rulesetId]));
    await attach();
    const rows = vi.mocked(attachSeasonFormat).mock.calls[0][0].stages;
    expect(rows.map((r) => r.ruleset_id)).toEqual([rulesetId, rulesetId]);
  });

  it('7. a league with a hand-made phase answers format_attach_manual_phases with the count', async () => {
    vi.mocked(getSeasonManualPhaseCount).mockResolvedValue(2);
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.code).toBe('format_attach_manual_phases');
    expect(err.params).toEqual({ count: 2 });
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });
});

describe('attachFormatToSeason: the write', () => {
  const attach = (versionNo?: number) => attachFormatToSeason({ actor: actor(), seasonId: SEASON_ID, definitionId: DEFINITION_ID, versionNo });

  it('sends the frozen spec and the hash of the STORED version, with the planned stages', async () => {
    const version = storedVersion();
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(version);
    await attach();

    const input = vi.mocked(attachSeasonFormat).mock.calls[0][0];
    expect(input.seasonId).toBe(SEASON_ID);
    expect(input.definitionId).toBe(DEFINITION_ID);
    expect(input.versionNo).toBe(3);
    expect(input.spec).toBe(version.spec);
    expect(input.specHash).toBe(version.content_hash);
    expect(input.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(input.stages.map((s) => [s.key, s.stage_order, s.bracket_type, s.ruleset_id])).toEqual([
      ['groups', 1, 'round_robin', RULESET],
      ['knockout', 2, 'single_elim', RULESET],
    ]);
    expect(input.stages.every((s) => s.stage_spec.spec_hash === version.content_hash)).toBe(true);
  });

  it('uses the version named by the caller', async () => {
    await attach(3);
    expect(getFormatVersion).toHaveBeenCalledWith(DEFINITION_ID, 3);
    expect(getLatestPublishedVersion).not.toHaveBeenCalled();
  });

  it('compiles with the rulesets that exist and without a roster size', async () => {
    await attach();
    // The last call is attach's; the fixture helper compiles without an environment before it.
    const env = vi.mocked(compileSpy).mock.calls.at(-1)?.[1];
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty('rosterSize');
    expect(env?.rulesetIds).toBeInstanceOf(Set);
    expect(env?.matchModel).toEqual({ draws: false, forfeits: false, maxPlayersPerMatch: 2 });
  });

  it('draws a new seed on every attach', async () => {
    await attach();
    await attach();
    const seeds = vi.mocked(attachSeasonFormat).mock.calls.map(([input]) => input.seed);
    expect(seeds[0]).not.toBe(seeds[1]);
  });

  it('returns the stages in stage order with their bracket types, the warnings and the stage ids to expire', async () => {
    const outcome = await attach();
    expect(outcome.replaced).toBe(false);
    expect(outcome.stages).toEqual([
      { id: STAGE_GROUPS, key: 'groups', bracket_type: 'round_robin', stage_order: 1 },
      { id: STAGE_KNOCKOUT, key: 'knockout', bracket_type: 'single_elim', stage_order: 2 },
    ]);
    expect(outcome.warnings).toEqual([{ code: 'groups_not_created', stage: 'groups', params: { count: 4, method: 'serpentine' } }]);
    expect(outcome.season_format).toBe(summary);
    expect(outcome.definition).toEqual({ id: DEFINITION_ID, slug: 'spring-cup' });
    expect(outcome.version_no).toBe(3);
    expect(outcome.touched_stage_ids.sort()).toEqual([STAGE_GROUPS, STAGE_KNOCKOUT].sort());
  });

  it('a re-attach replaces: the flag is passed through and removed stages are expired too', async () => {
    vi.mocked(attachSeasonFormat).mockResolvedValue({
      replaced: true,
      stages: [
        { id: STAGE_GROUPS, key: 'groups' },
        { id: STAGE_KNOCKOUT, key: 'knockout' },
      ],
      removed_stage_ids: [STAGE_OLD],
      removed_ruleset_ids: [],
    });
    const outcome = await attach();
    expect(outcome.replaced).toBe(true);
    expect(outcome.touched_stage_ids).toContain(STAGE_OLD);
  });

  it('lets a database refusal through (the function repeats the started and manual-phase checks under a lock)', async () => {
    vi.mocked(attachSeasonFormat).mockRejectedValue(new FormatStudioError('format_season_started'));
    expect(codeOf(await failure(attach()))).toBe('format_season_started');
  });
});

describe('attachFormatToSeason: Showdown stages', () => {
  const attach = () => attachFormatToSeason({ actor: actor(), seasonId: SEASON_ID, definitionId: DEFINITION_ID });
  const showdownVersion = (formats: [string, string] = ['gen9ou', 'gen9ou']) =>
    storedVersion((spec) => {
      spec.stages[0].ruleset = { kind: 'showdown', format: formats[0] };
      spec.stages[1].ruleset = { kind: 'showdown', format: formats[1] };
    });

  it('a league without a ruleset is fine when every stage names a Showdown format', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ ruleset_id: null }));
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion());
    await attach();
    expect(attachSeasonFormat).toHaveBeenCalledTimes(1);
  });

  it('creates one ruleset per distinct format, built like the ruleset builder pre-fill, and points the stages at it', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion());
    const outcome = await attach();

    expect(createRuleset).toHaveBeenCalledTimes(1);
    const [form, createdBy] = vi.mocked(createRuleset).mock.calls[0];
    expect(createdBy).toBe(OWNER);
    expect(form).toMatchObject({ name: 'League \u00b7 Gen 9 OU', base_format: 'gen9ou', is_doubles: false, banned_abilities: [], added_pokemon: [] });
    expect(form.clauses).toEqual(expect.arrayContaining(['Species Clause', 'Terastal Clause']));
    expect(form.banned_pokemon.length).toBeGreaterThan(0);

    const input = vi.mocked(attachSeasonFormat).mock.calls[0][0];
    expect(input.stages.map((row) => row.ruleset_id)).toEqual([NEW_RULESET, NEW_RULESET]);
    expect(input.showdownRulesets).toEqual({ gen9ou: NEW_RULESET });
    // The frozen stage keeps the Showdown pick; the row holds the created ruleset.
    expect(input.stages[0].stage_spec.stage.ruleset).toEqual({ kind: 'showdown', format: 'gen9ou' });
    expect(outcome.rulesets_changed).toBe(true);
  });

  it('one ruleset per format when the stages name two different ones', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion(['gen9ou', 'gen9vgc']));
    let n = 0;
    vi.mocked(createRuleset).mockImplementation(
      async (input) => ({ id: `00000000-0000-4000-8000-00000000010${n++}`, name: input.name }) as Awaited<ReturnType<typeof createRuleset>>,
    );
    await attach();
    expect(vi.mocked(createRuleset).mock.calls.map(([form]) => form.base_format)).toEqual(['gen9ou', 'gen9vgc']);
    const input = vi.mocked(attachSeasonFormat).mock.calls[0][0];
    expect(Object.keys(input.showdownRulesets).sort()).toEqual(['gen9ou', 'gen9vgc']);
    expect(new Set(input.stages.map((row) => row.ruleset_id)).size).toBe(2);
  });

  it('a re-attach reuses the ruleset the league already holds for the format (the admin keeps their edits)', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion());
    vi.mocked(getSeasonShowdownRulesets).mockResolvedValue({ gen9ou: OLD_RULESET });
    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set([OLD_RULESET]));
    const outcome = await attach();
    expect(createRuleset).not.toHaveBeenCalled();
    expect(vi.mocked(attachSeasonFormat).mock.calls[0][0].showdownRulesets).toEqual({ gen9ou: OLD_RULESET });
    expect(outcome.rulesets_changed).toBe(false);
  });

  it('a spec without a Showdown stage reads no recorded rulesets and creates none', async () => {
    const outcome = await attach();
    expect(getSeasonShowdownRulesets).not.toHaveBeenCalled();
    expect(createRuleset).not.toHaveBeenCalled();
    expect(vi.mocked(attachSeasonFormat).mock.calls[0][0].showdownRulesets).toEqual({});
    expect(outcome.rulesets_changed).toBe(false);
  });

  it('reports a change of the ruleset list when the database function removed an old ruleset', async () => {
    vi.mocked(attachSeasonFormat).mockResolvedValue({
      replaced: true,
      stages: [
        { id: STAGE_GROUPS, key: 'groups' },
        { id: STAGE_KNOCKOUT, key: 'knockout' },
      ],
      removed_stage_ids: [],
      removed_ruleset_ids: [OLD_RULESET],
    });
    expect((await attach()).rulesets_changed).toBe(true);
  });

  it('discards the rulesets it created when the database function refuses, and rethrows', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion());
    vi.mocked(attachSeasonFormat).mockRejectedValue(new FormatStudioError('format_season_started'));
    expect(codeOf(await failure(attach()))).toBe('format_season_started');
    expect(deleteRuleset).toHaveBeenCalledWith(NEW_RULESET);
  });

  it('does not discard a reused ruleset when the database function refuses', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion());
    vi.mocked(getSeasonShowdownRulesets).mockResolvedValue({ gen9ou: OLD_RULESET });
    vi.mocked(getExistingRulesetIds).mockResolvedValue(new Set([OLD_RULESET]));
    vi.mocked(attachSeasonFormat).mockRejectedValue(new FormatStudioError('format_season_started'));
    await failure(attach());
    expect(deleteRuleset).not.toHaveBeenCalled();
  });

  it('a format the catalog does not know is a compile error and creates nothing', async () => {
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(showdownVersion(['gen99xx', 'gen9ou']));
    const err = (await failure(attach())) as FormatStudioError;
    expect(err.code).toBe('format_attach_invalid');
    expect(err.params).toEqual({ first: 'showdown_format_unknown' });
    expect(createRuleset).not.toHaveBeenCalled();
    expect(attachSeasonFormat).not.toHaveBeenCalled();
  });
});

describe('detachFormatFromSeason', () => {
  it('returns the removed stage ids and the rulesets the attach had created', async () => {
    vi.mocked(detachSeasonFormat).mockResolvedValue({ removed_stage_ids: [STAGE_GROUPS], removed_ruleset_ids: [OLD_RULESET] });
    await expect(detachFormatFromSeason(SEASON_ID)).resolves.toEqual({
      removed_stage_ids: [STAGE_GROUPS],
      removed_ruleset_ids: [OLD_RULESET],
    });
    expect(detachSeasonFormat).toHaveBeenCalledWith(SEASON_ID);
  });

  it('lets the typed refusals of the function through', async () => {
    vi.mocked(detachSeasonFormat).mockRejectedValue(new FormatStudioError('format_nothing_attached'));
    expect(codeOf(await failure(detachFormatFromSeason(SEASON_ID)))).toBe('format_nothing_attached');
  });
});

describe('assertSeasonFormatAttached', () => {
  it('passes when a format is attached', async () => {
    await expect(assertSeasonFormatAttached(SEASON_ID)).resolves.toBeUndefined();
  });

  it('answers 409 format_not_attached when none is', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    const err = (await failure(assertSeasonFormatAttached(SEASON_ID))) as FormatStudioError;
    expect(err.code).toBe('format_not_attached');
    expect(err.statusCode).toBe(409);
  });
});

describe('assertFormatTypeChangeAllowed', () => {
  it('reads nothing but the league for a change between legacy types', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    await expect(assertFormatTypeChangeAllowed(SEASON_ID, 'doubles')).resolves.toBeUndefined();
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
    expect(getSeasonStartSignals).not.toHaveBeenCalled();
  });

  it('reads nothing more when the type does not change', async () => {
    await expect(assertFormatTypeChangeAllowed(SEASON_ID, 'custom')).resolves.toBeUndefined();
    expect(getSeasonFormatSummary).not.toHaveBeenCalled();
  });

  it('allows a switch to custom while the league is upcoming and unattached', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    await expect(assertFormatTypeChangeAllowed(SEASON_ID, 'custom')).resolves.toBeUndefined();
  });

  it('refuses a switch to custom after the league started', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(season({ format_type: 'singles' }));
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    vi.mocked(getSeasonStartSignals).mockResolvedValue({ status: 'active', phases: [] });
    expect(codeOf(await failure(assertFormatTypeChangeAllowed(SEASON_ID, 'custom')))).toBe('season_format_type_locked');
  });

  it('refuses a switch away from custom while a format is attached', async () => {
    expect(codeOf(await failure(assertFormatTypeChangeAllowed(SEASON_ID, 'singles')))).toBe('season_format_type_locked');
  });

  it('allows a switch away from custom once the format is detached', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(null);
    await expect(assertFormatTypeChangeAllowed(SEASON_ID, 'singles')).resolves.toBeUndefined();
  });

  it('leaves a missing league to the update', async () => {
    vi.mocked(getSeasonById).mockResolvedValue(null);
    await expect(assertFormatTypeChangeAllowed(SEASON_ID, 'custom')).resolves.toBeUndefined();
  });
});
