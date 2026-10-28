/**
 * Registry invariants of the Build bindings (`_ops/g`): what the executor's recheck and the second lock depend on. Every
 * binding agrees with the route staging names, declares strict schemas, loads a real handler, and is in the route manifest;
 * the operations of later phases have no binding at all.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { from: vi.fn() } }));

import { checkCall, pathParamNames } from '@/lib/ai/admin-agent/dispatch';
import { uid } from '@/lib/ai/admin-agent/plans/__tests__/fixtures';
import { PLAN_OPS } from '@/lib/ai/admin-agent/plans/ops';
import { BUILD_OP_ROUTES } from '@/lib/ai/admin-agent/proposals/build';
import { REPO_ROOT } from '@/lib/ai/admin-agent/__tests__/architecture/graph';
import { BUILD_BINDINGS, getBindingRegistry } from '../_ops/g';

const registry = getBindingRegistry();
const ID = uid(7001);
const RULESET = uid(9001);

/** A body each binding accepts, and the path params it needs. */
const SAMPLES: Record<string, { params: Record<string, string>; body: unknown }> = {
  league_create: { params: {}, body: { name: 'League', format_type: 'singles', language: 'de' } },
  roster_add: { params: { id: ID }, body: { player_ids: [uid(100)] } },
  phase_create: { params: { id: ID }, body: { name: 'Phase', bracket_type: 'round_robin', ruleset_id: RULESET, best_of_default: 1, is_doubles: false, team_visibility: 'hidden_until_match' } },
  tournament_create: { params: {}, body: { name: 'Cup', bracket_type: 'single_elim', ruleset_id: RULESET, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' } },
  league_archive: { params: { id: ID }, body: { archived: true } },
  roster_remove: { params: { id: ID }, body: { player_id: uid(100) } },
  tournament_archive: { params: { id: ID }, body: { archived: true } },
};

const manifest = (JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/data/route-manifest-bindings.json'), 'utf8')) as { bindings: Array<{ method: string; path: string; class: string; phase: string }> }).bindings;

describe('the Build registry', () => {
  it('holds the four Build operations of phase 1 and the three compensating calls they declare', () => {
    expect(registry.all().map((binding) => binding.operation)).toEqual(['league_create', 'roster_add', 'phase_create', 'tournament_create', 'league_archive', 'roster_remove', 'tournament_archive']);
    expect(BUILD_BINDINGS).toHaveLength(registry.all().length);
  });

  it('binds no operation of a later phase: a stored groups or draft step is stale (unknown op) until its phase ships', () => {
    expect(registry.has('groups_set')).toBe(false);
    expect(registry.has('draft_pool_create')).toBe(false);
    const bound = PLAN_OPS.filter((op) => registry.has(op));
    expect(bound).toEqual(['league_create', 'roster_add', 'phase_create', 'tournament_create']);
  });

  it('agrees with the route staging names for every operation it binds (the recheck compares both)', () => {
    for (const op of PLAN_OPS.filter((candidate) => registry.has(candidate))) {
      const binding = registry.get(op)!;
      expect({ method: binding.method, path: binding.path }, op).toEqual({ method: BUILD_OP_ROUTES[op].method, path: BUILD_OP_ROUTES[op].routeTemplate });
      expect(binding.class, op).toBe('B');
    }
  });

  it('is class B, phase 1, with a read-back and a declared reversal, for every binding', () => {
    for (const binding of registry.all()) {
      expect(binding.class, binding.operation).toBe('B');
      expect(binding.phase, binding.operation).toBe(1);
      expect(typeof binding.verify, binding.operation).toBe('function');
      expect(binding.reversal, binding.operation).toBeDefined();
      expect(binding.method, binding.operation).not.toBe('GET');
    }
  });

  it('keeps the reversal targets in the registry, and the compensating calls without a reversal of their own', () => {
    for (const binding of registry.all()) {
      if (binding.reversal?.kind !== 'compensating') continue;
      const target = registry.get(binding.reversal.operation);
      expect(target, `${binding.operation} -> ${binding.reversal.operation}`).toBeDefined();
      expect(target?.reversal, binding.reversal.operation).toEqual({ kind: 'none' });
    }
  });
});

describe('the schemas every binding declares (spec §18.6)', () => {
  it('declares a body schema (null says no body) and, for a path with parameters, a params schema', () => {
    for (const binding of registry.all()) {
      expect(binding.bodySchema, `${binding.operation} bodySchema`).not.toBeUndefined();
      if (pathParamNames(binding.path).length > 0) expect(binding.paramsSchema, `${binding.operation} paramsSchema`).toBeDefined();
    }
  });

  it('accepts the sample request of each binding', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(registry.all().map((binding) => binding.operation).sort());
    for (const binding of registry.all()) {
      const sample = SAMPLES[binding.operation];
      expect(checkCall(binding, sample), binding.operation).toEqual({ ok: true });
    }
  });

  it('refuses a key the route would silently drop, in every body', () => {
    for (const binding of registry.all()) {
      const sample = SAMPLES[binding.operation];
      const tampered = { ...(sample.body as object), zz_injected: true };
      expect(checkCall(binding, { params: sample.params, body: tampered }), binding.operation).toMatchObject({ ok: false, reason: 'body' });
    }
  });

  it('refuses a path id that is not a uuid, a missing one and an extra one', () => {
    for (const binding of registry.all().filter((candidate) => pathParamNames(candidate.path).length > 0)) {
      const sample = SAMPLES[binding.operation];
      const bad: Array<Record<string, string>> = [{ id: 'not-a-uuid' }, { id: '../admin' }, { id: `${ID}/x` }, {}, { ...sample.params, other: ID }];
      for (const params of bad) {
        expect(checkCall(binding, { params, body: sample.body }), `${binding.operation} ${JSON.stringify(params)}`).toMatchObject({ ok: false, reason: 'params' });
      }
    }
  });

  it('names the exact path parameters of each route', () => {
    for (const binding of registry.all()) expect(Object.keys(SAMPLES[binding.operation].params).sort(), binding.operation).toEqual(pathParamNames(binding.path).sort());
  });

  it('keeps what the Plan never sends out of the body: a theme, a position, a season on a tournament, copied league admins', () => {
    const league = registry.get('league_create')!;
    const body = SAMPLES.league_create.body as object;
    expect(checkCall(league, { params: {}, body: { ...body, route_theme: 'forest' } }).ok).toBe(false);
    expect(checkCall(league, { params: {}, body: { ...body, clone_from: { season_id: ID, copy_roster: true, copy_admins: true } } }).ok).toBe(false);
    expect(checkCall(league, { params: {}, body: { ...body, clone_from: { season_id: ID, copy_roster: true, copy_admins: false } } }).ok).toBe(true);
    const phase = SAMPLES.phase_create;
    for (const extra of [{ insert_at: 1 }, { stage_order: 1 }, { season_id: ID }]) {
      expect(checkCall(registry.get('phase_create')!, { params: phase.params, body: { ...(phase.body as object), ...extra } }).ok, JSON.stringify(extra)).toBe(false);
    }
    for (const extra of [{ season_id: ID }, { stage_order: 1 }]) {
      expect(checkCall(registry.get('tournament_create')!, { params: {}, body: { ...(SAMPLES.tournament_create.body as object), ...extra } }).ok, JSON.stringify(extra)).toBe(false);
    }
  });

  it('lets the archives archive and nothing else', () => {
    for (const op of ['league_archive', 'tournament_archive']) {
      const binding = registry.get(op)!;
      for (const body of [{ archived: false }, { archived: true, status: 'completed' }, { status: 'completed' }, {}]) {
        expect(checkCall(binding, { params: { id: ID }, body }).ok, `${op} ${JSON.stringify(body)}`).toBe(false);
      }
    }
  });

  it('fails closed on a binding without a schema, and sends an empty-body route nothing', () => {
    const bare = { ...registry.get('roster_add')!, bodySchema: undefined, paramsSchema: undefined };
    expect(checkCall(bare, { params: { id: ID }, body: {} })).toMatchObject({ ok: false, reason: 'no_schema' });
    expect(checkCall({ ...bare, paramsSchema: registry.get('roster_add')!.paramsSchema }, { params: { id: ID }, body: {} })).toMatchObject({ ok: false, reason: 'no_schema', issues: ['body'] });
    const empty = { ...registry.get('league_create')!, bodySchema: null };
    expect(checkCall(empty, { params: {}, body: undefined })).toEqual({ ok: true });
    expect(checkCall(empty, { params: {}, body: null })).toEqual({ ok: true });
    expect(checkCall(empty, { params: {}, body: {} })).toMatchObject({ ok: false, reason: 'body' });
  });
});

describe('the routes the bindings load', () => {
  it('each resolves to a module that exports the handler for its method', async () => {
    for (const binding of registry.all()) {
      const routeModule = await binding.load();
      expect(typeof routeModule[binding.method], `${binding.operation} ${binding.method} ${binding.path}`).toBe('function');
    }
  }, 60_000);

  it('are all bound in the route manifest as class B, phase P1 (the manifest records their guard, schemas and imports)', () => {
    for (const binding of registry.all()) {
      const entry = manifest.find((candidate) => candidate.method === binding.method && candidate.path === binding.path);
      expect(entry, `${binding.method} ${binding.path}`).toBeDefined();
      expect(entry?.class, binding.operation).toBe('B');
      expect(entry?.phase, binding.operation).toBe('P1');
    }
  });
});
