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
