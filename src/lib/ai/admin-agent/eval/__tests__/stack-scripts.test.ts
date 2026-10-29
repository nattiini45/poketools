import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ADMIN_IDENTITIES, loadBaseline, seedFor, type LoaderDb, type LoaderDeps, type Row } from '../../../../../../scripts/admin-agent-eval/baseline';
import { installRouteFaults } from '../../../../../../scripts/admin-agent-eval/faults';
import { evalUuid } from '../world';

/**
 * The parts of the local-stack harness that need no database: the fixture loader against a fake client, and the route faults against a
 * fake binding registry. (The stages themselves are exercised against the real local stack by `scripts/admin-agent-eval.ts`.)
 */
function fakeDb() {
  const tables = new Map<string, Map<string, Row>>();
  const keyOf = (row: Row, onConflict: string) => onConflict.split(',').map((column) => String(row[column])).join('|');
  const db: LoaderDb = {
    async upsert(table, rows, onConflict) {
      const t = tables.get(table) ?? new Map<string, Row>();
      for (const row of rows) t.set(keyOf(row, onConflict), { ...(t.get(keyOf(row, onConflict)) ?? {}), ...row });
      tables.set(table, t);
    },
    async find(table, match) {
      return [...(tables.get(table)?.values() ?? [])].filter((row) => Object.entries(match).every(([column, value]) => row[column] === value));
    },
  };
  return { db, tables, rows: (table: string) => [...(tables.get(table)?.values() ?? [])] };
}

function fakeDeps(db: ReturnType<typeof fakeDb>) {
  const published: Array<{ preset: string; name: string }> = [];
  const deps: LoaderDeps = {
    runTag: 'ab12',
    async publishPresetRuleset({ preset, name }) {
      published.push({ preset, name });
      const n = published.length;
      const definitionId = evalUuid('test-def', `${preset}:${name}:${n}`);
      const versionId = evalUuid('test-version', `${preset}:${name}:${n}`);
      await db.db.upsert('ruleset_definitions', [{ id: definitionId, slug: preset, kind: 'preset', current_version_id: versionId }], 'id');
      await db.db.upsert('ruleset_definition_versions', [{ id: versionId, definition_id: definitionId, version_no: 1 }], 'id');
      return { definitionId, versionId };
    },
  };
  return { deps, published };
}

describe('loadBaseline', () => {
  it('writes the plan\'s baseline with the ids the plan stage\'s world uses', async () => {
    const fake = fakeDb();
    const { deps, published } = fakeDeps(fake);
    const baseline = await loadBaseline(fake.db, deps, (preset) => `Name of ${preset}`);

    expect(baseline.players).toHaveLength(24);
    expect(baseline.players[2]).toEqual({ id: evalUuid('player', '03'), name: 'Eval Player 03' });
    expect(fake.rows('players').filter((p) => /^Eval Player \d\d$/.test(String(p.name)))).toHaveLength(24);
    // Every registered player has an identity (the table's check constraint), the admins carry theirs, and only the site admin is an admin.
    expect(fake.rows('players').every((p) => typeof p.discord_id === 'string')).toBe(true);
    expect(fake.rows('players').filter((p) => p.is_admin === true).map((p) => p.name)).toEqual([ADMIN_IDENTITIES.site_admin.name]);
    expect(baseline.admins.league_admin.id).toBe(evalUuid('admin', 'league_admin'));

    // The standard rulesets are site-catalog definitions published once each, and league L1 and tournament T1 pin the OU version.
    expect(published.map((p) => p.preset)).toEqual(['gen9ou', 'gen9ubers', 'gen9nu', 'gen9doublesou']);
    expect(baseline.rulesets.map((r) => r.preset)).toEqual(['gen9ou', 'gen9ubers', 'gen9nu', 'gen9doublesou']);
    const l1 = fake.rows('seasons').find((s) => s.id === baseline.leagueId)!;
    expect(l1).toMatchObject({ name: 'Eval League One', status: 'upcoming', start_date: '2026-11-02', ruleset_id: baseline.rulesets[0].versionId });
    expect(fake.rows('season_participants')).toHaveLength(12);
    expect(fake.rows('tournaments').filter((t) => t.season_id === baseline.leagueId).map((t) => [t.name, t.bracket_type, t.stage_order])).toEqual([
      ['Regular Season', 'round_robin', 1],
      ['Playoffs', 'single_elim', 2],
    ]);
    expect(fake.rows('tournaments').find((t) => t.id === baseline.tournamentId)).toMatchObject({ season_id: null, bracket_type: 'single_elim', status: 'upcoming' });
    expect(fake.rows('tournament_participants').filter((p) => p.tournament_id === baseline.tournamentId)).toHaveLength(8);

    // The league admin manages L1 and the tournament admin manages T1, and neither is a site admin.
    expect(fake.rows('resource_admins')).toEqual([
      { player_id: baseline.admins.league_admin.id, resource_type: 'season', resource_id: baseline.leagueId },
      { player_id: baseline.admins.tournament_admin.id, resource_type: 'tournament', resource_id: baseline.tournamentId },
    ]);
  });

  it('is idempotent: a second load writes the same rows and publishes nothing again', async () => {
    const fake = fakeDb();
    const { deps, published } = fakeDeps(fake);
    const first = await loadBaseline(fake.db, deps, (preset) => preset);
    const snapshot = JSON.stringify([...fake.tables.entries()].map(([name, rows]) => [name, [...rows.keys()].sort()]));
    const second = await loadBaseline(fake.db, deps, (preset) => preset);
    expect(JSON.stringify([...fake.tables.entries()].map(([name, rows]) => [name, [...rows.keys()].sort()]))).toBe(snapshot);
    expect(published).toHaveLength(4);
    expect(second.rulesets).toEqual(first.rulesets);
    expect(second.players).toEqual(first.players);
  });
});

describe('seedFor', () => {
  it('creates a ready league with two phases and a roster, named with the case id and the run tag', async () => {
    const fake = fakeDb();
    const { deps } = fakeDeps(fake);
    const baseline = await loadBaseline(fake.db, deps, (preset) => preset);
    const seeded = await seedFor(fake.db, deps, baseline, 'LG6', 1, 'ready_league');
    expect(seeded.name).toBe('LG6 Ready League ab121');
    expect(seeded.phaseIds).toHaveLength(2);
    expect(fake.rows('seasons').find((s) => s.id === seeded.id)).toMatchObject({ status: 'upcoming', ruleset_id: baseline.rulesets[0].versionId });
    expect(fake.rows('tournaments').filter((t) => t.season_id === seeded.id)).toHaveLength(2);
    expect(fake.rows('tournament_participants').filter((p) => p.tournament_id === seeded.phaseIds![0])).toHaveLength(12);
    // Another repeat gets another league: a case that consumes it can run again.
    const again = await seedFor(fake.db, deps, baseline, 'LG6', 2, 'ready_league');
    expect(again.id).not.toBe(seeded.id);
    expect(again.name).toBe('LG6 Ready League ab122');
  });

  it('creates a ready tournament of eight players, and a started league on a ruleset of its own', async () => {
    const fake = fakeDb();
    const { deps, published } = fakeDeps(fake);
    const baseline = await loadBaseline(fake.db, deps, (preset) => preset);
    const cup = await seedFor(fake.db, deps, baseline, 'TN2', 1, 'ready_tournament');
    expect(fake.rows('tournaments').find((t) => t.id === cup.id)).toMatchObject({ season_id: null, status: 'upcoming', name: 'TN2 Ready Cup ab121' });
    expect(fake.rows('tournament_participants').filter((p) => p.tournament_id === cup.id).map((p) => p.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const started = await seedFor(fake.db, deps, baseline, 'RS3', 1, 'started_league_ruleset');
    expect(published.at(-1)).toEqual({ preset: 'gen9ou', name: 'RS3 Gen 9 OU ab121' });
    expect(started).toMatchObject({ rulesetName: 'RS3 Gen 9 OU ab121' });
    expect(fake.rows('seasons').find((s) => s.id === started.id)).toMatchObject({ status: 'active', ruleset_id: started.rulesetVersionId });
    // It does not touch the baseline's own OU ruleset.
    expect(started.rulesetVersionId).not.toBe(baseline.rulesets[0].versionId);
  });
});

describe('installRouteFaults', () => {
  type Handler = (request: never, context: never) => Promise<Response>;
  function registry() {
    const committed: string[] = [];
    const handler: Handler = async () => {
      committed.push('write');
      return new Response(JSON.stringify({ success: true }), { status: 201 });
    };
    const binding = { operation: 'phase_create', method: 'POST', load: async () => ({ POST: handler }) };
    return { committed, binding, registry: { get: (op: string) => (op === 'phase_create' ? (binding as never) : undefined) } };
  }
  const call = async (binding: { load: () => Promise<Record<string, unknown>> }) => {
    const mod = await binding.load();
    return (mod.POST as Handler)({} as never, {} as never);
  };

  it('commits and then answers a masked 500 on the Nth call only', async () => {
    const { committed, binding, registry: reg } = registry();
    const faults = installRouteFaults(reg, [{ op: 'phase_create', nth: 2, mode: 'commit_then_500' }]);
    expect((await call(binding)).status).toBe(201);
    const masked = await call(binding);
    expect(masked.status).toBe(500);
    expect(JSON.stringify(await masked.json())).not.toMatch(/commit|write/i);
    expect(committed).toHaveLength(2);
    expect((await call(binding)).status).toBe(201);
    expect(faults.calls()).toEqual({ phase_create: 3 });
    faults.restore();
  });

  it('answers 500 at once and commits only when released, inside the context of the call', async () => {
    const { committed, binding, registry: reg } = registry();
    const faults = installRouteFaults(reg, [{ op: 'phase_create', nth: 1, mode: 'late_commit_500' }]);
    expect((await call(binding)).status).toBe(500);
    expect(committed).toEqual([]);
    await faults.release();
    expect(committed).toEqual(['write']);
    // Released once: nothing is left to commit.
    await faults.release();
    expect(committed).toEqual(['write']);
    faults.restore();
  });

  it('puts the binding back, and refuses an op without a binding', async () => {
    const { committed, binding, registry: reg } = registry();
    const original = binding.load;
    const faults = installRouteFaults(reg, [{ op: 'phase_create', nth: 1, mode: 'commit_then_500' }]);
    expect(binding.load).not.toBe(original);
    faults.restore();
    expect(binding.load).toBe(original);
    expect((await call(binding)).status).toBe(201);
    expect(committed).toHaveLength(1);
    expect(() => installRouteFaults(reg, [{ op: 'nope', nth: 1, mode: 'commit_then_500' }])).toThrow(/without a binding/);
  });
});
