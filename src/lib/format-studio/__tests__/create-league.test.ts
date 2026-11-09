import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESETS, compile, contentHash, type FormatDefinition } from '@/lib/format-kit';
import type { SessionPlayer } from '@/types/auth';
import type { Season } from '@/types/season';
import { FormatStudioError } from '../errors';
import type { FormatDefinitionMeta, FormatVersion, SeasonFormatSummary } from '../library-types';

vi.mock('@/lib/supabase/queries/format-definitions', () => ({
  getFormatDefinitionMeta: vi.fn(),
  getFormatVersion: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
}));
vi.mock('@/lib/supabase/queries/season-formats', () => ({ getSeasonFormatSummary: vi.fn() }));
vi.mock('@/lib/supabase/queries/ruleset-definitions', () => ({ resolveNamedRulesets: vi.fn() }));
vi.mock('@/lib/ruleset-studio/guards', () => ({ canUseDefinitions: vi.fn() }));
vi.mock('@/lib/supabase/queries/competition-create', () => ({ createCompetitionFromFormat: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { getFormatDefinitionMeta, getFormatVersion, getLatestPublishedVersion } from '@/lib/supabase/queries/format-definitions';
import { getSeasonFormatSummary } from '@/lib/supabase/queries/season-formats';
import { resolveNamedRulesets } from '@/lib/supabase/queries/ruleset-definitions';
import { canUseDefinitions } from '@/lib/ruleset-studio/guards';
import { createCompetitionFromFormat } from '@/lib/supabase/queries/competition-create';
import { logger } from '@/lib/logger';
import { createLeagueFromFormat } from '../create-league';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const DEFINITION = '33333333-3333-4333-8333-333333333333';
const RULESET_VERSION = '55555555-5555-4555-8555-555555555555';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const actor = (overrides: Partial<SessionPlayer> = {}): SessionPlayer => ({
  playerId: ACTOR,
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

const meta = (overrides: Partial<FormatDefinitionMeta> = {}): FormatDefinitionMeta => ({
  id: DEFINITION,
  slug: 'spring-cup',
  name: { base: 'en', en: { v: 'Spring cup', s: 'human' } },
  description: null,
  kind: 'custom',
  owner_id: ACTOR,
  visibility: 'private',
  forked_from: null,
  draft_rev: 2,
  current_version_id: 'v1',
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

/** A stored version of an example: its parsed spec and the hash publish stored with it. */
function storedVersion(presetId: string, overrides: Partial<FormatVersion> = {}): FormatVersion {
  const spec = structuredClone(compile(PRESETS.find((p) => p.id === presetId)!.definition).definition) as FormatDefinition;
  return {
    id: 'v1',
    definition_id: DEFINITION,
    version_no: 3,
    schema_version: 1,
    content_hash: contentHash(spec),
    changelog: null,
    created_by: ACTOR,
    created_at: '2026-10-03T00:00:00.000Z',
    spec,
    status: 'published',
    ...overrides,
  };
}

const summary = (engine: SeasonFormatSummary['engine']): SeasonFormatSummary => ({
  season_id: 'x',
  definition_id: DEFINITION,
  version_no: 1,
  spec_hash: 'h'.repeat(64),
  tunables: {},
  engine,
  frozen_at: '2026-11-09T00:00:00.000Z',
  amendments: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveNamedRulesets).mockResolvedValue(new Map());
  vi.mocked(canUseDefinitions).mockResolvedValue(true);
  vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary('kit'));
  vi.mocked(createCompetitionFromFormat).mockImplementation(async (input) => ({
    season: { id: input.season.id, name: input.season.name } as Season,
    season_id: input.season.id,
    definition_id: input.format.definition_id,
    version_no: input.format.version_no ?? 1,
    stages: input.stages.map((stage, index) => ({ id: `stage-${index}`, key: stage.key, group: stage.format_group })),
    ruleset_ids: input.rulesets.map((ruleset) => ruleset.id),
  }));
});

describe('createLeagueFromFormat: from an example', () => {
  it('plans the Wichtelcup fork, its preset ruleset and its stages, and writes once', async () => {
    const created = await createLeagueFromFormat({
      actor: actor(),
      season: { name: 'Winter Cup', language: 'en' },
      fromFormat: { preset_id: 'wichtelcup' },
    });

    expect(createCompetitionFromFormat).toHaveBeenCalledTimes(1);
    const input = vi.mocked(createCompetitionFromFormat).mock.calls[0][0];
    expect(input.actorId).toBe(ACTOR);
    expect(input.grantCreator).toBe(true);
    expect(input.season).toEqual({ id: expect.stringMatching(UUID), name: 'Winter Cup', ruleset_id: null, start_date: null, end_date: null, language: 'en' });
    expect(input.format.definition_id).toMatch(UUID);
    expect(input.format.version_no).toBeUndefined();
    expect(input.format.spec_hash).toBe(contentHash(input.format.spec));
    expect(input.format.seed).toMatch(/^[0-9a-f]{32}$/);
    expect(input.format.fork?.slug_candidates.slice(0, 3)).toEqual(['wichtelcup', 'wichtelcup-2', 'wichtelcup-3']);
    expect(input.format.fork?.slug_candidates).toHaveLength(10);
    expect((input.format.fork?.document.identity as { based_on?: string }).based_on).toBe('wichtelcup');

    expect(input.rulesets).toHaveLength(1);
    const [ruleset] = input.rulesets;
    expect(ruleset).toMatchObject({ preset: 'gen9natdexwichtelcup', id: expect.stringMatching(UUID) });
    expect(ruleset.slug_candidates[0]).toBe('winter-cup-gen9natdexwichtelcup');
    expect(ruleset.resolved_hash).toMatch(/^[0-9a-f]{64}$/);
    // The preset stages carry the ruleset DEFINITION id until the function pins the version it publishes.
    expect(input.stages.length).toBeGreaterThan(0);
    for (const stage of input.stages) expect(stage.ruleset_id).toBe(ruleset.id);

    expect(created).toMatchObject({
      season_id: input.season.id,
      format: { definition_id: input.format.definition_id, version_no: 1 },
      preset_id: 'wichtelcup',
      ruleset_ids: [ruleset.id],
    });
    expect(created.stage_ids).toHaveLength(input.stages.length);
  });

  it('grants nothing to a site admin, who administers every league', async () => {
    await createLeagueFromFormat({ actor: actor({ isAdmin: true }), season: { name: 'Cup' }, fromFormat: { preset_id: 'wichtelcup' } });
    expect(vi.mocked(createCompetitionFromFormat).mock.calls[0][0].grantCreator).toBe(false);
  });

  it('pre-picks a rule preset on every stage and names the slug after both', async () => {
    await createLeagueFromFormat({
      actor: actor(),
      season: { name: 'OU Cup' },
      fromFormat: { preset_id: 'cup', ruleset_preset_id: 'gen9ou' },
    });
    const input = vi.mocked(createCompetitionFromFormat).mock.calls[0][0];
    expect(input.format.fork?.slug_candidates[0]).toBe('cup-gen9ou');
    expect(input.rulesets.map((r) => r.preset)).toEqual(['gen9ou']);
  });

  it('refuses an example whose stages need the league default ruleset when none is given, before any write', async () => {
    await expect(
      createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { preset_id: 'cup' } }),
    ).rejects.toMatchObject({ code: 'format_attach_ruleset_required', statusCode: 409 });
    expect(createCompetitionFromFormat).not.toHaveBeenCalled();
  });

  it('pins the league default ruleset on season_default stages', async () => {
    await createLeagueFromFormat({ actor: actor(), season: { name: 'Cup', ruleset_id: RULESET_VERSION }, fromFormat: { preset_id: 'cup' } });
    const input = vi.mocked(createCompetitionFromFormat).mock.calls[0][0];
    expect(input.rulesets).toEqual([]);
    expect(input.season.ruleset_id).toBe(RULESET_VERSION);
    for (const stage of input.stages) expect(stage.ruleset_id).toBe(RULESET_VERSION);
  });

  it('answers format_preset_not_found for an example that does not exist', async () => {
    await expect(
      createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { preset_id: 'nope' } }),
    ).rejects.toMatchObject({ code: 'format_preset_not_found', statusCode: 404 });
    expect(createCompetitionFromFormat).not.toHaveBeenCalled();
  });
});

describe('createLeagueFromFormat: from a stored format', () => {
  it('attaches the requested published version without forking', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getFormatVersion).mockResolvedValue(storedVersion('wichtelcup'));
    const created = await createLeagueFromFormat({
      actor: actor(),
      season: { name: 'Winter Cup' },
      fromFormat: { definition_id: DEFINITION, version_no: 3 },
    });
    expect(getFormatVersion).toHaveBeenCalledWith(DEFINITION, 3);
    const input = vi.mocked(createCompetitionFromFormat).mock.calls[0][0];
    expect(input.format).toMatchObject({ definition_id: DEFINITION, version_no: 3 });
    expect(input.format.fork).toBeUndefined();
    expect(created.preset_id).toBeNull();
  });

  it('takes the latest published version when none is named', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion('wichtelcup'));
    await createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { definition_id: DEFINITION } });
    expect(getLatestPublishedVersion).toHaveBeenCalledWith(DEFINITION);
  });

  it.each([
    ['format_not_found', 404, () => vi.mocked(getFormatDefinitionMeta).mockResolvedValue(null)],
    [
      'format_attach_forbidden',
      403,
      () => vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta({ owner_id: '99999999-9999-4999-8999-999999999999', visibility: 'private' })),
    ],
    [
      'format_not_published',
      409,
      () => {
        vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
        vi.mocked(getLatestPublishedVersion).mockResolvedValue(null);
      },
    ],
    [
      'format_not_published',
      409,
      () => {
        vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
        vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion('wichtelcup', { status: 'draft' }));
      },
    ],
    [
      'format_attach_ruleset_forbidden',
      403,
      () => {
        vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
        vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion('wichtelcup'));
        vi.mocked(canUseDefinitions).mockResolvedValue(false);
      },
    ],
  ])('refuses with %s (%i) before any write', async (code, status, arrange) => {
    arrange();
    await expect(
      createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { definition_id: DEFINITION } }),
    ).rejects.toMatchObject({ code, statusCode: status });
    expect(createCompetitionFromFormat).not.toHaveBeenCalled();
  });

  it('refuses a version whose spec has an error with format_attach_invalid', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
    const version = storedVersion('wichtelcup');
    const broken = { ...version.spec, stages: [] } as FormatDefinition;
    vi.mocked(getLatestPublishedVersion).mockResolvedValue({ ...version, spec: broken, content_hash: contentHash(broken) });
    await expect(
      createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { definition_id: DEFINITION } }),
    ).rejects.toMatchObject({ code: 'format_attach_invalid', statusCode: 422 });
    expect(createCompetitionFromFormat).not.toHaveBeenCalled();
  });

  it('treats a spec that no longer matches its hash as a data fault, logged and never written', async () => {
    vi.mocked(getFormatDefinitionMeta).mockResolvedValue(meta());
    vi.mocked(getLatestPublishedVersion).mockResolvedValue(storedVersion('wichtelcup', { content_hash: 'f'.repeat(64) }));
    const error = await createLeagueFromFormat({ actor: actor(), season: { name: 'Cup' }, fromFormat: { definition_id: DEFINITION } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(FormatStudioError);
    expect(logger.error).toHaveBeenCalled();
    expect(createCompetitionFromFormat).not.toHaveBeenCalled();
  });
});

describe('createLeagueFromFormat: database failures', () => {
  const run = () => createLeagueFromFormat({ actor: actor(), season: { name: 'Winter Cup' }, fromFormat: { preset_id: 'wichtelcup' } });

  it.each([
    [{ code: '23505', message: 'duplicate key value violates unique constraint "format_definitions_slug_key"', details: '', hint: '' }, 'format_slug_taken', 409],
    [{ code: 'P0001', message: 'FORMAT_SEASON_STARTED', details: '', hint: '' }, 'format_season_started', 409],
    [{ code: 'P0001', message: 'RULESET_QUOTA_EXCEEDED', details: '{"max":100}', hint: '' }, 'ruleset_version_quota_exceeded', undefined],
  ])('maps a known database signal to its typed error (%o)', async (dbError, code, status) => {
    vi.mocked(createCompetitionFromFormat).mockRejectedValue(dbError);
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ code });
    if (status !== undefined) expect(error).toMatchObject({ statusCode: status });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('answers season_format_create_failed (500) for any other failure, after logging the original error', async () => {
    const dbError = { code: '22007', message: 'invalid input syntax for type date', details: '', hint: '' };
    vi.mocked(createCompetitionFromFormat).mockRejectedValue(dbError);
    await expect(run()).rejects.toMatchObject({ code: 'season_format_create_failed', statusCode: 500 });
    expect(logger.error).toHaveBeenCalledWith('format-studio/create-league', expect.any(String), { error: dbError });
  });

  it('reports the engine gaps of the engine the league runs on', async () => {
    vi.mocked(getSeasonFormatSummary).mockResolvedValue(summary('legacy'));
    const created = await run();
    expect(Array.isArray(created.warnings)).toBe(true);
  });

  it('still answers the committed league when the engine read after the commit fails', async () => {
    vi.mocked(getSeasonFormatSummary).mockRejectedValue(new Error('read timed out'));
    const created = await run();
    expect(created.season).toMatchObject({ id: created.season_id, name: 'Winter Cup' });
    expect(Array.isArray(created.warnings)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('format-studio/create-league', expect.any(String), expect.objectContaining({ seasonId: created.season_id }));
  });
});
