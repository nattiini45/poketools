import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import { deleteLocalRuleset, insertLocalRuleset } from '@/test/local-rulesets';
import { compile, PRESETS } from '@/lib/format-kit';
import { planStages } from '@/lib/format-studio/materialise';
import type { CompetitionCreateInput } from '@/lib/supabase/queries/competition-create';
import type { AttachRpcInput } from '@/lib/supabase/queries/season-formats';
import type { SessionPlayer } from '@/types/auth';
import type { Database } from '@/types/database';

const optedIn = localStackOptIn('LOCAL_PHASE_FORMAT');
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/auth', () => ({
  auth: () => { throw new Error('This fixture supplies its actor explicitly'); },
  loadSessionPlayer: () => { throw new Error('This fixture supplies its actor explicitly'); },
}));

describe.skipIf(!optedIn)('native format materialisation on the disposable phase-mode stack', () => {
  const actorId = randomUUID();
  const rulesetId = randomUUID();
  const seasonIds: string[] = [];
  const definitionIds: string[] = [];
  const presetRulesetIds: string[] = [];
  let admin: SupabaseClient<Database>;
  let formats: typeof import('@/lib/supabase/queries/season-formats');
  let competitions: typeof import('@/lib/supabase/queries/competition-create');

  const actor: SessionPlayer = {
    playerId: actorId, name: 'Native format fixture', isAdmin: false, isResourceAdmin: true, isCreator: false,
    psUsername: '', championsUsername: '', avatarUrl: null, status: 'active',
  };

  beforeAll(async () => {
    assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, requireLocalKey('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const mode = await admin.from('phase_storage_state').select('mode').single();
    expect(mode.error).toBeNull();
    expect(mode.data?.mode).toBe('phase');
    expect((await admin.from('players').insert({ id: actorId, name: `Native format ${actorId}`, is_guest: true })).error).toBeNull();
    expect((await insertLocalRuleset(admin, { id: rulesetId, name: `Native format ${rulesetId}` })).error).toBeNull();
    [formats, competitions] = await Promise.all([
      import('@/lib/supabase/queries/season-formats'), import('@/lib/supabase/queries/competition-create'),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    if (seasonIds.length > 0) {
      expect((await admin.from('league_phases').delete().in('season_id', seasonIds)).error).toBeNull();
      expect((await admin.from('season_formats').delete().in('season_id', seasonIds)).error).toBeNull();
      expect((await admin.from('resource_admins').delete().eq('resource_type', 'season').in('resource_id', seasonIds)).error).toBeNull();
      expect((await admin.from('seasons').delete().in('id', seasonIds)).error).toBeNull();
    }
    if (presetRulesetIds.length > 0) expect((await admin.from('ruleset_definitions').delete().in('id', presetRulesetIds)).error).toBeNull();
    if (definitionIds.length > 0) expect((await admin.from('format_definitions').delete().in('id', definitionIds)).error).toBeNull();
    expect((await deleteLocalRuleset(admin, rulesetId)).error).toBeNull();
    expect((await admin.from('players').delete().eq('id', actorId)).error).toBeNull();
  }, 60_000);

  function competitionInput(presetId: string): CompetitionCreateInput {
    const preset = PRESETS.find((entry) => entry.id === presetId);
    if (!preset) throw new Error('Synthetic format preset is missing');
    const compiled = compile(preset.definition);
    if (!compiled.ok || !compiled.definition || !compiled.graph || !compiled.plan || !compiled.hash) throw new Error('Synthetic format did not compile');
    const definitionId = randomUUID();
    const seasonId = randomUUID();
    seasonIds.push(seasonId);
    definitionIds.push(definitionId);
    return {
      actorId,
      season: { id: seasonId, name: `Native format ${seasonId}`, ruleset_id: rulesetId, start_date: null, end_date: null, language: 'en' },
      format: {
        definition_id: definitionId, spec: compiled.definition, spec_hash: compiled.hash, seed: randomUUID(),
        fork: { name: compiled.definition.identity.name, description: null, document: preset.definition as unknown as Record<string, unknown>, slug_candidates: [`native-${definitionId}`] },
      },
      rulesets: [],
      stages: planStages({ definition: compiled.definition, graphOrder: compiled.graph.order, plan: compiled.plan, seasonRulesetId: rulesetId, seasonLanguage: 'en', specHash: compiled.hash }).stages,
      grantCreator: true,
    };
  }

  function attachInput(seasonId: string, source: CompetitionCreateInput): AttachRpcInput {
    return {
      seasonId, definitionId: source.format.definition_id, versionNo: 1, spec: source.format.spec,
      specHash: source.format.spec_hash, seed: source.format.seed, stages: source.stages, presetRulesets: {},
    };
  }

  async function phaseRows(seasonId: string) {
    const result = await admin.from('league_phases').select('id, format_stage_key, format_group, bracket_type, ruleset_id, stage_spec, status').eq('season_id', seasonId).order('stage_order').order('id');
    if (result.error) throw result.error;
    return result.data;
  }

  it('attaches, replaces with count-confirmed runtime clearing, and detaches only native stages', async () => {
    const classic = competitionInput('classic-league');
    const cup = competitionInput('cup');
    await competitions.createCompetitionFromFormat(classic, 'native');
    await competitions.createCompetitionFromFormat(cup, 'native');
    const seasonId = randomUUID();
    seasonIds.push(seasonId);
    expect((await admin.from('seasons').insert({ id: seasonId, name: 'Native attach fixture', format_type: 'custom', ruleset_id: rulesetId })).error).toBeNull();

    const first = await formats.attachSeasonFormat(attachInput(seasonId, classic), 'native');
    expect(first).toMatchObject({ replaced: false, removed_stage_ids: [] });
    expect(first.stages).toHaveLength(classic.stages.length);
    const before = await phaseRows(seasonId);
    expect(before.map((row) => row.format_stage_key)).toEqual(classic.stages.map((stage) => stage.key));
    for (const row of before) expect(row).toMatchObject({ ruleset_id: rulesetId, status: 'upcoming' });
    const original = await formats.getSeasonFormat(seasonId);
    expect(original?.spec_hash).toBe(classic.format.spec_hash);
    expect((await admin.from('format_adjustments').insert({ season_id: seasonId, kind: 'points', target: { stage: classic.stages[0].key, player_id: actorId }, delta: { points: 1 }, reason: 'Synthetic replace guard' })).error).toBeNull();
    const replacement = attachInput(seasonId, cup);
    await expect(formats.attachSeasonFormat(replacement, 'native')).rejects.toMatchObject({ code: 'format_runtime_has_data' });
    await expect(formats.attachSeasonFormat({ ...replacement, confirmClear: true, confirmedCounts: { links: 0, items: 0, submissions: 0, adjustments: 0 } }, 'native')).rejects.toMatchObject({ code: 'format_runtime_has_data' });
    expect(await phaseRows(seasonId)).toEqual(before);
    const replaced = await formats.attachSeasonFormat({ ...replacement, confirmClear: true, confirmedCounts: { links: 0, items: 0, submissions: 0, adjustments: 1 } }, 'native');
    expect(replaced).toMatchObject({ replaced: true, cleared: { adjustments: 1, links: 0, items: 0, submissions: 0 } });
    const wanted = new Set(cup.stages.map((stage) => `${stage.key}:${stage.format_group}`));
    expect([...replaced.removed_stage_ids].sort()).toEqual(before.filter((row) => !wanted.has(`${row.format_stage_key}:${row.format_group}`)).map((row) => row.id).sort());
    expect((await phaseRows(seasonId)).map((row) => row.format_stage_key)).toEqual(cup.stages.map((stage) => stage.key));
    expect((await formats.getSeasonFormat(seasonId))?.revision).toBeGreaterThan(original!.revision);
    const adjustments = await admin.from('format_adjustments').select('id').eq('season_id', seasonId);
    expect(adjustments.error).toBeNull();
    expect(adjustments.data).toEqual([]);
    const detached = await formats.detachSeasonFormat(seasonId, false, null, 'native');
    expect([...detached.removed_stage_ids].sort()).toEqual(replaced.stages.map((stage) => stage.id).sort());
    expect(await phaseRows(seasonId)).toEqual([]);
    expect(await formats.getSeasonFormat(seasonId)).toBeNull();
    expect(await phaseRows(classic.season.id)).toHaveLength(classic.stages.length);
  });

  it('creates and publishes a preset league atomically, pins preset versions natively, and cleans unused presets on detach', async () => {
    const { createLeagueFromFormat } = await import('@/lib/format-studio/create-league');
    const { nativeFormatStorage } = await import('@/lib/league-phase/format-storage');
    const created = await createLeagueFromFormat({ actor, season: { name: `Native preset ${randomUUID()}`, language: 'en' }, fromFormat: { preset_id: 'wichtelcup' } }, nativeFormatStorage);
    seasonIds.push(created.season_id);
    definitionIds.push(created.format.definition_id);
    presetRulesetIds.push(...created.ruleset_ids);
    expect(created.format.version_no).toBe(1);
    expect(created.ruleset_ids).toHaveLength(1);
    const preset = await admin.from('ruleset_definitions').select('id, season_id, current_version_id').eq('id', created.ruleset_ids[0]).single();
    expect(preset.error).toBeNull();
    expect(preset.data?.season_id).toBe(created.season_id);
    const rows = await phaseRows(created.season_id);
    expect(rows.map((row) => row.id).sort()).toEqual([...created.stage_ids].sort());
    for (const row of rows) expect(row.ruleset_id).toBe(preset.data?.current_version_id);
    const grant = await admin.from('resource_admins').select('player_id').eq('resource_type', 'season').eq('resource_id', created.season_id);
    expect(grant.error).toBeNull();
    expect(grant.data).toEqual([{ player_id: actorId }]);
    const detached = await formats.detachSeasonFormat(created.season_id, false, null, 'native');
    expect(detached.removed_ruleset_ids).toEqual(created.ruleset_ids);
    const gone = await admin.from('ruleset_definitions').select('id').in('id', created.ruleset_ids);
    expect(gone.error).toBeNull();
    expect(gone.data).toEqual([]);
  }, 60_000);

  it('refuses attach and detach once a native round exists, even while the phase is still upcoming', async () => {
    const input = competitionInput('classic-league');
    const created = await competitions.createCompetitionFromFormat(input, 'native');
    expect((await admin.from('phase_rounds').insert({ phase_id: created.stages[0].id, name: 'Synthetic first round', round_number: 1, best_of: 1 })).error).toBeNull();
    await expect(formats.attachSeasonFormat(attachInput(created.season_id, input), 'native')).rejects.toMatchObject({ code: 'format_season_started' });
    await expect(formats.detachSeasonFormat(created.season_id, true, null, 'native')).rejects.toMatchObject({ code: 'format_season_started' });
    expect(await phaseRows(created.season_id)).toHaveLength(input.stages.length);
    expect(await formats.getSeasonFormat(created.season_id)).not.toBeNull();
  });

  it('rolls the new league, publication, grant and native phases back when stage materialisation fails', async () => {
    const input = competitionInput('classic-league');
    input.stages[0].ruleset_id = randomUUID();
    await expect(competitions.createCompetitionFromFormat(input, 'native')).rejects.toMatchObject({ code: '23503' });
    const season = await admin.from('seasons').select('id').eq('id', input.season.id);
    const definition = await admin.from('format_definitions').select('id').eq('id', input.format.definition_id);
    const versions = await admin.from('format_definition_versions').select('id').eq('definition_id', input.format.definition_id);
    const grant = await admin.from('resource_admins').select('id').eq('resource_type', 'season').eq('resource_id', input.season.id);
    for (const result of [season, definition, versions, grant]) {
      expect(result.error).toBeNull();
      expect(result.data).toEqual([]);
    }
    expect(await phaseRows(input.season.id)).toEqual([]);
    expect(await formats.getSeasonFormat(input.season.id)).toBeNull();
  });
});
