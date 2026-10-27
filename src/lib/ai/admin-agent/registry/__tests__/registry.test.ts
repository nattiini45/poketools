import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ADMIN_AGENT_PHASES } from '../../env';
import {
  ALL_TOOLS,
  buildToolSet,
  DEFERRED_TOOLS,
  estimateToolTokens,
  getToolDefinition,
  isOffered,
  lookupOffered,
  NOT_TOOL_NAMES,
  runTool,
  toolHash,
  toWireTool,
  type StagedTool,
} from '../index';
import { canonicalJson, type JsonValue } from '../wire-schema';
import { STAGED_TOOLS } from '../staged';

/**
 * Registry invariants (plan 3.9 test 6, 3.6.8, 6.1): the class of every tool, what each class may carry, the role and
 * phase filtering, the byte-frozen tool set and its hash.
 */

const ROOT = process.cwd();
const sets = ADMIN_AGENT_PHASES.flatMap((maxPhase) => (['site', 'scoped'] as const).map((role) => buildToolSet({ role, maxPhase })));

interface Binding {
  method: string;
  path: string;
  class: string;
  phase: string;
  operation: string;
}
const bindings = (JSON.parse(readFileSync(path.join(ROOT, 'scripts/data/route-manifest-bindings.json'), 'utf8')) as { bindings: Binding[] }).bindings;

const staged = ALL_TOOLS.filter((tool): tool is StagedTool => tool.class === 'D' || tool.class === 'B' || tool.class === 'G');

/** The only routes a D tool may dispatch: the format draft routes and the ruleset-definition draft routes (plan 3.9 test 6). */
const ALLOWED_DRAFT_ROUTES = new Set([
  'POST /api/formats',
  'POST /api/formats/presets/[presetId]/fork',
  'POST /api/formats/[id]/fork',
  'PUT /api/formats/[id]/draft',
  'POST /api/ruleset-definitions',
  'POST /api/ruleset-definitions/presets/[presetId]/fork',
  'POST /api/ruleset-definitions/[id]/fork',
  'PUT /api/ruleset-definitions/[id]/draft',
]);

const routeKey = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

describe('names and classes', () => {
  it('registers snake_case names once, sorted, and every class is one of R, P, D, B, G', () => {
    const names = ALL_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual(names);
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
      expect(['R', 'P', 'D', 'B', 'G']).toContain(tool.class);
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.description).not.toMatch(/\s{2,}|\n/);
    }
  });

  it('gives R and P tools an execute path and D, B and G tools none', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.class === 'R' || tool.class === 'P') {
        expect(typeof (tool as { run?: unknown }).run).toBe('function');
      } else {
        expect((tool as { run?: unknown }).run).toBeUndefined();
        expect((tool as { execute?: unknown }).execute).toBeUndefined();
      }
    }
  });

  it('registers no N operation as a tool, and no deferred tool', () => {
    for (const tool of ALL_TOOLS) expect(NOT_TOOL_NAMES.has(tool.name)).toBe(false);
    const registered = new Set(ALL_TOOLS.map((tool) => tool.name));
    for (const deferred of DEFERRED_TOOLS) expect(registered.has(deferred.name)).toBe(false);
  });

  it('lists every deferred tool with a phase and a reason', () => {
    expect(DEFERRED_TOOLS.length).toBeGreaterThan(0);
    for (const deferred of DEFERRED_TOOLS) {
      expect(deferred.blockedBy.length).toBeGreaterThan(10);
      expect(ADMIN_AGENT_PHASES).toContain(deferred.phase);
    }
  });

  it('keeps the Plan tools, the Build and the Go-live cards at the phases the plan gives them', () => {
    const phase = (name: string) => getToolDefinition(name)?.phase;
    for (const name of ['plan_create', 'plan_set', 'plan_patch', 'plan_revert', 'request_clarification', 'propose_build', 'plan_validate']) expect(phase(name)).toBe(0);
    for (const name of ['ruleset_create_draft', 'ruleset_patch_draft', 'propose_publish_ruleset', 'propose_move_pin', 'propose_start_phase', 'propose_generate_bracket']) expect(phase(name)).toBe(1);
    for (const name of ['propose_league_trash', 'propose_advance_phase', 'propose_generate_round']) expect(phase(name)).toBe(2);
    expect(phase('propose_publish_format')).toBe(3);
    expect(phase('propose_draft_start')).toBe(4);
  });
});

describe('class rules of the stage-only tools', () => {
  it('requires every G tool to declare its outward effects, a verify and a propose_ name', () => {
    const goLive = staged.filter((tool) => tool.class === 'G');
    expect(goLive.length).toBeGreaterThanOrEqual(15);
    for (const tool of goLive) {
      expect(tool.name.startsWith('propose_'), tool.name).toBe(true);
      expect(Array.isArray(tool.outwardEffects) && tool.outwardEffects.length > 0, `${tool.name} outwardEffects`).toBe(true);
      for (const effect of tool.outwardEffects ?? []) {
        expect(effect.key).toMatch(/^[a-z_]+$/);
        expect(effect.summary.length).toBeGreaterThan(10);
      }
      expect(tool.verify, `${tool.name} verify`).toMatch(/^[a-z_]+$/);
    }
  });

  it('requires every B tool to declare a reversal and a verify', () => {
    const live = staged.filter((tool) => tool.class === 'B');
    expect(live.map((tool) => tool.name)).toEqual(['propose_build']);
    for (const tool of live) {
      expect(tool.reversal && tool.reversal.length > 10, tool.name).toBe(true);
      expect(tool.verify, tool.name).toBeTruthy();
    }
  });

  it('asks for the typed name where the plan requires one and nowhere else', () => {
    const typed = Object.fromEntries(staged.filter((t) => t.typedName).map((t) => [t.name, t.typedName]));
    expect(typed).toEqual({ propose_start_phase: 'league', propose_publish_format: 'format', propose_league_trash: 'league' });
  });

  it('lets a D tool bind only the format draft routes and the ruleset-definition draft routes', () => {
    const draftTools = staged.filter((tool) => tool.class === 'D');
    const bound = new Set<string>();
    for (const tool of draftTools) {
      for (const route of tool.routes) {
        expect(ALLOWED_DRAFT_ROUTES.has(routeKey(route)), `${tool.name} binds ${routeKey(route)}`).toBe(true);
        bound.add(routeKey(route));
      }
    }
    // The Plan tools write only the assistant's own tables.
    for (const name of ['plan_create', 'plan_set', 'plan_patch', 'plan_revert', 'request_clarification']) {
      expect(getToolDefinition(name) as StagedTool).toMatchObject({ routes: [] });
    }
    // And every allowed draft route is bound by some D tool.
    expect([...bound].sort()).toEqual([...ALLOWED_DRAFT_ROUTES].sort());
  });

  it('keeps D bindings in the route manifest identical to the D tools', () => {
    const manifestD = bindings.filter((b) => b.class === 'D').map(routeKey).sort();
    expect(manifestD).toEqual([...ALLOWED_DRAFT_ROUTES].sort());
  });

  it('agrees with the route-manifest bindings on the class of every route it declares', () => {
    for (const tool of staged) {
      for (const route of tool.routes) {
        const binding = bindings.find((b) => routeKey(b) === routeKey(route));
        // A route that is not bound yet (a later phase) is checked for existence below. A bound one agrees on class,
        // except that live state can only RAISE a class (plan 3.5 rule 1): a G card may use a route bound as B
        // (completing a tournament is a PATCH of the B-bound update route with status completed).
        if (binding) {
          const allowed = binding.class === tool.class || (binding.class === 'B' && tool.class === 'G');
          expect(allowed, `${tool.name} ${routeKey(route)} is bound as ${binding.class}`).toBe(true);
        }
      }
    }
    // The G-bound routes are used only by G tools.
    for (const binding of bindings.filter((b) => b.class === 'G')) {
      const users = staged.filter((tool) => tool.routes.some((route) => routeKey(route) === routeKey(binding)));
      expect(users.length, routeKey(binding)).toBeGreaterThan(0);
      for (const user of users) expect(user.class, `${user.name} on ${routeKey(binding)}`).toBe('G');
    }
  });

  it('declares only routes that exist and export that method', () => {
    for (const tool of staged) {
      for (const route of tool.routes) {
        const file = path.join(ROOT, 'src/app', route.path, 'route.ts');
        expect(existsSync(file), `${tool.name}: ${file}`).toBe(true);
        expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`export\\s+async\\s+function\\s+${route.method}\\b`));
      }
    }
  });

  it('binds no tool to a route whose handler calls isSuperadmin or requireSuperadmin', () => {
    for (const tool of staged) {
      for (const route of tool.routes) {
        const source = readFileSync(path.join(ROOT, 'src/app', route.path, 'route.ts'), 'utf8');
        expect(source, `${tool.name} ${route.path}`).not.toMatch(/\b(isSuperadmin|requireSuperadmin)\s*\(/);
      }
    }
  });

  it('never gives a staged tool an executable member', () => {
    for (const tool of STAGED_TOOLS) expect(Object.keys(tool)).not.toContain('execute');
  });
});

describe('roles and phases', () => {
  it('offers site-only tools to the site registry and never to the scoped one', () => {
    const siteOnly = ALL_TOOLS.filter((tool) => tool.audience === 'site').map((tool) => tool.name);
    expect(siteOnly).toEqual(['propose_league_trash']);
    for (const maxPhase of ADMIN_AGENT_PHASES) {
      const site = buildToolSet({ role: 'site', maxPhase });
      const scoped = buildToolSet({ role: 'scoped', maxPhase });
      for (const name of scoped.names) expect(site.names).toContain(name);
      expect(scoped.names).not.toContain('propose_league_trash');
      expect(site.names.includes('propose_league_trash')).toBe(maxPhase >= 2);
    }
  });

  it('exposes only tools at or below the phase cap, and grows monotonically with it', () => {
    let previous = new Set<string>();
    for (const maxPhase of ADMIN_AGENT_PHASES) {
      const set = buildToolSet({ role: 'site', maxPhase });
      for (const name of set.names) expect(set.definitions.get(name)!.phase).toBeLessThanOrEqual(maxPhase);
      for (const name of previous) expect(set.names).toContain(name);
      previous = new Set(set.names);
    }
    expect(buildToolSet({ role: 'site', maxPhase: 0 }).names).not.toContain('propose_move_pin');
    expect(buildToolSet({ role: 'site', maxPhase: 1 }).names).toContain('propose_move_pin');
  });

  it('puts no Go-live tool in the phase 0 set: the approve route answers phase_disabled there', () => {
    const phase0 = buildToolSet({ role: 'site', maxPhase: 0 });
    const classes = phase0.names.map((name) => phase0.definitions.get(name)!.class);
    expect(classes).not.toContain('G');
    expect(phase0.names).toContain('propose_build');
  });

  it('looks tools up only within the offered set', () => {
    const scoped = buildToolSet({ role: 'scoped', maxPhase: 5 });
    expect(lookupOffered(scoped, 'league_get')).toBeDefined();
    expect(lookupOffered(scoped, 'propose_league_trash')).toBeUndefined();
    expect(getToolDefinition('propose_league_trash')).toBeDefined();
    expect(getToolDefinition('delete_league')).toBeUndefined();
    expect(isOffered(getToolDefinition('propose_league_trash')!, 'scoped', 5)).toBe(false);
  });

  it('answers tool_not_available for an unknown name, an unoffered tool and a stage-only tool', async () => {
    const set = buildToolSet({ role: 'scoped', maxPhase: 5 });
    const ctx = { conversationId: null, now: () => new Date(0), timeZone: 'Europe/Berlin', locale: 'en' as const, ports: {} };
    for (const name of ['delete_league', 'propose_league_trash', 'propose_build', 'plan_set']) {
      expect(await runTool(set, name, {}, ctx)).toEqual({ ok: false, code: 'tool_not_available' });
    }
  });
});

describe('the frozen tool set', () => {
  it('derives the same bytes and hash on every build, in sorted order, deeply frozen', () => {
    const first = buildToolSet({ role: 'site', maxPhase: 5 });
    const second = buildToolSet({ role: 'site', maxPhase: 5 });
    expect(second).toBe(first);
    expect(first.names).toEqual([...first.names].sort());
    expect(first.registryVersion).toMatch(/^[0-9a-f]{16}$/);
    expect(first.wireBytes).toBe(canonicalJson(first.tools as unknown as JsonValue));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.tools)).toBe(true);
    expect(() => (first.names as string[]).push('x')).toThrow();
  });

  it('gives different roles and phases different hashes, and equal sets the same hash', () => {
    const versions = new Set(sets.map((set) => set.registryVersion));
    // site phase N versus scoped phase N differ only once a site-only tool joins (phase 2); other pairs are equal sets.
    expect(versions.size).toBeGreaterThan(4);
    expect(buildToolSet({ role: 'scoped', maxPhase: 0 }).registryVersion).toBe(buildToolSet({ role: 'site', maxPhase: 0 }).registryVersion);
    expect(buildToolSet({ role: 'scoped', maxPhase: 2 }).registryVersion).not.toBe(buildToolSet({ role: 'site', maxPhase: 2 }).registryVersion);
  });

  it('sends every tool as a closed strict tool with no constraint keywords', () => {
    const banned = new Set(['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', '$ref', 'oneOf', 'allOf', 'default', '$schema']);
    // Visits schema NODES only: a property called "format" or an enum value "format" is not a keyword.
    const visit = (node: unknown, where: string): void => {
      if (typeof node !== 'object' || node === null) return;
      const schema = node as Record<string, unknown>;
      for (const key of Object.keys(schema)) expect(banned.has(key), `${where}: keyword ${key}`).toBe(false);
      if (schema.type === 'object') expect(schema.additionalProperties, `${where}: object not closed`).toBe(false);
      for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, unknown>)) visit(child, `${where}.${name}`);
      visit(schema.items, `${where}[]`);
      for (const [index, branch] of ((schema.anyOf ?? []) as unknown[]).entries()) visit(branch, `${where}|${index}`);
    };
    for (const tool of ALL_TOOLS) {
      const wire = toWireTool(tool);
      expect(wire.strict).toBe(true);
      expect(wire.input_schema.type).toBe('object');
      visit(wire.input_schema, tool.name);
    }
  });

  it('keeps the tool text and shape stable: per-tool hashes and set versions match the committed snapshot', () => {
    const perTool = Object.fromEntries(ALL_TOOLS.map((tool) => [tool.name, toolHash(tool)]));
    expect(perTool).toMatchSnapshot('per-tool wire hash');
    const versions = Object.fromEntries(sets.map((set) => [`${set.role}:${set.maxPhase}`, { version: set.registryVersion, tools: set.names.length }]));
    expect(versions).toMatchSnapshot('tool_registry_version per role and phase');
  });

  it('holds each set under its token budget (bytes over 3.5): a visible diff when the prompt prefix grows', () => {
    // Budgets are the measured size with about 10 percent headroom; raise one only on purpose (plan 3.9 test 7). Phases 0 and 1 were raised for the Plan slot-shape cheat-sheet in plan_set and plan_patch (about 850 tokens: three eval cases spent the whole step budget guessing shapes). The full
    // set is about 14,000 tokens, under the 17,000 at which plan 3.6 would start deferring tools (spike S4).
    const budget: Record<number, number> = { 0: 9_700, 1: 11_600, 2: 12_100, 3: 14_500, 4: 15_700, 5: 15_700 };
    for (const maxPhase of ADMIN_AGENT_PHASES) {
      const tokens = estimateToolTokens(buildToolSet({ role: 'site', maxPhase }));
      expect(tokens, `phase ${maxPhase}: ${tokens} tokens`).toBeLessThanOrEqual(budget[maxPhase]);
    }
  });
});
