/**
 * The reads behind the ruleset library cards, the version list and the pin-impact check: how many leagues and phases pin each
 * definition, the catalog facts of a version, the frozen rules of chosen versions, the teams a pin governs and a roster's
 * assigned cores. In-memory PostgREST stand-in; nothing here reaches a database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/worlds/__tests__/fake-postgrest';

const fake = vi.hoisted(() => ({ current: null as FakeSupabase | null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (table: string) => (fake.current!.client.from as (t: string) => unknown)(table),
    rpc: (fn: string, args?: Record<string, unknown>) => fake.current!.client.rpc(fn, args),
  },
}));

import { countPinsByDefinition, listRulesetDefinitions, listRulesetVersions, listVersionRules, resolveNamedRulesets } from '../ruleset-definitions';
import { listParticipantCores } from '../seasons';
import { listTeamsForPinImpact } from '../teams';

const DEF_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const DEF_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const DEF_UNUSED = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

const pins = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `row-${i}` }));

beforeEach(() => {
  fake.current = null;
});

describe('countPinsByDefinition', () => {
  beforeEach(() => {
    fake.current = createFakeSupabase({
      ruleset_definition_versions: [
        { id: 'a1', definition_id: DEF_A, seasons: pins(2), tournaments: pins(1) },
        { id: 'a2', definition_id: DEF_A, seasons: pins(1), tournaments: pins(4) },
        { id: 'b1', definition_id: DEF_B, seasons: [], tournaments: pins(3) },
        { id: 'u1', definition_id: DEF_UNUSED, seasons: [], tournaments: [] },
      ],
    });
  });

  it('sums the pins over all versions of a definition from embedded counts, never fetching the pinned rows', async () => {
    const counts = await countPinsByDefinition([DEF_A, DEF_B, DEF_UNUSED]);

    expect(Object.fromEntries(counts)).toEqual({
      [DEF_A]: { seasons: 3, tournaments: 5 },
      [DEF_B]: { seasons: 0, tournaments: 3 },
      [DEF_UNUSED]: { seasons: 0, tournaments: 0 },
    });
    const [query] = fake.current!.queries;
    expect(query.table).toBe('ruleset_definition_versions');
    expect(query.select).toBe('definition_id, seasons ( count ), tournaments ( count )');
    expect(query.filters).toEqual([{ op: 'in', column: 'definition_id', value: [DEF_A, DEF_B, DEF_UNUSED] }]);
    expect(query.orders).toEqual([{ column: 'id', ascending: true }]);
  });

  it('lists a definition without any version row with zeros, and reads nothing for no ids or malformed ids', async () => {
    const missing = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
    expect((await countPinsByDefinition([missing])).get(missing)).toEqual({ seasons: 0, tournaments: 0 });

    fake.current!.reset();
    expect((await countPinsByDefinition([])).size).toBe(0);
    expect((await countPinsByDefinition(['not-a-uuid'])).size).toBe(0);
    expect(fake.current!.queries).toEqual([]);
  });

  it('asks for at most 50 definitions per request, so the filter stays short', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const counts = await countPinsByDefinition(ids);

    expect(counts.size).toBe(120);
    const sizes = fake.current!.queries.map((q) => (q.filters[0].value as string[]).length);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it('propagates a read error', async () => {
    fake.current = {
      ...fake.current!,
      client: { ...fake.current!.client, from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: null, error: new Error('db down') }) }) }) }) }) },
    };
    await expect(countPinsByDefinition([DEF_A])).rejects.toThrow('db down');
  });
});

describe('the catalog facts of a version', () => {
  const version = {
    id: 'v2',
    definition_id: DEF_A,
    version_no: 2,
    schema_version: 1,
    name_text: 'Spring OU',
    content_hash: 'h',
    resolved_hash: 'r',
    catalog_version: '2026-09-01.1',
    gen: 9,
    format_key: 'gen9ou',
    is_doubles: false,
    changelog: null,
    created_by: null,
    created_at: '2026-10-01T00:00:00Z',
    spec: { base: { kind: 'preset', preset: 'gen9ou' } },
  };

  it('a version list reads the base preset as a JSON path, never the document', async () => {
    fake.current = createFakeSupabase({ ruleset_definition_versions: [version, { ...version, id: 'v1', version_no: 1, spec: { base: { kind: 'blank', gen: 9 } } }] });

    const versions = await listRulesetVersions(DEF_A);

    const [query] = fake.current.queries;
    expect(query.select).toContain('base_preset:spec->base->>preset');
    expect(query.select).not.toMatch(/(^|, )spec(,|$)/);
    expect(versions.map((v) => [v.version_no, v.catalog_version, v.base_preset])).toEqual([
      [2, '2026-09-01.1', 'gen9ou'],
      [1, '2026-09-01.1', null],
    ]);
  });

  it('a definition list carries the head version catalog version and base preset', async () => {
    fake.current = createFakeSupabase({
      ruleset_definitions: [
        {
          id: DEF_A,
          slug: 'spring',
          name: { base: 'en', en: { v: 'Spring OU', s: 'human' } },
          description: null,
          kind: 'custom',
          owner_id: null,
          visibility: 'gallery',
          season_id: null,
          forked_from: null,
          draft_rev: 1,
          current_version_id: 'v2',
          created_at: '2026-10-01',
          updated_at: '2026-10-02',
          owner: null,
          current_version: { id: 'v2', version_no: 2, content_hash: 'h', created_at: '2026-10-02', catalog_version: '2026-09-01.1', spec: { base: { kind: 'preset', preset: 'gen9ou' } } },
        },
      ],
    });

    const { items } = await listRulesetDefinitions({ actor: { playerId: 'p1', isAdmin: true }, scope: 'all', limit: 10, offset: 0 });

    expect(fake.current.queries[0].select).toContain('catalog_version, base_preset:spec->base->>preset');
    expect(items[0].current_version).toEqual({ id: 'v2', version_no: 2, content_hash: 'h', created_at: '2026-10-02', catalog_version: '2026-09-01.1', base_preset: 'gen9ou' });
  });
});

describe('listVersionRules', () => {
  const rules = (gen: number) => ({ v: 1, gen });

  it('reads the frozen rules of the named versions of one definition, and nothing else', async () => {
    fake.current = createFakeSupabase({
      ruleset_definition_versions: [
        { definition_id: DEF_A, version_no: 1, resolved: rules(1) },
        { definition_id: DEF_A, version_no: 2, resolved: rules(2) },
        { definition_id: DEF_A, version_no: 3, resolved: rules(3) },
        { definition_id: DEF_B, version_no: 2, resolved: rules(9) },
      ],
    });

    const found = await listVersionRules(DEF_A, [2, 3]);

    expect([...found.keys()].sort()).toEqual([2, 3]);
    expect((found.get(2) as unknown as { gen: number }).gen).toBe(2);
    expect(fake.current.queries[0].select).toBe('version_no, resolved');
    expect(fake.current.queries[0].filters).toEqual([
      { op: 'eq', column: 'definition_id', value: DEF_A },
      { op: 'in', column: 'version_no', value: [2, 3] },
    ]);
  });

  it('reads nothing for no versions or a malformed id, and never more than 25 versions', async () => {
    fake.current = createFakeSupabase({ ruleset_definition_versions: [] });
    expect((await listVersionRules(DEF_A, [])).size).toBe(0);
    expect((await listVersionRules('nope', [1])).size).toBe(0);
    expect(fake.current.queries).toEqual([]);

    await listVersionRules(DEF_A, Array.from({ length: 40 }, (_, i) => i + 1));
    expect((fake.current.queries[0].filters[1].value as number[]).length).toBe(25);
  });
});

describe('listTeamsForPinImpact', () => {
  const SEASON = 'ssssssss-ssss-4sss-8sss-sssssssssss1';
  const PHASE = 'tttttttt-tttt-4ttt-8ttt-ttttttttttt1';
  const team = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    player_id: `player-${id}`,
    pokemon: [{ species: 'Garchomp' }],
    locked: false,
    season_id: null,
    tournament_id: null,
    match: null,
    ...over,
  });

  beforeEach(() => {
    fake.current = createFakeSupabase({
      teams: [
        team('league-1', { season_id: SEASON }),
        team('league-2', { season_id: SEASON }),
        team('league-locked', { season_id: SEASON, locked: true }),
        // A team of one of the league's phases belongs to the phase's pin, not the league's own.
        team('phase-1', { season_id: SEASON, tournament_id: PHASE }),
        team('phase-2', { tournament_id: PHASE, match: { status: 'scheduled' } }),
        team('phase-history', { tournament_id: PHASE, match: { status: 'completed' } }),
        team('elsewhere', { tournament_id: 'other' }),
      ],
    });
  });

  it('a league own teams: its season rows with no phase, minus the locked ones', async () => {
    const { teams, truncated } = await listTeamsForPinImpact({ kind: 'season', id: SEASON }, 100);

    expect(teams.map((t) => t.id).sort()).toEqual(['league-1', 'league-2']);
    expect(truncated).toBe(false);
    expect(teams[0]).toEqual({ id: expect.any(String), player_id: expect.any(String), pokemon: [{ species: 'Garchomp' }] });
  });

  it('a phase teams, without the ones linked to a completed match (their rosters are history)', async () => {
    const { teams } = await listTeamsForPinImpact({ kind: 'tournament', id: PHASE }, 100);
    expect(teams.map((t) => t.id).sort()).toEqual(['phase-1', 'phase-2']);
  });

  it('reads only the roster columns, in id order and bounded pages, and never share or library columns', async () => {
    await listTeamsForPinImpact({ kind: 'tournament', id: PHASE }, 100);

    const [query] = fake.current!.queries;
    expect(query.select).toBe('id, player_id, pokemon, match:matches!teams_match_id_fkey(status)');
    expect(query.orders).toEqual([{ column: 'id', ascending: true }]);
    expect(query.range).toEqual({ from: 0, to: 999 });
  });

  it('stops at the limit and says so', async () => {
    const { teams, truncated } = await listTeamsForPinImpact({ kind: 'season', id: SEASON }, 1);
    expect(teams).toHaveLength(1);
    expect(truncated).toBe(true);
  });
});

describe('listParticipantCores', () => {
  it('maps each player of the roster to the assigned core and leaves out players without one', async () => {
    fake.current = createFakeSupabase({
      season_participants: [
        { season_id: 's1', player_id: 'p1', core_types: ['fire', 'water', 'grass'] },
        { season_id: 's1', player_id: 'p2', core_types: null },
        { season_id: 's1', player_id: 'p3', core_types: ['fire', 'water'] },
        { season_id: 's2', player_id: 'p4', core_types: ['ice', 'ghost', 'dark'] },
      ],
    });

    const cores = await listParticipantCores('s1');

    expect([...cores]).toEqual([['p1', ['fire', 'water', 'grass']]]);
    expect(fake.current.queries[0].select).toBe('player_id, core_types');
    expect(fake.current.queries[0].filters).toEqual([{ op: 'eq', column: 'season_id', value: 's1' }]);
  });
});

describe('resolveNamedRulesets', () => {
  const DEF_PUBLISHED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const HEAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
  const DEF_DRAFT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  /** A legacy ruleset id: the id of version 1 of its definition. */
  const LEGACY_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const LEGACY_DEF = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
  const LEGACY_HEAD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
  const UNKNOWN = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

  beforeEach(() => {
    fake.current = createFakeSupabase({
      ruleset_definitions: [
        { id: DEF_PUBLISHED, current_version_id: HEAD },
        { id: DEF_DRAFT, current_version_id: null },
        { id: LEGACY_DEF, current_version_id: LEGACY_HEAD },
      ],
      ruleset_definition_versions: [
        { id: LEGACY_ID, definition: { id: LEGACY_DEF, current_version_id: LEGACY_HEAD } },
      ],
    });
  });

  it('resolves a definition id to itself and its head, and a legacy ruleset id (a version id) to its definition and head', async () => {
    const resolved = await resolveNamedRulesets([DEF_PUBLISHED, LEGACY_ID, DEF_PUBLISHED]);
    expect(Object.fromEntries(resolved)).toEqual({
      [DEF_PUBLISHED]: { definition_id: DEF_PUBLISHED, head_version_id: HEAD },
      [LEGACY_ID]: { definition_id: LEGACY_DEF, head_version_id: LEGACY_HEAD },
    });
  });

  it('leaves out a draft-only definition and an unknown id, and does not look a draft up as a version', async () => {
    const resolved = await resolveNamedRulesets([DEF_DRAFT, UNKNOWN]);
    expect(resolved.size).toBe(0);
    const versionReads = fake.current!.queries.filter((q) => q.table === 'ruleset_definition_versions');
    expect(versionReads).toHaveLength(1);
    expect(versionReads[0].filters).toEqual([{ op: 'in', column: 'id', value: [UNKNOWN] }]);
  });

  it('reads nothing for no ids or malformed ids', async () => {
    expect((await resolveNamedRulesets([])).size).toBe(0);
    expect((await resolveNamedRulesets(['nope'])).size).toBe(0);
    expect(fake.current!.queries).toEqual([]);
  });
});
