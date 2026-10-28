/**
 * Plan 3.9 test 6, registry invariants: the ones `registry/__tests__/registry.test.ts` does not already hold. That file
 * checks each tool's class, that B and G tools have no `execute`, that D tools bind only the draft routes, that G declares
 * outward effects and a verify, that B declares a reversal, and that no N tool is registered. This one reads the route
 * manifest and the tool arguments:
 *
 *  - the bound routes (`scripts/data/route-manifest-bindings.json`) are well formed, guarded in the committed manifest, and
 *    never a superadmin route (not by guard, not by an imported name);
 *  - the classes of the bindings and of the tools line up with the verb of the route;
 *  - no tool argument can carry an identity, an approval, a token or a secret;
 *  - read and preview tools cannot carry route facts; stage-only tools say that nothing happens until approval.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), loadSessionPlayer: vi.fn() }));

import { ALL_TOOLS, NOT_TOOLS, buildToolSet, toWireTool, type StagedTool } from '../../registry';
import { ADMIN_AGENT_PHASES } from '../../env';
import { REPO_ROOT } from './graph';

interface Binding {
  method: string;
  path: string;
  class: string;
  phase: string;
  operation: string;
}
interface ManifestRoute {
  file: string;
  guards: string[];
  imports: Record<string, { names: string[] }>;
}

const bindings = (JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/data/route-manifest-bindings.json'), 'utf8')) as { bindings: Binding[] }).bindings;
const manifest = (JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/data/route-manifest.json'), 'utf8')) as { routes: Record<string, ManifestRoute> }).routes;
const key = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

/** Argument names a tool must never have (see 'tool arguments' below; the samples at the bottom prove each net bites). */
const IDENTITY = /(^|_)(admin|actor|requester|approver|user|owner)(_id|_name)?$|^player_id$|^(session|cookie|role|tier|audience|toolset)$/i;
const SECRETISH = /token|approv|secret|password|credential|webhook|discord|signature|hash|authoriz|acknowledg/i;
const BOOKKEEPING = /^(?:agent_|audit|ledger|class|idempotency|via)/i;
/** `adminId` and `admin_id` are the same name to the nets. */
const snake = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

const staged = ALL_TOOLS.filter((tool): tool is StagedTool => tool.class === 'D' || tool.class === 'B' || tool.class === 'G');

describe('the bound routes', () => {
  it('are well formed: a unique route, a known class, a phase, an operation name', () => {
    expect(new Set(bindings.map(key)).size).toBe(bindings.length);
    for (const binding of bindings) {
      expect(['D', 'B', 'G', 'P', 'R'], key(binding)).toContain(binding.class);
      expect(binding.phase, key(binding)).toMatch(/^P[0-5]$/);
      expect(binding.operation.trim().length, key(binding)).toBeGreaterThan(3);
      expect(binding.path, key(binding)).toMatch(/^\/api\//);
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], key(binding)).toContain(binding.method);
    }
  });

  it('are all in the committed route manifest, each with at least one guard', () => {
    for (const binding of bindings) {
      const route = manifest[key(binding)];
      expect(route, `${key(binding)} is not in route-manifest.json`).toBeDefined();
      expect(route.guards.length, `${key(binding)} has no guard`).toBeGreaterThan(0);
    }
  });

  it('never name a superadmin guard or import a superadmin helper (plan 3.9 test 5: no binding to a superadmin route)', () => {
    for (const binding of bindings) {
      const route = manifest[key(binding)];
      expect(route.guards.some((guard) => /superadmin/i.test(guard)), `${key(binding)} guards`).toBe(false);
      const imported = Object.values(route.imports).flatMap((entry) => entry.names);
      expect(imported.filter((name) => /^(?:requireSuperadmin|isSuperadmin)$/.test(name)), `${key(binding)} imports`).toEqual([]);
    }
  });

  it('write with a write verb: D, B and G never bind a GET; a read class would', () => {
    for (const binding of bindings) {
      if (binding.class === 'D' || binding.class === 'B' || binding.class === 'G') expect(binding.method, key(binding)).not.toBe('GET');
      if (binding.class === 'R') expect(binding.method, key(binding)).toBe('GET');
    }
  });

  it('bind no route the N list sends to an admin page (no delete, restore, webhook or generate-all route)', () => {
    const forbidden = [/\/trash\//, /\/webhooks?/, /\/social/, /generate-all-rounds/, /\/restore/, /\/rebuild/, /\/reset/, /\/regenerate/];
    for (const binding of bindings) for (const pattern of forbidden) expect(binding.path, key(binding)).not.toMatch(pattern);
    for (const binding of bindings) expect(binding.method === 'DELETE' ? binding.path : '', key(binding)).toMatch(/^(\/api\/(?:seasons|tournaments)\/\[id\]\/participants|\/api\/ruleset-definitions\/\[id\])?$/); // plus the one delete of an undo: a ruleset draft created here and never published
  });

  it('keep the Go-live bindings to exactly the four the plan names for phase 1, and the delete an undo may make', () => {
    expect(bindings.filter((b) => b.class === 'G').map(key).sort()).toEqual([
      'DELETE /api/ruleset-definitions/[id]',
      'POST /api/generate-round/[tid]',
      'POST /api/ruleset-definitions/[id]/pins',
      'POST /api/ruleset-definitions/[id]/publish',
      'POST /api/tournaments/[id]/generate-bracket',
    ]);
  });

  it('do not reuse a name that the N list reserves for something the assistant cannot do', () => {
    const reserved = new Set(NOT_TOOLS.flatMap((entry) => entry.names));
    for (const binding of bindings) for (const word of binding.operation.split(/[\s/()]+/)) expect(reserved.has(word), `${key(binding)}: ${word}`).toBe(false);
  });
});

describe('tools and their routes', () => {
  it('give a read or preview tool no route and no stage-only member', () => {
    for (const tool of ALL_TOOLS.filter((t) => t.class === 'R' || t.class === 'P')) {
      for (const member of ['routes', 'outwardEffects', 'reversal', 'verify', 'typedName']) expect(Object.keys(tool), `${tool.name}.${member}`).not.toContain(member);
    }
  });

  it('give only the Go-live tools outward effects and a typed name; only B and D tools a reversal', () => {
    for (const tool of staged) {
      if (tool.class !== 'G') {
        expect(tool.outwardEffects, tool.name).toBeUndefined();
        expect(tool.typedName, tool.name).toBeUndefined();
      }
      if (tool.class === 'G') expect(tool.reversal, tool.name).toBeUndefined();
      if (tool.class === 'B') expect(tool.reversal, tool.name).toBeTruthy();
    }
  });

  it('require every bound route of a B tool to be bound as B, and no Build route to be shared with a G tool', () => {
    const buildTools = staged.filter((tool) => tool.class === 'B');
    const goLiveRoutes = new Set(staged.filter((tool) => tool.class === 'G').flatMap((tool) => tool.routes.map(key)));
    for (const tool of buildTools) {
      for (const route of tool.routes) {
        const binding = bindings.find((b) => key(b) === key(route));
        if (binding) expect(binding.class, `${tool.name} ${key(route)}`).toBe('B');
        // `PATCH /api/tournaments/[id]` is bound as B and used by one G card (complete a tournament): the one allowed overlap.
        if (goLiveRoutes.has(key(route))) expect(key(route)).toBe('PATCH /api/tournaments/[id]');
      }
    }
  });

  it('put every Go-live tool at phase 1 or later, and the Plan, Build and clarification tools at phase 0', () => {
    for (const tool of staged.filter((t) => t.class === 'G')) expect(tool.phase, tool.name).toBeGreaterThanOrEqual(1);
    for (const name of ['plan_create', 'plan_set', 'plan_patch', 'plan_revert', 'request_clarification', 'propose_build']) {
      expect(ALL_TOOLS.find((t) => t.name === name)?.phase, name).toBe(0);
    }
  });

  it('say, in every B and G description, that the call only stages a card and nothing happens until the admin approves', () => {
    for (const tool of staged.filter((t) => t.class === 'B' || t.class === 'G')) {
      if (tool.name === 'propose_undo') continue;
      expect(tool.description, tool.name).toMatch(/stages a card for the admin to approve; nothing happens until they do/);
    }
    expect(ALL_TOOLS.find((t) => t.name === 'propose_undo')?.description).toMatch(/approv|card|stage/i);
  });

  it('name every stage-only tool in a way the prompt can state: propose_* for B and G (except the Plan tools), nothing else', () => {
    for (const tool of staged) {
      if (tool.class === 'G' || tool.name === 'propose_build') expect(tool.name, tool.name).toMatch(/^propose_/);
      else expect(tool.name, tool.name).not.toMatch(/^propose_/);
    }
  });
});

describe('tool arguments', () => {
  /** Every argument name in every tool's wire schema. */
  function argumentNames(): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    const walk = (tool: string, node: unknown): void => {
      if (node === null || typeof node !== 'object') return;
      const schema = node as Record<string, unknown>;
      for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, unknown>)) {
        out.push([tool, name]);
        walk(tool, child);
      }
      walk(tool, schema.items);
      for (const branch of (schema.anyOf ?? []) as unknown[]) walk(tool, branch);
    };
    for (const tool of ALL_TOOLS) walk(tool.name, toWireTool(tool).input_schema);
    return out;
  }

  const names = argumentNames();

  it('collects the arguments of every tool', () => {
    expect(names.length).toBeGreaterThan(150);
    expect(new Set(names.map(([tool]) => tool)).size).toBeGreaterThan(50);
  });

  it('never let the model supply an identity: no admin, player or actor id, no session, cookie or role', () => {
    const offenders = names.filter(([, name]) => IDENTITY.test(snake(name)));
    expect(offenders).toEqual([]);
  });

  it('never let the model supply an approval, a token, a hash, a secret or an outward address', () => {
    const offenders = names.filter(([, name]) => SECRETISH.test(snake(name)));
    expect(offenders).toEqual([]);
  });

  it('never let the model set the audit or ledger fields, or a class', () => {
    const offenders = names.filter(([, name]) => BOOKKEEPING.test(snake(name)));
    expect(offenders).toEqual([]);
  });

  it('keeps each argument list short enough for a strict tool (plan 3.4 notes the provider limit is unverified)', () => {
    const optionalCount = (tool: string) => names.filter(([t]) => t === tool).length;
    for (const tool of ALL_TOOLS) expect(optionalCount(tool.name), tool.name).toBeLessThanOrEqual(24);
  });
});

describe('the argument nets bite', () => {
  it('flag the names they are for and leave the ones tools really have', () => {
    for (const name of ['admin_id', 'adminId', 'approver', 'player_id', 'role', 'session', 'actor_name']) expect(IDENTITY.test(snake(name)), name).toBe(true);
    for (const name of ['approval_token', 'approved', 'confirm_hash', 'webhook_url', 'client_secret', 'acknowledgements']) expect(SECRETISH.test(snake(name)), name).toBe(true);
    for (const name of ['agent_tool', 'audit_action', 'idempotency_key', 'class', 'via']) expect(BOOKKEEPING.test(snake(name)), name).toBe(true);
    for (const name of ['league_id', 'tournament_id', 'plan_revision', 'proposal_id', 'name', 'query', 'ruleset_id', 'start_date', 'best_of_default']) {
      expect(IDENTITY.test(snake(name)) || SECRETISH.test(snake(name)) || BOOKKEEPING.test(snake(name)), name).toBe(false);
    }
  });
});

describe('the offered sets', () => {
  it('give the scoped registry no tool that only a site admin may use, in any phase', () => {
    for (const maxPhase of ADMIN_AGENT_PHASES) {
      const scoped = buildToolSet({ role: 'scoped', maxPhase });
      for (const name of scoped.names) expect(ALL_TOOLS.find((t) => t.name === name)?.audience, name).toBe('any');
    }
  });

  it('give the phase 0 set no tool that can change a live row: only reads, previews, the Plan and one staged Build', () => {
    const set = buildToolSet({ role: 'site', maxPhase: 0 });
    const classes = Object.fromEntries(set.names.map((name) => [name, set.definitions.get(name)!.class]));
    expect(Object.values(classes).filter((cls) => cls === 'G')).toEqual([]);
    expect(Object.entries(classes).filter(([, cls]) => cls === 'B').map(([name]) => name)).toEqual(['propose_build']);
    expect(Object.entries(classes).filter(([, cls]) => cls === 'D').map(([name]) => name).sort()).toEqual(['plan_create', 'plan_patch', 'plan_revert', 'plan_set', 'request_clarification']);
    for (const name of set.names) {
      const tool = set.definitions.get(name)!;
      if (tool.class === 'D') expect((tool as StagedTool).routes, name).toEqual([]);
    }
  });

  it('commit the tool-text snapshot, so an accidental edit of a description is a visible diff (plan 3.9 test 7)', () => {
    const snapshot = readFileSync(path.join(REPO_ROOT, 'src/lib/ai/admin-agent/registry/__tests__/__snapshots__/registry.test.ts.snap'), 'utf8');
    for (const tool of ALL_TOOLS) expect(snapshot, tool.name).toContain(`"${tool.name}"`);
    expect(snapshot).toContain('tool_registry_version per role and phase');
  });
});
