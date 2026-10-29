import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { PLAN_BLOCKERS } from '../../plans';
import { buildToolSet } from '../../registry';
import type { ToolCallContext, ToolRunResult } from '../../loop/types';
import { factsFor, FixtureToolRuntime } from '../fixture-tools';
import type { EffectEntry } from '../types';
import { buildWorld, resolvePlaceholders } from '../world';
import { emptyPlan } from '../../plans';

/**
 * The plan stage's tool runtime: the real Plan code behind the Plan tools, the real argument schemas in front of every
 * tool, and the registry's own error mapping for a tool that throws.
 */
const world = buildWorld('baseline', 'site_admin');
const set = buildToolSet({ role: 'site', maxPhase: 0 });

let runtime: FixtureToolRuntime;
let effects: EffectEntry[];
let seq = 0;

beforeEach(() => {
  effects = [];
  runtime = new FixtureToolRuntime({ world, role: 'site', maxPhase: 0, onEffect: (e) => effects.push(e) });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const ctx = (): ToolCallContext => ({ toolUseId: `use-${++seq}`, now: () => new Date('2026-10-26T09:00:00Z'), timeZone: 'Europe/Berlin', locale: 'en' }) as unknown as ToolCallContext;
const call = (name: string, input: unknown = {}): Promise<ToolRunResult> => runtime.run(set, { name, input: resolvePlaceholders(world, input) }, ctx());
const data = (result: ToolRunResult): Record<string, unknown> => (result as { data: Record<string, unknown> }).data;

const league = { name: 'Cup', format_type: 'singles', language: 'en', start_date: '2026-11-02' };
const phases = [
  { key: 'rr', name: 'Regular', bracket_type: 'round_robin', best_of: 3, is_doubles: false, ruleset: 'plan' },
  { key: 'po', name: 'Playoffs', bracket_type: 'single_elim', best_of: 3, is_doubles: false, ruleset: 'plan', advancement_rule: { type: 'top_n', count: 2 } },
];
const roster = (n: number) => ({
  entries: Array.from({ length: n }, (_, i) => ({ input: `Eval Player ${String(i + 1).padStart(2, '0')}`, state: 'resolved', player_id: `{{player:${String(i + 1).padStart(2, '0')}}}` })),
  target_count: n,
});
const set_ = (slot: string, value: unknown) => call('plan_set', { slot, value_json: JSON.stringify(value) });

async function readyPlan(): Promise<void> {
  await call('plan_create', { mode: 'create', title: 'Cup' });
  await set_('ruleset', { mode: 'existing', version_id: '{{ruleset:gen9ou}}' });
  await set_('league', league);
  await set_('phases', phases);
  await set_('roster', roster(4));
}

describe('the Plan tools', () => {
  it('create, edit, read back and validate a Plan with the real Plan code', async () => {
    const created = await call('plan_create', { mode: 'create', title: 'Cup' });
    expect(created).toMatchObject({ ok: true, data: { plan_revision: 1 }, events: [{ type: 'plan.updated', revision: 1 }] });
    const edited = await set_('league', league);
    expect(data(edited)).toMatchObject({ plan_revision: 2, changed_slots: ['league'], ready: true });
    const patched = await call('plan_patch', { ops_json: JSON.stringify([{ op: 'replace', path: '/slots/league/name', value: 'Cup Two' }]) });
    expect(data(patched)).toMatchObject({ plan_revision: 3, changed_slots: ['league'] });
    expect(runtime.snapshot()).toMatchObject({ revision: 3, doc: { slots: { league: { name: 'Cup Two' } } } });
    const read = data(await call('plan_get')) as { plan_user_text: string };
    expect(JSON.parse(read.plan_user_text)).toMatchObject({ revision: 3, status: 'draft' });
    expect(effects.map((e) => e.kind)).toEqual(['plan_write', 'plan_write', 'plan_write']);
  });

  it('answers an edit the Plan refuses with catalogued codes only', async () => {
    expect(await set_('league', league)).toEqual({ ok: false, code: 'validation_failed', params: { issues: 'no_plan: call plan_create first' } });
    await call('plan_create', { mode: 'create', title: 'Cup' });
    const result = await set_('league', { name: 'Cup', format_type: 'singles' });
    expect(result).toEqual({ ok: false, code: 'validation_failed', params: { issues: '/slots/league/language: invalid_value' } });
    const unknownKey = await set_('league', { ...league, surprise: 1 });
    expect(JSON.stringify(unknownKey)).toContain('unrecognized_keys');
    const badPatch = await call('plan_patch', { ops_json: JSON.stringify([{ op: 'replace', path: '/refs', value: {} }]) });
    expect(badPatch).toMatchObject({ ok: false, code: 'validation_failed' });
    const notJson = await call('plan_patch', { ops_json: '[not json' });
    expect(JSON.stringify(notJson)).toContain('plan_patch_json_invalid');
  });

  it('reverts to the previous revision, and refuses when there is none', async () => {
    expect(await call('plan_revert')).toMatchObject({ ok: false, code: 'validation_failed' });
    await call('plan_create', { mode: 'create', title: 'Cup' });
    await set_('league', league);
    const reverted = await call('plan_revert');
    expect(data(reverted)).toMatchObject({ plan_revision: 3 });
    expect(runtime.snapshot()!.doc).toMatchObject({ slots: {} });
  });

  it('reports blockers as codes, and the Build once ready', async () => {
    await call('plan_create', { mode: 'create', title: 'Cup' });
    await set_('phases', phases);
    const blocked = JSON.parse((data(await call('plan_validate')) as { validation_user_text: string }).validation_user_text);
    expect(blocked.ready).toBe(false);
    expect(blocked.blockers.map((b: { code: string }) => b.code)).toEqual(expect.arrayContaining(['plan_incomplete']));
    await set_('league', league);
    await set_('ruleset', { mode: 'existing', version_id: '{{ruleset:gen9ou}}' });
    await set_('roster', roster(4));
    const ready = JSON.parse((data(await call('plan_validate')) as { validation_user_text: string }).validation_user_text);
    expect(ready).toMatchObject({ ready: true, blockers: [], build: { creating: 3, acks: ['visible_publicly'] }, step_issues: [] });
    expect(ready.build.steps.map((s: { op: string }) => s.op)).toEqual(['league_create', 'roster_add', 'phase_create', 'phase_create']);
    for (const blocker of blocked.blockers) expect(Object.keys(PLAN_BLOCKERS)).toContain(blocker.code);
    expect(runtime.snapshot()).toMatchObject({ ready: true, blockers: [] });
  });

  it('records a double round robin as an assumption and blocks on it', async () => {
    await readyPlan();
    const patch = await call('plan_patch', { ops_json: JSON.stringify([{ op: 'add', path: '/assumptions/-', value: { key: 'legs.rr', value: 2, source: 'admin', confirmed: false } }]) });
    expect(data(patch)).toMatchObject({ ready: false, blockers: ['double_round_robin_unsupported'] });
  });

  it('does not model an amend plan', async () => {
    const result = await call('plan_create', { mode: 'amend', title: 'Change', entity_kind: 'league', entity_id: world.leagues[0].id });
    expect(result).toEqual({ ok: false, code: 'tool_not_available' });
    expect(runtime.annotations.get('use-' + seq)).toMatchObject({ unmodelled: true });
  });
});

describe('staging a Build', () => {
  it('stages a ready Plan once: a card, a hash, an event without the token, and a stage effect', async () => {
    await readyPlan();
    const staged = await call('propose_build', { plan_revision: 5 });
    expect(staged).toMatchObject({ ok: true, data: { status: 'staged', kind: 'build', class: 'B', note: 'not executed; the admin must approve the card' } });
    const event = (staged as unknown as { events: Array<{ type: string; hash: string; preview: unknown }> }).events[0];
    expect(event.type).toBe('proposal');
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(staged)).not.toMatch(/token/i);
    expect(runtime.proposals).toEqual([expect.objectContaining({ tool: 'propose_build', class: 'B', status: 'staged', planRevision: 5 })]);
    expect(effects.filter((e) => e.kind === 'stage')).toHaveLength(1);
  });

  it('refuses a stale revision, a Plan that is not ready, and a missing Plan, with a code and findings', async () => {
    expect(data(await call('propose_build', { plan_revision: 1 }))).toMatchObject({ status: 'refused', code: 'plan_not_ready' });
    await call('plan_create', { mode: 'create', title: 'Cup' });
    await set_('phases', phases);
    const notReady = data(await call('propose_build', { plan_revision: 2 }));
    expect(notReady).toMatchObject({ status: 'refused', code: 'plan_not_ready' });
    expect((notReady.findings as Array<{ code: string }>).length).toBeGreaterThan(0);
    expect(data(await call('propose_build', { plan_revision: 1 }))).toMatchObject({ status: 'refused', code: 'plan_stale', params: { revision: 2 } });
    expect(runtime.proposals).toEqual([]);
    expect(effects.filter((e) => e.kind === 'stage')).toEqual([]);
  });

  it('supersedes the earlier Build when a newer one is staged', async () => {
    await readyPlan();
    await call('propose_build', { plan_revision: 5 });
    await call('plan_patch', { ops_json: JSON.stringify([{ op: 'replace', path: '/slots/phases/1/advancement_rule/count', value: 3 }]) });
    await call('propose_build', { plan_revision: 6 });
    expect(runtime.proposals.map((p) => p.status)).toEqual(['superseded', 'staged']);
  });
});

describe('every call', () => {
  it('parses the arguments with the tool\'s own schema and says which field is wrong', async () => {
    const result = await call('plan_set', { slot: 'leagues', value_json: '{}' });
    expect(result).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(JSON.stringify(result)).toContain('slot');
    expect(runtime.annotations.get(`use-${seq}`)).toMatchObject({ invalidArgs: true, class: 'D', offered: true });
    expect(await call('player_search', { query: '' })).toMatchObject({ ok: false, code: 'validation_failed' });
    expect(await call('league_get', { league_id: 'not-a-uuid' })).toMatchObject({ ok: false, code: 'validation_failed' });
  });

  it('answers a tool that is not in the set as unavailable, whatever it is called', async () => {
    expect(await call('propose_start_phase', {})).toEqual({ ok: false, code: 'tool_not_available' });
    expect(await call('delete_league', {})).toEqual({ ok: false, code: 'tool_not_available' });
    expect(runtime.annotations.get(`use-${seq}`)).toMatchObject({ class: null, offered: false });
  });

  it('marks a read the world does not model, instead of blaming the model', async () => {
    expect(await call('tournament_get', { tournament_id: '{{tournament:T1}}' })).toEqual({ ok: false, code: 'tool_not_available' });
    expect(runtime.annotations.get(`use-${seq}`)).toMatchObject({ unmodelled: true, offered: true });
  });

  it('answers the catalog, preview and listing tools from the registry code, unmarked', async () => {
    expect(await call('format_catalog', { query: 'gen 9 ou' })).toMatchObject({ ok: true });
    expect(runtime.annotations.get(`use-${seq}`)).toMatchObject({ unmodelled: false, offered: true });
    expect(await call('ruleset_build_preview', { base_preset: 'gen9ou' })).toMatchObject({ ok: true, data: { built: true } });
    expect(await call('outward_effects_preview', { action: 'start_phase' })).toMatchObject({ ok: true, data: { channels: 'cannot_say' } });
    expect(await call('tournament_list')).toMatchObject({ ok: true, data: { tournaments: { total: 0 } } });
    expect(await call('tournament_create_preview', { name: 'Cup', bracket_type: 'single_elim', ruleset_id: '{{ruleset:gen9ou}}', best_of_default: 3 })).toMatchObject({ ok: true, data: { valid: true } });
    expect(runtime.annotations.get(`use-${seq}`)).toMatchObject({ unmodelled: false });
  });

  it('turns a throwing tool into a code with the registry mapping and logs the message server-side only', async () => {
    const faulty = new FixtureToolRuntime({ world, role: 'site', maxPhase: 0, faults: [{ tool: 'league_list', canary: 'FATAL: password authentication failed', times: 2 }] });
    const run = () => faulty.run(set, { name: 'league_list', input: {} }, ctx());
    expect(await run()).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(await run()).toEqual({ ok: false, code: 'agent_harness_error' });
    expect(await run()).toMatchObject({ ok: true });
    expect(JSON.stringify(await run())).not.toContain('FATAL');
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});

describe('facts', () => {
  it('answers only what the Plan asks about, from the world', () => {
    const plan = emptyPlan({ title: 'T', intent: 'mixed', contentLocale: 'en' });
    plan.slots.ruleset = { mode: 'existing', version_id: world.rulesets[0].versionId };
    plan.slots.roster = { entries: [{ input: 'x', state: 'resolved', player_id: world.players[0].id }, { input: 'y', state: 'resolved', player_id: '99999999-9999-4999-8999-999999999999' }] };
    plan.slots.league = { name: 'eval league one', format_type: 'singles', language: 'en' };
    const facts = factsFor(world, plan);
    expect(facts.rulesetVersions).toEqual({ [world.rulesets[0].versionId]: 'usable' });
    expect(Object.values(facts.players!).map((p) => p.status).sort()).toEqual(['not_found', 'ok']);
    expect(facts.leagueNameInUse).toBe(true);
    expect(facts.rulesetQuota).toBeUndefined();
  });

  it('checks dex ids against the real dex', () => {
    const plan = emptyPlan({ title: 'T', intent: 'mixed', contentLocale: 'en' });
    plan.slots.ruleset = { mode: 'new', name: 'N', base_locale: 'en', preset: 'gen9ou', delta: { pokemon: { ban: ['kingambit', 'notapokemon'], unban: [], allow: null }, moves: { ban: ['earthquake'], unban: [], allow: null }, items: { ban: [], unban: [], allow: null }, abilities: { ban: ['levitate'], unban: [], allow: null }, clauses: { add: [], remove: [] } } };
    const facts = factsFor(world, plan);
    expect(facts.dex).toEqual({ 'pokemon:kingambit': 'ok', 'pokemon:notapokemon': 'unknown', 'moves:earthquake': 'ok', 'abilities:levitate': 'ok' });
    expect(facts.rulesetPresets).toEqual({ gen9ou: { known: true } });
    expect(facts.rulesetQuota).toEqual({ owned: 0, max: 200 });
  });
});
