import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ltext } from '@/lib/studio-core/ltext';
import { newRulesetDocument } from '../document';
import type { SessionPlayer } from '@/types/auth';

// LIVE-LOCAL test of the ruleset library against a LOCAL Supabase stack (after `supabase db reset --local`): the real query
// modules, the real library functions and the real database functions (publish, immutability, the pin keys, the format
// attach cleanup). Only the session guard and the Next cache calls are replaced. Opt-in, never in CI, never loads `.env`:
//
//   LOCAL_RULESETS=1 NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local service_role> \
//   npx vitest run src/lib/ruleset-studio/__tests__/ruleset-library.local.test.ts
//
// The local key comes from `supabase status -o env` (SERVICE_ROLE_KEY).
const optIn = process.env.LOCAL_RULESETS === '1' && process.env.CI !== 'true';

if (optIn) {
  const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://invalid').hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error(`[ruleset-library.local] refusing to run against ${host}`);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key === 'dummy-service-role-key') throw new Error('[ruleset-library.local] pass the LOCAL SUPABASE_SERVICE_ROLE_KEY');
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

// The session guards are not under test here (the library functions take the live player a guard returned).
vi.mock('@/lib/auth/helpers', () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, public statusCode: number, public code?: string) {
      super(message);
    }
  },
  requireAnyAdmin: vi.fn(),
}));

describe.skipIf(!optIn)('ruleset library on the local stack', () => {
  let admin: SupabaseClient;
  let library: typeof import('../library');
  let pins: typeof import('../pins');
  let queries: typeof import('@/lib/supabase/queries/ruleset-definitions');
  let rulesets: typeof import('@/lib/supabase/queries/rulesets');
  let materialise: typeof import('../materialise');
  let attachQueries: typeof import('@/lib/supabase/queries/season-formats');

  const RUN = randomUUID().slice(0, 8);
  const created = { definitions: [] as string[], seasons: [] as string[], tournaments: [] as string[], players: [] as string[] };
  let owner: SessionPlayer;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the rows are read by their column names, the typed client is not worth it here
  const unwrap = (result: { data: unknown; error: { message: string } | null }): any => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  beforeAll(async () => {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } });
    library = await import('../library');
    pins = await import('../pins');
    queries = await import('@/lib/supabase/queries/ruleset-definitions');
    rulesets = await import('@/lib/supabase/queries/rulesets');
    materialise = await import('../materialise');
    attachQueries = await import('@/lib/supabase/queries/season-formats');
    const player = unwrap(await admin.from('players').insert({ name: `RS ${RUN}`, discord_id: `rs-${RUN}`, is_admin: true }).select('id').single());
    created.players.push(player.id);
    owner = { playerId: player.id, name: `RS ${RUN}`, isAdmin: true, isResourceAdmin: false, isCreator: false, psUsername: '', championsUsername: '', avatarUrl: null, status: 'active' };
  }, 60000);

  afterAll(async () => {
    if (created.tournaments.length > 0) await admin.from('tournaments').delete().in('id', created.tournaments);
    if (created.seasons.length > 0) await admin.from('seasons').delete().in('id', created.seasons);
    if (created.definitions.length > 0) await admin.from('ruleset_definitions').delete().in('id', created.definitions);
    if (created.players.length > 0) await admin.from('players').delete().in('id', created.players);
  }, 60000);

  async function newDefinition(name: string, preset = 'gen9ou') {
    const made = await library.createFromBody(owner, { name: `${name} ${RUN}`, base_locale: 'en', preset });
    created.definitions.push(made.definition.id);
    return made.definition.id;
  }

  async function pinSeason(versionId: string, status: 'upcoming' | 'active' = 'upcoming') {
    const season = unwrap(await admin.from('seasons').insert({ name: `RS league ${RUN} ${created.seasons.length}`, format_type: 'singles', ruleset_id: versionId, status }).select('id').single());
    created.seasons.push(season.id);
    return season.id as string;
  }

  it('creates, saves a draft with a compare-and-set, publishes an immutable version with frozen resolved rules, and reads it back as the Ruleset model', async () => {
    const id = await newDefinition('Spring');
    const meta = unwrap(await admin.from('ruleset_definitions').select('draft_rev, current_version_id').eq('id', id).single());
    expect(meta).toMatchObject({ draft_rev: 1, current_version_id: null });

    const draft = newRulesetDocument(`Spring ${RUN}`, 'en', 'gen9ou') as unknown as Record<string, unknown>;
    (draft.pokemon as { ban: string[] }).ban = ['garchomp'];
    const saved = await library.saveDraft((await queries.getRulesetDefinitionMeta(id))!, { draftRev: 1, document: draft });
    expect(saved.draft_rev).toBe(2);
    await expect(library.saveDraft((await queries.getRulesetDefinitionMeta(id))!, { draftRev: 1, document: draft })).rejects.toMatchObject({ code: 'ruleset_stale_revision', params: { draft_rev: 2 } });

    const published = await library.publish(owner, (await queries.getRulesetDefinitionMeta(id))!, { draftRev: 2, changelog: ltext('en', 'first') });
    expect(published.version.version_no).toBe(1);

    const ruleset = await rulesets.getRulesetById(published.version.id);
    expect(ruleset).toMatchObject({ id: published.version.id, gen: 9, base_format: 'gen9ou', version: { definition_id: id, version_no: 1 } });
    expect(ruleset?.rules.pokemon.ids).toContain('garchomp');
    expect(ruleset?.rules.pokemon.ids).toContain('koraidon');
    expect(ruleset?.bans.pokemon).toContain('Garchomp');

    // Publishing the same draft again changes nothing: both hashes equal.
    await expect(library.publish(owner, (await queries.getRulesetDefinitionMeta(id))!, { draftRev: 2, changelog: null })).rejects.toMatchObject({ code: 'ruleset_nothing_to_publish' });
  }, 60000);

  it('a published version is immutable in the database', async () => {
    const id = await newDefinition('Immutable');
    const meta = (await queries.getRulesetDefinitionMeta(id))!;
    const { version } = await library.publish(owner, meta, { draftRev: 1, changelog: null });
    for (const change of [{ spec: { schema_version: 1 } }, { resolved: { v: 1 } }, { name_text: 'Other' }, { gen: 8 }]) {
      const result = await admin.from('ruleset_definition_versions').update(change).eq('id', version.id);
      expect(result.error?.message, JSON.stringify(change)).toBe('RULESET_VERSION_IMMUTABLE');
    }
    // The changelog is not part of the frozen content.
    expect((await admin.from('ruleset_definition_versions').update({ changelog: ltext('en', 'edited') as never }).eq('id', version.id)).error).toBeNull();
  }, 60000);

  it('leagues and phases pin a version: a pinned version (or its definition) cannot be deleted, an unpinned one can', async () => {
    const id = await newDefinition('Pinned');
    const meta = (await queries.getRulesetDefinitionMeta(id))!;
    const { version } = await library.publish(owner, meta, { draftRev: 1, changelog: null });
    const seasonId = await pinSeason(version.id);

    await expect(library.removeDefinition({ playerId: owner.playerId, isAdmin: true }, meta)).rejects.toMatchObject({ code: 'ruleset_in_use', params: { count: 1 } });
    // The database refuses on its own as well (a pin created between the count and the delete).
    await expect(queries.deleteRulesetDefinition(id)).rejects.toMatchObject({ code: 'ruleset_in_use' });

    // Pins are real foreign keys: an id that is not a version is refused.
    const bogus = await admin.from('seasons').update({ ruleset_id: randomUUID() }).eq('id', seasonId);
    expect(bogus.error?.code).toBe('23503');

    unwrap(await admin.from('seasons').delete().eq('id', seasonId));
    created.seasons.length = 0;
    await library.removeDefinition({ playerId: owner.playerId, isAdmin: true }, meta);
    expect(await queries.getRulesetDefinitionMeta(id)).toBeNull();
    created.definitions.length = 0;
  }, 60000);

  it('moves a pin to a newer version through the pin path, and the new version enforces the new bans while the old league keeps its rules', async () => {
    const id = await newDefinition('Moving');
    let meta = (await queries.getRulesetDefinitionMeta(id))!;
    const v1 = (await library.publish(owner, meta, { draftRev: 1, changelog: null })).version;
    const seasonId = await pinSeason(v1.id);

    const draft = newRulesetDocument(`Moving ${RUN}`, 'en', 'gen9ou') as unknown as Record<string, unknown>;
    (draft.moves as { ban: string[] }).ban = ['dragondance'];
    meta = (await queries.getRulesetDefinitionMeta(id))!;
    await library.saveDraft(meta, { draftRev: meta.draft_rev, document: draft });
    meta = (await queries.getRulesetDefinitionMeta(id))!;
    const v2 = (await library.publish(owner, meta, { draftRev: meta.draft_rev, changelog: null })).version;
    expect(v2.version_no).toBe(2);

    // Publishing moved nothing.
    expect(unwrap(await admin.from('seasons').select('ruleset_id').eq('id', seasonId).single()).ruleset_id).toBe(v1.id);
    expect((await rulesets.getRulesetById(v1.id))?.rules.moves.ids).not.toContain('dragondance');

    const usage = await pins.listUsage({ playerId: owner.playerId, isAdmin: true }, meta);
    expect(usage.counts).toEqual([{ version_no: 1, seasons: 1, tournaments: 0 }]);

    const outcome = await pins.movePins({ actor: owner, definition: meta, toVersionNo: 2, targets: [{ kind: 'season', id: seasonId }], confirmStarted: [] });
    expect(outcome.moved).toHaveLength(1);
    expect(outcome.moved[0].difference?.moves.added).toEqual(['dragondance']);
    expect(unwrap(await admin.from('seasons').select('ruleset_id').eq('id', seasonId).single()).ruleset_id).toBe(v2.id);
    expect((await rulesets.getRulesetById(v2.id))?.rules.moves.ids).toContain('dragondance');
  }, 60000);

  it('a format attach materialises a preset into a published, league-owned, private ruleset and reuses it; the cleanup deletes only unpinned league-made ones', async () => {
    const seasonId = await pinSeason(unwrap(await admin.from('ruleset_definition_versions').select('id').limit(1).single()).id);
    const first = await materialise.ensurePresetRulesets({ presets: ['gen9ou'], leagueName: `Spring ${RUN}`, seasonId, actorId: owner.playerId, recorded: {} });
    const definitionId = first.definitionIds.get('gen9ou')!;
    created.definitions.push(definitionId);
    expect(first.created).toEqual([definitionId]);
    expect(unwrap(await admin.from('ruleset_definitions').select('kind, visibility, season_id, owner_id').eq('id', definitionId).single())).toEqual({ kind: 'custom', visibility: 'private', season_id: seasonId, owner_id: owner.playerId });
    const head = await rulesets.getRulesetById(first.versionIds.get('gen9ou')!);
    expect(head?.rules.pokemon.ids.length).toBeGreaterThan(10);

    const again = await materialise.ensurePresetRulesets({ presets: ['gen9ou'], leagueName: `Spring ${RUN}`, seasonId, actorId: owner.playerId, recorded: { gen9ou: definitionId } });
    expect(again.created).toEqual([]);
    expect(again.versionIds.get('gen9ou')).toBe(first.versionIds.get('gen9ou'));
    expect((await attachQueries.getPublishedRulesetHeads([definitionId])).get(definitionId)).toBe(first.versionIds.get('gen9ou'));

    // A phase pins it: the cleanup keeps it; once nothing pins it, the cleanup deletes it (league-made only).
    const tournament = unwrap(await admin.from('tournaments').insert({ name: `RS phase ${RUN}`, season_id: seasonId, bracket_type: 'round_robin', ruleset_id: first.versionIds.get('gen9ou') }).select('id').single());
    created.tournaments.push(tournament.id);
    const kept = await admin.rpc('format_delete_unused_preset_rulesets', { p_recorded: { gen9ou: definitionId }, p_kept: {} });
    expect(kept.data).toEqual([]);
    unwrap(await admin.from('tournaments').delete().eq('id', tournament.id));
    created.tournaments.length = 0;
    const removed = await admin.rpc('format_delete_unused_preset_rulesets', { p_recorded: { gen9ou: definitionId }, p_kept: {} });
    expect(removed.data).toEqual([definitionId]);
    created.definitions.length = 0;
  }, 60000);
});
