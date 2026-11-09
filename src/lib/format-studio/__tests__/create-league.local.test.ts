import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { assertLoopbackUrl, localStackOptIn, requireLocalKey } from '@/test/local-stack';
import type { CompetitionCreateInput } from '@/lib/supabase/queries/competition-create';
import type { SessionPlayer } from '@/types/auth';

// LIVE-LOCAL test of the new-competition wizard (supabase/migrations/20261109120000_competition_create_from_format.sql and
// src/lib/format-studio/create-league.ts): the Wichtelcup example becomes a league end to end (fork, publish, preset ruleset,
// league, creator grant, stages); a failure forced at each step of the one transaction leaves no row behind; only
// service_role may call the function; and a wizard-made league goes through the recycle bin and comes back. Opt-in only
// (`LOCAL_COMPETITION_CREATE=1` or `npm run test:db`), never loads `.env`.
const optIn = localStackOptIn('LOCAL_COMPETITION_CREATE');

if (optIn) {
  // Before the client module (which builds the client at import time) loads.
  assertLoopbackUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL');
  requireLocalKey('SUPABASE_SERVICE_ROLE_KEY');
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// The session guards are not under test here (the wizard takes the live player a guard returned).
vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
  requireAnyAdmin: vi.fn(),
}));

// Every call goes to the real function; a test can corrupt one part of the planned input first to force a failure at that step.
const hooks = vi.hoisted(() => ({
  mutate: null as null | ((input: CompetitionCreateInput) => CompetitionCreateInput | Promise<CompetitionCreateInput>),
  calls: [] as CompetitionCreateInput[],
}));
vi.mock('@/lib/supabase/queries/competition-create', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/supabase/queries/competition-create')>();
  return {
    ...real,
    createCompetitionFromFormat: async (input: CompetitionCreateInput) => {
      const sent = hooks.mutate === null ? input : await hooks.mutate(structuredClone(input));
      hooks.calls.push(sent);
      return real.createCompetitionFromFormat(sent);
    },
  };
});

type ClientMod = typeof import('@/lib/supabase/client');
type CreateMod = typeof import('@/lib/format-studio/create-league');

let client: ClientMod['supabase'];
let wizard: CreateMod;

const RUN = randomUUID().slice(0, 8);
const actorId = randomUUID();
const actor: SessionPlayer = {
  playerId: actorId,
  name: `Wizard ${RUN}`,
  isAdmin: false,
  isResourceAdmin: true,
  isCreator: false,
  psUsername: '',
  championsUsername: '',
  avatarUrl: null,
  status: 'active',
};
const createdSeasons: string[] = [];
const createdDefinitions: string[] = [];
const createdRulesets: string[] = [];

/** Every row the given call could have written, by table. */
async function rowsOf(input: CompetitionCreateInput): Promise<Record<string, number>> {
  const seasonId = input.season.id;
  const definitionId = input.format.definition_id;
  const rulesetIds = input.rulesets.map((ruleset) => ruleset.id);
  const count = async (label: string, op: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await op;
    if (error) throw new Error(`[count ${label}] ${JSON.stringify(error)}`);
    return n ?? 0;
  };
  const head = { count: 'exact' as const, head: true };
  return {
    seasons: await count('seasons', client.from('seasons').select('id', head).eq('id', seasonId)),
    format_definitions: await count('format_definitions', client.from('format_definitions').select('id', head).eq('id', definitionId)),
    format_definition_versions: input.format.fork
      ? await count('format_definition_versions', client.from('format_definition_versions').select('id', head).eq('definition_id', definitionId))
      : 0,
    ruleset_definitions:
      rulesetIds.length === 0 ? 0 : await count('ruleset_definitions', client.from('ruleset_definitions').select('id', head).in('id', rulesetIds)),
    ruleset_definition_versions:
      rulesetIds.length === 0
        ? 0
        : await count('ruleset_definition_versions', client.from('ruleset_definition_versions').select('id', head).in('definition_id', rulesetIds)),
    season_formats: await count('season_formats', client.from('season_formats').select('season_id', head).eq('season_id', seasonId)),
    tournaments: await count('tournaments', client.from('tournaments').select('id', head).eq('season_id', seasonId)),
    resource_admins: await count(
      'resource_admins',
      client.from('resource_admins').select('id', head).eq('resource_type', 'season').eq('resource_id', seasonId),
    ),
  };
}

const NOTHING = {
  seasons: 0,
  format_definitions: 0,
  format_definition_versions: 0,
  ruleset_definitions: 0,
  ruleset_definition_versions: 0,
  season_formats: 0,
  tournaments: 0,
  resource_admins: 0,
};

/** Runs the wizard with `mutate` applied to the planned input, expects it to fail, and returns the input it sent. */
async function failWith(
  name: string,
  mutate: (input: CompetitionCreateInput) => CompetitionCreateInput | Promise<CompetitionCreateInput>,
): Promise<{ input: CompetitionCreateInput; error: unknown }> {
  hooks.mutate = mutate;
  hooks.calls = [];
  let caught: unknown = null;
  try {
    await wizard.createLeagueFromFormat({ actor, season: { name: `${name} ${RUN}`, language: 'en' }, fromFormat: { preset_id: 'wichtelcup' } });
  } catch (err) {
    caught = err;
  } finally {
    hooks.mutate = null;
  }
  expect(caught).not.toBeNull();
  expect(hooks.calls).toHaveLength(1);
  return { input: hooks.calls[0], error: caught };
}

describe.skipIf(!optIn)('competition_create_from_format (local stack)', () => {
  beforeAll(async () => {
    ({ supabase: client } = await import('@/lib/supabase/client'));
    wizard = await import('@/lib/format-studio/create-league');
    const { error } = await client.from('players').insert([{ id: actorId, name: `Wizard ${RUN}`, is_guest: true }], { defaultToNull: false });
    if (error) throw new Error(`[seed players] ${JSON.stringify(error)}`);
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    if (createdSeasons.length > 0) {
      await client.from('season_formats').delete().in('season_id', createdSeasons);
      await client.from('tournaments').delete().in('season_id', createdSeasons);
      await client.from('resource_admins').delete().eq('resource_type', 'season').in('resource_id', createdSeasons);
      await client.from('seasons').delete().in('id', createdSeasons);
    }
    if (createdRulesets.length > 0) await client.from('ruleset_definitions').delete().in('id', createdRulesets);
    if (createdDefinitions.length > 0) await client.from('format_definitions').delete().in('id', createdDefinitions);
    await client.from('players').delete().eq('id', actorId);
  }, 60_000);

  it('creates a Wichtelcup league from the example in one call', async () => {
    hooks.calls = [];
    const created = await wizard.createLeagueFromFormat({
      actor,
      season: { name: `Wichtelcup ${RUN}`, language: 'en', route_theme: 'auto' },
      fromFormat: { preset_id: 'wichtelcup' },
    });
    createdSeasons.push(created.season_id);
    createdDefinitions.push(created.format.definition_id);
    createdRulesets.push(...created.ruleset_ids);

    expect(created.format.version_no).toBe(1);
    expect(created.preset_id).toBe('wichtelcup');
    expect(created.ruleset_ids).toHaveLength(1);
    expect(created.stages.length).toBeGreaterThan(0);
    expect(await rowsOf(hooks.calls[0])).toMatchObject({
      seasons: 1,
      format_definitions: 1,
      format_definition_versions: 1,
      ruleset_definitions: 1,
      ruleset_definition_versions: 1,
      season_formats: 1,
      tournaments: created.stage_ids.length,
      resource_admins: 1,
    });

    const season = await client.from('seasons').select('format_type, name, language, ruleset_id').eq('id', created.season_id).single();
    expect(season.data).toEqual({ format_type: 'custom', name: `Wichtelcup ${RUN}`, language: 'en', ruleset_id: null });
    // The function hands back the stored row, so the route answers without a read after the commit.
    expect(created.season).toMatchObject({ id: created.season_id, format_type: 'custom', language: 'en', route_theme: 'auto', status: 'upcoming' });

    const definition = await client
      .from('format_definitions')
      .select('owner_id, visibility, kind, current_version_id, current_draft')
      .eq('id', created.format.definition_id)
      .single();
    expect(definition.data).toMatchObject({ owner_id: actorId, visibility: 'private', kind: 'custom' });
    expect(definition.data?.current_version_id).not.toBeNull();
    expect((definition.data?.current_draft as { identity: { based_on?: string } }).identity.based_on).toBe('wichtelcup');

    const attached = await client.from('season_formats').select('definition_id, version_no, preset_rulesets').eq('season_id', created.season_id).single();
    expect(attached.data).toEqual({
      definition_id: created.format.definition_id,
      version_no: 1,
      preset_rulesets: { gen9natdexwichtelcup: created.ruleset_ids[0] },
    });

    // The preset ruleset belongs to the league, and every phase pins its published version.
    const ruleset = await client
      .from('ruleset_definitions')
      .select('season_id, owner_id, current_version_id')
      .eq('id', created.ruleset_ids[0])
      .single();
    expect(ruleset.data).toMatchObject({ season_id: created.season_id, owner_id: actorId });
    const phases = await client.from('tournaments').select('id, ruleset_id, format_stage_key').eq('season_id', created.season_id);
    expect(phases.data?.map((phase) => phase.id).sort()).toEqual([...created.stage_ids].sort());
    for (const phase of phases.data ?? []) {
      expect(phase.ruleset_id).toBe(ruleset.data?.current_version_id);
      expect(phase.format_stage_key).not.toBeNull();
    }

    const grant = await client.from('resource_admins').select('player_id').eq('resource_type', 'season').eq('resource_id', created.season_id);
    expect(grant.data).toEqual([{ player_id: actorId }]);
  });

  it('attaches a stored published version to a new league without forking it again', async () => {
    const source = createdDefinitions[0];
    const created = await wizard.createLeagueFromFormat({
      actor,
      season: { name: `Wichtelcup again ${RUN}` },
      fromFormat: { definition_id: source, version_no: 1 },
    });
    createdSeasons.push(created.season_id);
    createdRulesets.push(...created.ruleset_ids);
    expect(created.format).toEqual({ definition_id: source, version_no: 1 });
    expect(created.preset_id).toBeNull();
    const versions = await client.from('format_definition_versions').select('id').eq('definition_id', source);
    expect(versions.data).toHaveLength(1);
    const season = await client.from('seasons').select('language').eq('id', created.season_id).single();
    expect(season.data?.language).toBe('de');
  });

  it('takes the next free slug when the format and ruleset slugs are taken', async () => {
    const name = `Slug clash ${RUN}`;
    const first = await wizard.createLeagueFromFormat({ actor, season: { name }, fromFormat: { preset_id: 'wichtelcup' } });
    const second = await wizard.createLeagueFromFormat({ actor, season: { name }, fromFormat: { preset_id: 'wichtelcup' } });
    createdSeasons.push(first.season_id, second.season_id);
    createdDefinitions.push(first.format.definition_id, second.format.definition_id);
    createdRulesets.push(...first.ruleset_ids, ...second.ruleset_ids);
    const formats = await client.from('format_definitions').select('slug').in('id', [first.format.definition_id, second.format.definition_id]);
    expect(new Set(formats.data?.map((row) => row.slug)).size).toBe(2);
    const rulesets = await client.from('ruleset_definitions').select('slug').in('id', [...first.ruleset_ids, ...second.ruleset_ids]);
    const slugs = rulesets.data?.map((row) => row.slug).sort();
    expect(slugs).toHaveLength(2);
    expect(slugs?.[1]).toBe(`${slugs?.[0]}-2`);
  });

  it.each([
    ['the format insert', (input: CompetitionCreateInput) => ({ ...input, format: { ...input.format, fork: { ...input.format.fork!, slug_candidates: ['Not A Slug'] } } })],
    ['the format publish', (input: CompetitionCreateInput) => ({ ...input, format: { ...input.format, spec_hash: 'not-a-hash' } })],
    ['the ruleset insert', (input: CompetitionCreateInput) => ({ ...input, rulesets: input.rulesets.map((r) => ({ ...r, slug_candidates: ['Not A Slug'] })) })],
    ['the ruleset publish', (input: CompetitionCreateInput) => ({ ...input, rulesets: input.rulesets.map((r) => ({ ...r, resolved_hash: 'not-a-hash' })) })],
    ['the league insert', (input: CompetitionCreateInput) => ({ ...input, season: { ...input.season, start_date: 'not-a-date' } })],
    [
      'the creator grant',
      async (input: CompetitionCreateInput) => {
        // The grant collides with a row that already exists, so the failure comes at that step and not before.
        const { error } = await client.from('resource_admins').insert({ player_id: actorId, resource_type: 'season', resource_id: input.season.id });
        if (error) throw new Error(`[seed grant] ${JSON.stringify(error)}`);
        return input;
      },
    ],
    ['the stage attach', (input: CompetitionCreateInput) => ({ ...input, stages: input.stages.map((stage) => ({ ...stage, bracket_type: 'no_such_bracket' as never })) })],
  ])('rolls everything back when %s fails', async (step, mutate) => {
    const { input, error } = await failWith(`Rollback ${step}`, mutate);
    expect(error).toMatchObject({ code: 'season_format_create_failed', statusCode: 500 });
    const rows = await rowsOf(input);
    if (step === 'the creator grant') {
      expect(rows).toEqual({ ...NOTHING, resource_admins: 1 });
      await client.from('resource_admins').delete().eq('resource_type', 'season').eq('resource_id', input.season.id);
    } else {
      expect(rows).toEqual(NOTHING);
    }
  });

  it('is closed to the API roles', async () => {
    const anonKey = requireLocalKey('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey, { auth: { persistSession: false } });
    const { error } = await anon.rpc('competition_create_from_format', {
      p_actor: actorId,
      p_season: {},
      p_format: {},
      p_rulesets: [],
      p_stages: [],
      p_grant_creator: false,
    });
    expect(error).toMatchObject({ code: '42501' });
  });

  it('sends a wizard-made league through the recycle bin and back', async () => {
    const seasonId = createdSeasons[0];
    const before = await client.from('tournaments').select('id, ruleset_id').eq('season_id', seasonId).order('id');
    const { data: deleted, error: deleteError } = await client.rpc('league_trash_delete', { p_season_id: seasonId, p_actor: actorId, p_retention_days: 90 });
    expect(deleteError?.message ?? null).toBeNull();
    const gone = await client.from('seasons').select('id').eq('id', seasonId);
    expect(gone.data).toEqual([]);

    const trashId = (deleted as { trash_id: string }).trash_id;
    // The aggregate rebuild of a delete is another module's work; this league has no games to rebuild.
    const { error: rebuildError } = await client.from('league_trash').update({ rebuild_pending: false }).eq('id', trashId);
    expect(rebuildError).toBeNull();
    const { error: restoreError } = await client.rpc('league_trash_restore', { p_trash_id: trashId });
    expect(restoreError?.message ?? null).toBeNull();

    const after = await client.from('tournaments').select('id, ruleset_id').eq('season_id', seasonId).order('id');
    expect(after.data).toEqual(before.data);
    const attached = await client.from('season_formats').select('definition_id').eq('season_id', seasonId).single();
    expect(attached.data?.definition_id).toBe(createdDefinitions[0]);
    const grant = await client.from('resource_admins').select('player_id').eq('resource_type', 'season').eq('resource_id', seasonId);
    expect(grant.data).toEqual([{ player_id: actorId }]);
  }, 60_000);
});
