import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rulesFromBans } from '@/lib/ruleset-kit/effective';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => (fake.current!.client.from as (t: string) => unknown)(table),
    rpc: (fn: string, args?: Record<string, unknown>) => fake.current!.client.rpc(fn, args),
  },
}));

import { findHeadRulesetsByName, getHeadRuleset, getRulesetById, listRulesetOptions, listRulesetOptionsFor, listRulesets } from '../rulesets';

const V1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const DEF = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

function versionRow(id: string, name: string, banned: string[] = []) {
  return {
    id,
    definition_id: DEF,
    version_no: 2,
    name_text: name,
    resolved: rulesFromBans({ gen: 9, formatKey: 'gen9ou', clauses: ['Species Clause'], bans: { pokemon: banned } }),
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
  };
}

beforeEach(() => {
  fake.current = createFakeSupabase({
    ruleset_definition_versions: [versionRow(V1, 'Spring OU', ['Garchomp', 'Tapu Koko'])],
    ruleset_definitions: [
      { id: DEF, name_text: 'Spring OU', created_at: '2026-10-01', current_version_id: V1, head: versionRow(V1, 'Spring OU', ['Garchomp']), visibility: 'gallery' },
      { id: 'def-draft', name_text: 'Draft only', created_at: '2026-10-02', current_version_id: null, head: null, visibility: 'private' },
    ],
  });
});

describe('getRulesetById', () => {
  it('reads one version by id with a narrow select (never the document) and returns the read model', async () => {
    const ruleset = await getRulesetById(V1);

    const [query] = fake.current!.queries;
    expect(query.table).toBe('ruleset_definition_versions');
    expect(query.select).toBe('id, definition_id, version_no, name_text, resolved, created_by, created_at');
    expect(query.select).not.toContain('spec');
    expect(query.filters).toEqual([{ op: 'eq', column: 'id', value: V1 }]);
    expect(ruleset).toMatchObject({
      id: V1,
      name: 'Spring OU',
      base_format: 'gen9ou',
      gen: 9,
      clauses: ['Species Clause'],
      // Names come from the dex: ids hydrate to the English name.
      bans: { pokemon: ['Garchomp', 'Tapu Koko'], moves: [], items: [], abilities: [] },
      allow: { pokemon: null, moves: null, items: null, abilities: null },
      version: { definition_id: DEF, version_no: 2 },
    });
    expect(ruleset?.rules.pokemon.ids).toEqual(['garchomp', 'tapukoko']);
  });

  it('answers null for an unknown version and propagates a read error', async () => {
    expect(await getRulesetById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9')).toBeNull();
    fake.current = { ...fake.current!, client: { ...fake.current!.client, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error('db down') }) }) }) }) } };
    await expect(getRulesetById(V1)).rejects.toThrow('db down');
  });

  it('a stored id the dex does not know keeps the id as its name (a typo stays visible)', async () => {
    fake.current = createFakeSupabase({ ruleset_definition_versions: [versionRow(V1, 'Typos', ['garchmop'])] });
    expect((await getRulesetById(V1))?.bans.pokemon).toEqual(['garchmop']);
  });
});

describe('getHeadRuleset', () => {
  it('reads the head version of a definition through the current_version_id embed', async () => {
    const ruleset = await getHeadRuleset(DEF);
    expect(fake.current!.queries[0].select).toContain('head:ruleset_definition_versions!current_version_id');
    expect(ruleset).toMatchObject({ id: V1, bans: { pokemon: ['Garchomp'] } });
    expect(await getHeadRuleset('not-a-uuid')).toBeNull();
    expect(fake.current!.queries).toHaveLength(1);
  });

  it('a definition with nothing published has no head', async () => {
    expect(await getHeadRuleset('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1')).toBeNull();
  });
});

describe('listRulesets / listRulesetOptions', () => {
  it('lists the head version of each published definition, ordered by name, in one complete read', async () => {
    const rulesets = await listRulesets();
    expect(rulesets.map((r) => r.name)).toEqual(['Spring OU', 'Spring OU'].slice(0, rulesets.length));
    const [query] = fake.current!.queries;
    expect(query.table).toBe('ruleset_definitions');
    expect(query.orders).toEqual([{ column: 'name_text', ascending: true }, { column: 'id', ascending: true }]);
    expect(query.select).toContain('head:ruleset_definition_versions!current_version_id');
  });

  it('the picker options carry no rules and no document', async () => {
    fake.current = createFakeSupabase({
      ruleset_definitions: [{ id: DEF, name_text: 'Spring OU', head: { id: V1, version_no: 2, name_text: 'Spring OU', gen: 9, format_key: 'gen9ou', is_doubles: false } }],
    });
    const options = await listRulesetOptions({ playerId: 'p', isAdmin: true });
    expect(options).toEqual([{ id: V1, definition_id: DEF, name: 'Spring OU', is_doubles: false, gen: 9, base_format: 'gen9ou', version_no: 2 }]);
    expect(fake.current!.queries[0].select).not.toContain('resolved');
    expect(fake.current!.queries[0].select).not.toContain('spec');
  });
});

describe('listRulesetOptionsFor (the select of a league, phase or tournament form)', () => {
  const V0 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0';
  const HEAD = { id: V1, version_no: 2, name_text: 'Spring OU', gen: 9, format_key: 'gen9ou', is_doubles: false };
  const OLD = { id: V0, definition_id: DEF, version_no: 1, name_text: 'Spring OU', gen: 9, format_key: 'gen9ou', is_doubles: false };

  beforeEach(() => {
    fake.current = createFakeSupabase({
      ruleset_definitions: [{ id: DEF, name_text: 'Spring OU', visibility: 'gallery', head: HEAD }],
      ruleset_definition_versions: [OLD, { ...HEAD, definition_id: DEF }],
    });
  });

  it('lists the heads and adds a kept pin that is no longer a head, with its own version number', async () => {
    const options = await listRulesetOptionsFor({ actor: { playerId: 'p', isAdmin: true }, seasonId: 's1', keep: [V0, null, undefined] });
    expect(options).toEqual([
      { id: V1, definition_id: DEF, name: 'Spring OU', is_doubles: false, gen: 9, base_format: 'gen9ou', version_no: 2 },
      { id: V0, definition_id: DEF, name: 'Spring OU', is_doubles: false, gen: 9, base_format: 'gen9ou', version_no: 1 },
    ]);
    const [heads, kept] = fake.current!.queries;
    expect(heads.table).toBe('ruleset_definitions');
    expect(kept.table).toBe('ruleset_definition_versions');
    expect(kept.select).toBe('definition_id, id, version_no, name_text, gen, format_key, is_doubles');
    expect(kept.filters).toEqual([{ op: 'in', column: 'id', value: [V0] }]);
  });

  it('makes no second read when every kept pin is a head already, or when the pins are not ids', async () => {
    const options = await listRulesetOptionsFor({ actor: undefined, keep: [V1, 'not-a-uuid', null] });
    expect(options.map((o) => o.id)).toEqual([V1]);
    expect(fake.current!.queries).toHaveLength(1);
  });

  it('never selects the rules or the document', async () => {
    await listRulesetOptionsFor({ seasonId: null, keep: [V0] });
    for (const query of fake.current!.queries) {
      expect(query.select).not.toContain('resolved');
      expect(query.select).not.toContain('spec');
    }
  });

  it('a new league (season null) leaves the rulesets that belong to a league out; no season filter without one', async () => {
    await listRulesetOptionsFor({ seasonId: null });
    expect(fake.current!.queries[0].filters).toContainEqual({ op: 'is', column: 'season_id', value: null });
    fake.current!.reset();
    await listRulesetOptionsFor({});
    expect(fake.current!.queries[0].filters).not.toContainEqual({ op: 'is', column: 'season_id', value: null });
  });
});

describe('findHeadRulesetsByName', () => {
  it('reads the heads of the shared definitions with exactly this list name, oldest definition first', async () => {
    await findHeadRulesetsByName('Spring OU');
    const [query] = fake.current!.queries;
    // Shared site rows only: never another admin's private ruleset, never one that belongs to a league.
    expect(query.filters).toEqual([
      { op: 'eq', column: 'name_text', value: 'Spring OU' },
      { op: 'eq', column: 'visibility', value: 'gallery' },
      { op: 'is', column: 'season_id', value: null },
    ]);
    expect(query.orders[0]).toEqual({ column: 'created_at', ascending: true });
  });
});
