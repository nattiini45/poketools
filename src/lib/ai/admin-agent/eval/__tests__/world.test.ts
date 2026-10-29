import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { isValidUuid } from '@/lib/utils/uuid';
import { getRulesetPreset, isRulesetPresetId } from '@/lib/pkmn/ruleset-preset-catalog';
import { getToolDefinition, type RunnableTool } from '../../registry';
import { answerRead, buildWorld, evalUuid, INJECTION, resolvePlaceholders, resolveToken, WORLD_RULESET_PRESETS, type ReadContext, type World } from '../world';

/**
 * The fixture world answers reads the way the registry's tools do. The strongest check available without a database: every
 * answer must pass the tool's own strict output schema, so a drift in a projection (a renamed field, a new required one)
 * fails here instead of silently grading the model against a shape it will never see.
 */
const NOW = new Date('2026-10-26T09:00:00.000Z');

function context(world: World): ReadContext {
  return { world, now: () => NOW, timeZone: 'Europe/Berlin', locale: 'en', role: world.admin.tier === 'site_admin' ? 'site' : 'scoped', maxPhase: 0, offeredTools: ['whoami', 'league_list'] };
}

/** Every read tool the world models, with arguments that make it answer. */
function calls(world: World): Array<[string, Record<string, unknown>]> {
  const l1 = world.leagues[0].id;
  return [
    ['whoami', {}],
    ['league_list', {}],
    ['league_list', { name_contains: 'Two' }],
    ['league_get', { league_id: l1 }],
    ['league_get', { league_id: evalUuid('league', 'missing') }],
    ['league_roster_get', { league_id: l1 }],
    ['player_search', { query: 'Eval Player', limit: 5, league_id: l1 }],
    ['player_search', { query: 'nobody-by-this-name', league_id: l1 }],
    ['ruleset_list', {}],
    ['ruleset_list', { limit: 2, offset: 1 }],
    ['dex_lookup', { kind: 'species', query: 'Flutter Mane' }],
    ['dex_lookup', { kind: 'species', query: 'Kingamb' }],
    ['dex_lookup', { kind: 'move', query: 'Earthquake' }],
    ['dex_lookup', { kind: 'item', query: 'Leftovers' }],
    ['dex_lookup', { kind: 'ability', query: 'Levitate' }],
    ['engine_support', {}],
    ['resolve_date', { anchor: 'today' }],
    ['resolve_date', { anchor: 'weekday', weekday: 'monday', relation: 'next' }],
    ['format_catalog', { query: 'gen 9 ou' }],
    ['format_catalog', { gen: 9, source: 'showdown' }],
    ['ruleset_preset_get', { preset: 'gen9ou' }],
    ['ruleset_preset_get', { preset: 'gen9ou', tour_overlay: true }],
    ['ruleset_preset_get', { preset: 'gen1nothing' }],
    ['ruleset_build_preview', { base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'ban', ids: ['kingambit'] }] }],
    ['ruleset_build_preview', { base_preset: 'gen9ou', tour_overlay: true, clauses_add: ['sleepclausemod'] }],
    ['ruleset_build_preview', { blank_gen: 9 }],
    ['ruleset_build_preview', { base_preset: 'gen1nothing' }],
    ['outward_effects_preview', { action: 'start_phase' }],
    ['outward_effects_preview', { action: 'publish_ruleset', league_id: l1 }],
    ['tournament_list', {}],
    ['tournament_create_preview', { name: 'Quick Cup', bracket_type: 'single_elim', ruleset_id: world.rulesets[0].versionId, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' }],
    ['tournament_create_preview', { name: 'Quick Cup', bracket_type: 'single_elim', ruleset_id: evalUuid('ruleset-version', 'missing'), best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' }],
  ];
}

describe('the baseline world', () => {
  const world = buildWorld('baseline', 'site_admin');

  it('has stable, valid, distinct ids', () => {
    expect(buildWorld('baseline', 'site_admin')).toEqual(world);
    const ids = [...world.players.map((p) => p.id), ...world.leagues.map((l) => l.id), ...world.rulesets.flatMap((r) => [r.definitionId, r.versionId]), world.admin.id];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isValidUuid(id), id).toBe(true);
    expect(world.players).toHaveLength(24);
    expect(world.players[0].name).toBe('Eval Player 01');
  });

  it('publishes only rulesets that are real catalog presets, named by the catalog', () => {
    for (const preset of WORLD_RULESET_PRESETS) expect(isRulesetPresetId(preset), preset).toBe(true);
    expect(world.rulesets.map((r) => r.name)).toEqual(WORLD_RULESET_PRESETS.map((p) => getRulesetPreset(p)?.name));
  });

  it.each(calls(world))('answers %s %j within the tool\'s strict output schema', (name, args) => {
    const result = answerRead(context(world), name, args);
    expect(result, name).not.toBeNull();
    expect(result!.ok, JSON.stringify(result)).toBe(true);
    const tool = getToolDefinition(name) as RunnableTool;
    const checked = tool.output.safeParse((result as { data: unknown }).data);
    expect(checked.success, checked.success ? '' : JSON.stringify(checked.error.issues.slice(0, 3))).toBe(true);
  });

  it('answers a tournament preview for a published version and refuses an unknown one with the guard code', () => {
    const body = { name: 'Quick Cup', bracket_type: 'single_elim', best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' };
    const known = answerRead(context(world), 'tournament_create_preview', { ...body, ruleset_id: world.rulesets[0].versionId }) as { data: { valid: boolean; ruleset: { label: string } | null; effects: string[] } };
    expect(known.data).toMatchObject({ valid: true, ruleset: { label: world.rulesets[0].preset } });
    expect(known.data.effects).toEqual(['public_immediately']);
    const unknown = answerRead(context(world), 'tournament_create_preview', { ...body, ruleset_id: evalUuid('ruleset-version', 'missing') }) as { data: { valid: boolean; blockers: Array<{ code: string }> } };
    expect(unknown.data.valid).toBe(false);
    expect(unknown.data.blockers.map((b) => b.code)).toEqual(['ruleset_not_found']);
    const scoped = answerRead(context(buildWorld('baseline', 'league_admin')), 'tournament_create_preview', { ...body, ruleset_id: world.rulesets[0].versionId }) as { data: { effects: string[] } };
    expect(scoped.data.effects).toContain('creator_becomes_admin');
  });

  it('runs the catalog and preview code of the registry: the preset exists, a ban shows up as a change, a miss is reported', () => {
    const preset = answerRead(context(world), 'ruleset_preset_get', { preset: 'gen9ou' }) as { data: { found: boolean; preset: { id: string } } };
    expect(preset.data).toMatchObject({ found: true, preset: { id: 'gen9ou' } });
    expect((answerRead(context(world), 'ruleset_preset_get', { preset: 'gen1nothing' }) as { data: { found: boolean } }).data.found).toBe(false);
    const build = answerRead(context(world), 'ruleset_build_preview', { base_preset: 'gen9ou', edits: [{ category: 'pokemon', action: 'ban', ids: ['kingambit'] }] }) as {
      data: { built: boolean; changes_vs_base: { categories: Array<{ category: string; added: string[] }> } };
    };
    expect(build.data.built).toBe(true);
    expect(build.data.changes_vs_base.categories.find((c) => c.category === 'pokemon')?.added).toContain('kingambit');
    const catalog = answerRead(context(world), 'format_catalog', { query: 'gen 9 ou' }) as { data: { presets: { items: Array<{ id: string }> } } };
    expect(catalog.data.presets.items.map((p) => p.id)).toContain('gen9ou');
    const outward = answerRead(context(world), 'outward_effects_preview', { action: 'start_phase' }) as { data: { channels: string; posts_outward: boolean } };
    expect(outward.data).toMatchObject({ channels: 'cannot_say', posts_outward: true });
  });

  it('leaves the reads it does not model to the caller (null)', () => {
    expect(answerRead(context(world), 'tournament_get', {})).toBeNull();
    expect(answerRead(context(world), 'phase_get', {})).toBeNull();
    expect(answerRead(context(world), 'league_create_preview', {})).toBeNull();
  });

  it('knows no league outside the roster it lists', () => {
    const l1 = world.leagues[0];
    const roster = answerRead(context(world), 'league_roster_get', { league_id: l1.id });
    const ids = ((roster as { data: { players: { items: Array<{ id: string }> } } }).data.players.items).map((p) => p.id).sort();
    expect(ids).toEqual([...l1.rosterIds].sort());
  });
});

describe('scope', () => {
  it('refuses a league admin the league they do not manage, and a search without a league', () => {
    const world = buildWorld('baseline', 'league_admin');
    const ctx = context(world);
    expect(answerRead(ctx, 'league_get', { league_id: world.leagues[1].id })).toEqual({ ok: false, code: 'forbidden' });
    expect(answerRead(ctx, 'league_roster_get', { league_id: world.leagues[1].id })).toEqual({ ok: false, code: 'forbidden' });
    expect(answerRead(ctx, 'player_search', { query: 'Eval' })).toMatchObject({ ok: false, code: 'validation_failed' });
    expect((answerRead(ctx, 'league_list', {}) as { data: { leagues: { items: unknown[] } } }).data.leagues.items).toHaveLength(1);
    // A guard refuses an unknown id before any read; a site admin gets a plain not-found answer instead.
    expect(answerRead(ctx, 'league_get', { league_id: evalUuid('league', 'missing') })).toEqual({ ok: false, code: 'forbidden' });
  });

  it('reports the tier and the scope in whoami', () => {
    const site = buildWorld('baseline', 'site_admin');
    const scoped = buildWorld('baseline', 'league_admin');
    expect((answerRead(context(site), 'whoami', {}) as { data: Record<string, unknown> }).data).toMatchObject({ tier: 'site_admin', league_scope: { all: true } });
    expect((answerRead(context(scoped), 'whoami', {}) as { data: Record<string, unknown> }).data).toMatchObject({ tier: 'resource_admin', toolset: 'scoped', league_scope: { all: false, count: 1 } });
  });
});

describe('the injection world', () => {
  const world = buildWorld('injection', 'site_admin');

  it('plants the hostile text in stored fields', () => {
    expect(world.players[12].name).toBe(INJECTION.playerName);
    expect(world.leagues[0].description).toBe(INJECTION.leagueDescription);
    expect(world.leagues[0].name).toBe(INJECTION.leagueName);
  });

  it('hands it over defused: the marker is rewritten and direction and zero-width characters are gone', () => {
    const l1 = world.leagues[0].id;
    const league = (answerRead(context(world), 'league_get', { league_id: l1 }) as { data: { league: { description_user_text: string } } }).data.league;
    expect(league.description_user_text).toContain('harness event');
    expect(league.description_user_text).not.toMatch(/harness[_-]event/i);
    const list = JSON.stringify(answerRead(context(world), 'ruleset_list', {}));
    expect(list).not.toContain('‮');
    expect(list).not.toContain('​');
    expect(list).toContain('evil');
  });

  it('keeps the injected text valid for the output schema', () => {
    const l1 = world.leagues[0].id;
    for (const [name, args] of [['league_get', { league_id: l1 }], ['league_roster_get', { league_id: l1 }], ['league_list', {}], ['ruleset_list', {}]] as const) {
      const result = answerRead(context(world), name, args);
      const checked = (getToolDefinition(name) as RunnableTool).output.safeParse((result as { data: unknown }).data);
      expect(checked.success, name).toBe(true);
    }
  });
});

describe('placeholders', () => {
  const world = buildWorld('baseline', 'site_admin');

  it('resolves tokens anywhere in a JSON value, including JSON text inside a string', () => {
    const resolved = resolvePlaceholders(world, { a: ['{{player:03}}'], b: JSON.stringify({ version_id: '{{ruleset:gen9ou}}' }), c: 7 });
    expect(resolved.a[0]).toBe(world.players[2].id);
    expect(JSON.parse(resolved.b).version_id).toBe(world.rulesets[0].versionId);
    expect(resolved.c).toBe(7);
  });

  it('resolves every kind', () => {
    expect(resolveToken(world, 'league', 'L2')).toBe(world.leagues[1].id);
    expect(resolveToken(world, 'rulesetdef', 'gen9nu')).toBe(world.rulesets[2].definitionId);
    expect(resolveToken(world, 'tournament', 'T1')).toBe(evalUuid('tournament', 'T1'));
  });

  it('throws on a token the world does not know, instead of passing a half-resolved id on', () => {
    expect(() => resolveToken(world, 'player', '99')).toThrow(/unknown placeholder/);
    expect(() => resolvePlaceholders(world, '{{ruleset:gen1ou}}')).toThrow(/unknown placeholder/);
    expect(() => resolvePlaceholders(world, '{{nothing:x}}')).toThrow(/unknown placeholder/);
  });
});
