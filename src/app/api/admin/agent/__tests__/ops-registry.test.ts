/**
 * Registry invariants of the bindings (`_ops/g`): what the executor's recheck and the second lock depend on. Every binding
 * agrees with the route staging names, declares strict schemas, loads a real handler, and is in the route manifest; the
 * operations of later phases have no binding at all. The Build bindings are class B, the four stageable Go-live bindings
 * class G (their agreement with the cards `proposals/golive.ts` stages is in `ops-golive.test.ts`).
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
import { GOLIVE_STAGEABLE } from '@/lib/ai/admin-agent/proposals/golive';
import { OUTWARD } from '@/lib/ai/admin-agent/registry/outward-effects';
import { REPO_ROOT } from '@/lib/ai/admin-agent/__tests__/architecture/graph';
import { BUILD_BINDINGS, GOLIVE_BINDINGS, OP_BINDINGS, UNDO_BINDINGS, getBindingRegistry } from '../_ops/g';

const registry = getBindingRegistry();
const ID = uid(7001);
const RULESET = uid(9001);
const PHASE = uid(7101);
const GOLIVE_OPS = ['publish_ruleset', 'move_pin', 'start_phase', 'generate_bracket'];
/** The two reversals only an undo holds (slice 5), with the class of their route: a draft restore is D, the delete of a never-published draft G. */
const UNDO_ONLY_OPS = { ruleset_restore_draft: 'D', ruleset_delete_draft: 'G' } as const;

/** A body each binding accepts, and the path params it needs. */
const SAMPLES: Record<string, { params: Record<string, string>; body: unknown }> = {
  league_create: { params: {}, body: { name: 'League', format_type: 'singles', language: 'de' } },
  roster_add: { params: { id: ID }, body: { player_ids: [uid(100)] } },
  phase_create: { params: { id: ID }, body: { name: 'Phase', bracket_type: 'round_robin', ruleset_id: RULESET, best_of_default: 1, is_doubles: false, team_visibility: 'hidden_until_match' } },
  tournament_create: { params: {}, body: { name: 'Cup', bracket_type: 'single_elim', ruleset_id: RULESET, best_of_default: 3, is_doubles: false, team_visibility: 'hidden_until_match' } },
  tournament_participant_add: { params: { id: ID }, body: { player_id: uid(100) } },
  tournament_participant_remove: { params: { id: ID }, body: { player_id: uid(100) } },
  league_archive: { params: { id: ID }, body: { archived: true } },
  roster_remove: { params: { id: ID }, body: { player_id: uid(100) } },
  tournament_archive: { params: { id: ID }, body: { archived: true } },
  publish_ruleset: { params: { id: RULESET }, body: { draft_rev: 3 } },
  move_pin: {
    params: { id: RULESET },
    body: { to_version_no: 2, targets: [{ kind: 'season', id: ID }, { kind: 'tournament', id: PHASE }], confirm_started: [ID] },
  },
  start_phase: { params: { tid: PHASE }, body: {} },
  generate_bracket: { params: { id: PHASE }, body: {} },
  ruleset_restore_draft: { params: { id: RULESET }, body: { draft_rev: 4, document: { schema_version: 1 } } },
  ruleset_delete_draft: { params: { id: RULESET }, body: null },
};

const manifest = (JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/data/route-manifest-bindings.json'), 'utf8')) as { bindings: Array<{ method: string; path: string; class: string; phase: string }> }).bindings;

describe('the registry', () => {
  it('holds the five Build operations of phase 1, the four compensating calls they declare and the four stageable Go-live operations', () => {
    expect(registry.all().map((binding) => binding.operation)).toEqual([
      'league_create',
      'roster_add',
      'phase_create',
      'tournament_create',
      'tournament_participant_add',
      'league_archive',
      'roster_remove',
      'tournament_archive',
      'tournament_participant_remove',
      ...GOLIVE_OPS,
      'ruleset_restore_draft',
      'ruleset_delete_draft',
    ]);
    expect(OP_BINDINGS).toHaveLength(registry.all().length);
    expect(BUILD_BINDINGS).toHaveLength(9);
    expect(UNDO_BINDINGS.map((binding) => binding.operation)).toEqual(Object.keys(UNDO_ONLY_OPS));
    expect(GOLIVE_BINDINGS.map((binding) => binding.operation)).toEqual(GOLIVE_OPS);
  });

  it('binds exactly the Go-live tools staging can stage (propose_publish_ruleset -> publish_ruleset, ...)', () => {
    expect(GOLIVE_STAGEABLE.map((tool) => tool.replace(/^propose_/, ''))).toEqual(GOLIVE_OPS);
  });

  it('binds no operation of a later phase: a stored groups or draft step is stale (unknown op) until its phase ships', () => {
    expect(registry.has('groups_set')).toBe(false);
    expect(registry.has('draft_pool_create')).toBe(false);
    const bound = PLAN_OPS.filter((op) => registry.has(op));
    expect(bound).toEqual(['league_create', 'roster_add', 'phase_create', 'tournament_create', 'tournament_participant_add']);
    // The Go-live tools staging does not stage yet have no binding either.
    for (const op of ['generate_round', 'start_round', 'complete_round', 'advance_phase', 'complete_tournament', 'league_status', 'league_trash', 'undo']) {
      expect(registry.has(op), op).toBe(false);
    }
  });

  it('agrees with the route staging names for every Build operation it binds (the recheck compares both)', () => {
    for (const op of PLAN_OPS.filter((candidate) => registry.has(candidate))) {
      const binding = registry.get(op)!;
      expect({ method: binding.method, path: binding.path }, op).toEqual({ method: BUILD_OP_ROUTES[op].method, path: BUILD_OP_ROUTES[op].routeTemplate });
      expect(binding.class, op).toBe('B');
    }
  });

  it('is phase 1, with a read-back and a declared reversal, for every binding: class B for a Build op, class G for a Go-live op', () => {
    for (const binding of registry.all()) {
      expect(binding.class, binding.operation).toBe(binding.operation in UNDO_ONLY_OPS ? UNDO_ONLY_OPS[binding.operation as keyof typeof UNDO_ONLY_OPS] : GOLIVE_OPS.includes(binding.operation) ? 'G' : 'B');
      expect(binding.phase, binding.operation).toBe(1);
      expect(typeof binding.verify, binding.operation).toBe('function');
      expect(binding.reversal, binding.operation).toBeDefined();
      expect(binding.method, binding.operation).not.toBe('GET');
    }
  });

  it('declares the outward effects of every Go-live binding, group for group as the tool does, and none for a Build op', () => {
    for (const binding of registry.all()) {
      if (binding.operation === 'ruleset_delete_draft') {
        // The undo card's own group: nothing is posted, and the card's acknowledgement is the one of `propose_undo`.
        expect(binding.outwardEffects, binding.operation).toEqual([{ group: 'compensating_changes', events: [] }]);
        expect(OUTWARD.undo.map((effect) => effect.key)).toEqual(['compensating_changes']);
        continue;
      }
      if (!GOLIVE_OPS.includes(binding.operation)) {
        expect(binding.outwardEffects, binding.operation).toBeUndefined();
        continue;
      }
      expect(binding.outwardEffects?.map((effect) => effect.group), binding.operation).toEqual(OUTWARD[binding.operation].map((effect) => effect.key));
    }
    // The two Go-live routes that post to Discord and social name the events they fire; the others fire none.
    expect(Object.fromEntries(GOLIVE_BINDINGS.map((binding) => [binding.operation, (binding.outwardEffects ?? []).flatMap((effect) => effect.events)]))).toEqual({
      publish_ruleset: [],
      move_pin: [],
      start_phase: ['round_generated', 'tournament_started'],
      generate_bracket: ['round_generated'],
    });
  });

  it('declares no reversal for a Go-live op: published, moved and started stay (a later proposal undoes a pin move)', () => {
    for (const binding of GOLIVE_BINDINGS) expect(binding.reversal, binding.operation).toEqual({ kind: 'none' });
  });

  it('keeps every Go-live route at the default step timeout (none of the four sets a maxDuration)', () => {
    for (const binding of GOLIVE_BINDINGS) expect(binding.timeoutMs, binding.operation).toBeUndefined();
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
      const name = pathParamNames(binding.path)[0];
      const bad: Array<Record<string, string>> = [{ [name]: 'not-a-uuid' }, { [name]: '../admin' }, { [name]: `${ID}/x` }, {}, { ...sample.params, other: ID }];
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

  it('lets a Go-live call carry only what staging stores: no start_round on a bracket, nothing but true on a start, no foreign confirm_started', () => {
    const check = (op: string, body: unknown) => checkCall(registry.get(op)!, { params: SAMPLES[op].params, body }).ok;
    expect(check('generate_bracket', { start_round: true })).toBe(false);
    expect(check('generate_bracket', { start_round: false })).toBe(false);
    expect(check('start_phase', { start_round: true })).toBe(true);
    expect(check('start_phase', { start_round: false })).toBe(false);
    expect(check('start_phase', { start_round: 'yes' })).toBe(false);
    expect(check('publish_ruleset', { draft_rev: 3, changelog: { base: 'en', en: { v: 'Banned Kingambit', s: 'human' } } })).toBe(true);
    expect(check('publish_ruleset', { draft_rev: 0 })).toBe(false);
    expect(check('publish_ruleset', {})).toBe(false);
    const pins = SAMPLES.move_pin.body as { to_version_no: number; targets: unknown[] };
    expect(check('move_pin', { ...pins, confirm_started: [uid(4242)] })).toBe(false);
    expect(check('move_pin', { to_version_no: 2, targets: pins.targets })).toBe(true);
    expect(check('move_pin', { to_version_no: 2, targets: [] })).toBe(false);
    expect(check('move_pin', { to_version_no: 2, targets: [{ kind: 'season', id: ID, name: 'x' }] })).toBe(false);
    expect(check('move_pin', { to_version_no: 2, targets: [{ kind: 'league', id: ID }] })).toBe(false);
    expect(check('move_pin', { to_version_no: 2, targets: [{ kind: 'season', id: ID }, { kind: 'season', id: ID }] })).toBe(false);
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

  it('are all bound in the route manifest with the class of the binding, phase P1 (the manifest records their guard, schemas and imports)', () => {
    for (const binding of registry.all()) {
      const entry = manifest.find((candidate) => candidate.method === binding.method && candidate.path === binding.path);
      expect(entry, `${binding.method} ${binding.path}`).toBeDefined();
      expect(entry?.class, binding.operation).toBe(binding.class);
      expect(entry?.phase, binding.operation).toBe('P1');
    }
  });
});
