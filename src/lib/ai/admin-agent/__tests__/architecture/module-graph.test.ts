/**
 * Plan 3.9 test 4, module-graph privilege: the import graph of the chat side must not reach the executor, the Go-live and
 * Build bindings (`_ops/g`) or the approve route, and the graph follows `import()` with literal specifiers (plan S6 expects
 * about thirty lazy route imports). A non-literal `import()` cannot be followed, so it is forbidden wherever privilege
 * depends on the graph.
 *
 * Also here: the layer matrix of plan 3.2 (which assistant module may import which, as a list a reviewer sees change) and
 * the machinery tests that prove the checker catches what it is for, on a throwaway tree.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildGraph, findPath, isTestPath, parseImports, REPO_ROOT, relFromRepo, SRC_ROOT, stripComments, walkFiles } from './graph';

const AGENT_DIR = path.join(SRC_ROOT, 'lib/ai/admin-agent');
const ROUTES_DIR = path.join(SRC_ROOT, 'app/api/admin/agent');
const AGENT_REL = 'src/lib/ai/admin-agent';
const ROUTES_REL = 'src/app/api/admin/agent';

/** The sources of the core, the routes and the bindings, without tests. */
const agentFiles = walkFiles(AGENT_DIR, (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel));
const routeFiles = walkFiles(ROUTES_DIR, (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel));

// ─── What may not be reached from the chat side ──────────────────────

/**
 * The executor (the saga that dispatches approved steps), the Go-live/Build bindings, and the approve side that wires them:
 * the approve and resume routes and `_lib/approve.ts`, which builds the executor's dependencies.
 */
const isPrivileged = (rel: string): boolean =>
  new RegExp(`^${AGENT_REL}/proposals/executor(\\.tsx?$|/)`).test(rel) ||
  rel.startsWith(`${ROUTES_REL}/_ops/g/`) ||
  rel.startsWith(`${ROUTES_REL}/proposals/[id]/approve/`) ||
  rel.startsWith(`${ROUTES_REL}/proposals/[id]/resume/`) ||
  rel === `${ROUTES_REL}/_lib/approve.ts`;

/** The approval-token reader and card server: the approve and card routes import it, the chat side never does. */
const isTokenSide = (rel: string): boolean => rel === `${AGENT_REL}/proposals/serve.ts`;

const abs = (rel: string): string => path.join(REPO_ROOT, rel);
const present = (rels: string[]): string[] => rels.map(abs).filter((file) => existsSync(file));

/** Entry points of the chat side: the core, the loop's collaborators and every route except the approve route. */
const chatEntries = [
  ...present([
    `${AGENT_REL}/index.ts`,
    `${AGENT_REL}/loop/index.ts`,
    `${AGENT_REL}/proposals/index.ts`,
    `${AGENT_REL}/plans/index.ts`,
    `${AGENT_REL}/dispatch/index.ts`,
    `${AGENT_REL}/registry/index.ts`,
    `${AGENT_REL}/store/index.ts`,
  ]),
  ...routeFiles.filter((file) => file.endsWith('route.ts') && !isPrivileged(relFromRepo(file))),
  ...routeFiles.filter((file) => relFromRepo(file).startsWith(`${ROUTES_REL}/_ops/d/`)),
];
const chatGraph = buildGraph(chatEntries);

describe('the chat side cannot reach the executor, the _ops/g bindings or the approve route', () => {
  it('builds a graph worth checking', () => {
    expect(chatEntries.length).toBeGreaterThanOrEqual(8);
    expect(chatGraph.edges.size).toBeGreaterThan(300);
    // The real chat route is among the entries once it exists.
    expect(chatEntries.map(relFromRepo)).toContain(`${ROUTES_REL}/conversations/[id]/messages/route.ts`);
    // And it really walks through the layers it is meant to protect.
    const reached = new Set([...chatGraph.edges.keys()].map(relFromRepo));
    for (const rel of [`${AGENT_REL}/loop/start.ts`, `${AGENT_REL}/registry/staged.ts`, `${AGENT_REL}/proposals/stage.ts`, `${AGENT_REL}/dispatch/invoke.ts`, `${AGENT_REL}/store/index.ts`]) expect(reached.has(rel), rel).toBe(true);
  });

  it('reaches no privileged file, and shows the chain if it ever does', () => {
    const chain = findPath(chatGraph, chatEntries, (file) => isPrivileged(relFromRepo(file)));
    expect(chain?.map(relFromRepo)).toBeUndefined();
  });

  it('reaches no privileged file from any single entry either', () => {
    for (const entry of chatEntries) {
      const graph = buildGraph([entry]);
      expect(findPath(graph, [entry], (file) => isPrivileged(relFromRepo(file)))?.map(relFromRepo), relFromRepo(entry)).toBeUndefined();
    }
  }, 30_000); // one graph per entry: slow on a loaded machine

  it('keeps the approval-token reader away from the chat route and the loop', () => {
    const loopSide = [`${AGENT_REL}/index.ts`, `${AGENT_REL}/loop/index.ts`, `${AGENT_REL}/proposals/index.ts`, `${ROUTES_REL}/conversations/[id]/messages/route.ts`].map(abs);
    const graph = buildGraph(loopSide);
    expect(findPath(graph, loopSide, (file) => isTokenSide(relFromRepo(file)))?.map(relFromRepo)).toBeUndefined();
  });

  it('exports no token reader from the loop-side proposals barrel', () => {
    expect(source(abs(`${AGENT_REL}/proposals/index.ts`))).not.toMatch(/getApprovalToken|deriveApprovalToken|serve['"]/);
  });

  it('has an approve side that may reach what the chat side may not (the rule is one-way)', () => {
    // Nothing imports the executor except the approve wiring (`_lib/approve.ts`), which only the approve and resume routes import.
    const importers = agentFiles.concat(routeFiles).filter((file) => parseImports(readFileSync(file, 'utf8')).specifiers.some((specifier) => /executor/.test(specifier)));
    expect(importers.map(relFromRepo)).toEqual([`${ROUTES_REL}/_lib/approve.ts`]);
    const wiring = agentFiles.concat(routeFiles).filter((file) => parseImports(readFileSync(file, 'utf8')).specifiers.some((specifier) => /_lib\/approve$/.test(specifier)));
    expect(wiring.map(relFromRepo).sort()).toEqual([`${ROUTES_REL}/proposals/[id]/approve/route.ts`, `${ROUTES_REL}/proposals/[id]/resume/route.ts`]);
  });

  it('reaches the executor from the approve and resume routes through the wiring file', () => {
    const approveSide = routeFiles.filter((file) => /proposals\/\[id\]\/(approve|resume)\/route\.ts$/.test(file.split(path.sep).join('/')));
    expect(approveSide).toHaveLength(2);
    for (const entry of approveSide) {
      const chain = findPath(buildGraph([entry]), [entry], (file) => relFromRepo(file) === `${AGENT_REL}/proposals/executor.ts`);
      expect(chain?.map(relFromRepo), relFromRepo(entry)).toContain(`${ROUTES_REL}/_lib/approve.ts`);
    }
  }, 30_000);

  it('keeps the executor out of the chat route, the conversation routes, the card and decline routes, the shared agent and the proposals barrel', () => {
    for (const rel of [
      `${ROUTES_REL}/conversations/[id]/messages/route.ts`,
      `${ROUTES_REL}/conversations/[id]/route.ts`,
      `${ROUTES_REL}/conversations/route.ts`,
      `${ROUTES_REL}/proposals/[id]/route.ts`,
      `${ROUTES_REL}/proposals/[id]/decline/route.ts`,
      `${ROUTES_REL}/_lib/agent.ts`,
      `${AGENT_REL}/proposals/index.ts`,
    ]) {
      const entry = abs(rel);
      const chain = findPath(buildGraph([entry]), [entry], (file) => relFromRepo(file) === `${AGENT_REL}/proposals/executor.ts`);
      expect(chain?.map(relFromRepo), rel).toBeUndefined();
    }
    expect(source(abs(`${ROUTES_REL}/_lib/agent.ts`))).not.toMatch(/executor|_ops\/g|\/approve['"]/);
  }, 30_000);
});

describe('the private draft writes (_ops/d and the draft runner) are chat-side and stay unprivileged', () => {
  const draftOps = routeFiles.filter((file) => relFromRepo(file).startsWith(`${ROUTES_REL}/_ops/d/`));
  const draftRunner = [`${AGENT_REL}/staged/index.ts`, `${AGENT_REL}/staged/draft-tools.ts`, `${AGENT_REL}/staged/draft-patch.ts`].map(abs);

  it('finds the D bindings', () => {
    expect(draftOps.map(relFromRepo).sort()).toEqual(
      ['index.ts', 'ruleset-create.ts', 'ruleset-patch.ts', 'schemas.ts'].map((name) => `${ROUTES_REL}/_ops/d/${name}`),
    );
  });

  it('is reached by the chat route through the shared agent wiring (the chat route may reach _ops/d)', () => {
    const entry = abs(`${ROUTES_REL}/conversations/[id]/messages/route.ts`);
    const chain = findPath(buildGraph([entry]), [entry], (file) => relFromRepo(file) === `${ROUTES_REL}/_ops/d/index.ts`);
    expect(chain?.map(relFromRepo)).toEqual([`${ROUTES_REL}/conversations/[id]/messages/route.ts`, `${ROUTES_REL}/_lib/agent.ts`, `${ROUTES_REL}/_ops/d/index.ts`]);
  });

  it('reaches no privileged file from _ops/d, from any single binding either', () => {
    const graph = buildGraph(draftOps);
    expect(findPath(graph, draftOps, (file) => isPrivileged(relFromRepo(file)))?.map(relFromRepo)).toBeUndefined();
    for (const entry of draftOps) {
      expect(findPath(buildGraph([entry]), [entry], (file) => isPrivileged(relFromRepo(file)))?.map(relFromRepo), relFromRepo(entry)).toBeUndefined();
    }
  }, 30_000);

  it('reaches no _ops/g binding, no executor and no approve wiring from the draft runner', () => {
    const graph = buildGraph(draftRunner);
    expect(findPath(graph, draftRunner, (file) => isPrivileged(relFromRepo(file)))?.map(relFromRepo)).toBeUndefined();
    const importers = agentFiles.concat(routeFiles).filter((file) => relFromRepo(file).startsWith(`${AGENT_REL}/staged/`) || relFromRepo(file).startsWith(`${ROUTES_REL}/_ops/d/`));
    for (const file of importers) {
      const { specifiers, typeSpecifiers } = parseImports(readFileSync(file, 'utf8'));
      for (const specifier of [...specifiers, ...typeSpecifiers]) expect(specifier, relFromRepo(file)).not.toMatch(/_ops\/g|executor|_lib\/approve/);
    }
  }, 30_000);

  it('keeps _ops/d away from the other binding directory in both directions', () => {
    const gFiles = routeFiles.filter((file) => relFromRepo(file).startsWith(`${ROUTES_REL}/_ops/g/`));
    for (const file of gFiles) {
      const { specifiers } = parseImports(readFileSync(file, 'utf8'));
      for (const specifier of specifiers) expect(specifier, relFromRepo(file)).not.toMatch(/_ops\/d|\.\.\/d(\/|$)/);
    }
  });
});

describe('src/lib never imports src/app', () => {
  it('has no import, type import or lazy import of an app file in any lib source', () => {
    const libFiles = walkFiles(path.join(SRC_ROOT, 'lib'), (rel) => /\.tsx?$/.test(rel) && !isTestPath(rel));
    expect(libFiles.length).toBeGreaterThan(500);
    const offenders = libFiles.flatMap((file) => {
      const { specifiers, typeSpecifiers } = parseImports(readFileSync(file, 'utf8'));
      return [...specifiers, ...typeSpecifiers].filter((specifier) => /^@\/app\//.test(specifier)).map((specifier) => `${relFromRepo(file)} -> ${specifier}`);
    });
    expect(offenders).toEqual([]);
  }, 30_000); // scans every lib source: slow on a loaded machine
});

describe('the reaper is the one part of the executor job the chat turn shares', () => {
  const reaper = `${AGENT_REL}/proposals/reaper.ts`;

  it('is reached by the chat route (it reaps at the start of a turn) through the shared event wiring, not through the executor', () => {
    const entry = abs(`${ROUTES_REL}/conversations/[id]/messages/route.ts`);
    const chain = findPath(buildGraph([entry]), [entry], (file) => relFromRepo(file) === reaper);
    expect(chain?.map(relFromRepo)).toEqual([`${ROUTES_REL}/conversations/[id]/messages/route.ts`, `${ROUTES_REL}/_lib/events.ts`, reaper]);
  });

  it('is imported by the executor too, so the two cannot disagree on the age or the event', () => {
    const entry = abs(`${AGENT_REL}/proposals/executor.ts`);
    expect([...(buildGraph([entry]).edges.get(entry) ?? [])].includes(abs(reaper))).toBe(true);
  });

  it('reaches no executor, no binding and no approve code from the reaper or the shared event wiring', () => {
    for (const rel of [reaper, `${ROUTES_REL}/_lib/events.ts`]) {
      const entry = abs(rel);
      const chain = findPath(buildGraph([entry]), [entry], (file) => isPrivileged(relFromRepo(file)));
      expect(chain?.map(relFromRepo), rel).toBeUndefined();
    }
  }, 30_000);
});

/** A file's code without comments. */
const source = (file: string): string => stripComments(readFileSync(file, 'utf8'));

describe('lazy imports are literal', () => {
  it('has no import() with a non-literal specifier anywhere in the core, the routes or the bindings', () => {
    const files = [...agentFiles, ...routeFiles];
    const graph = buildGraph(files);
    const offenders = [...graph.nonLiteral.keys()].filter((file) => files.includes(file)).map(relFromRepo);
    expect(offenders).toEqual([]);
  }, 30_000); // scans the core, the routes and the bindings: slow on a loaded machine

  it('has no dynamic import at all under dispatch/ (the bindings, not the dispatcher, hold the lazy route imports)', () => {
    for (const file of agentFiles.filter((f) => relFromRepo(f).startsWith(`${AGENT_REL}/dispatch/`))) {
      expect(source(file), relFromRepo(file)).not.toMatch(/\bimport\s*\(/);
    }
  });

  it('is scanning the _ops directory once it exists', () => {
    const ops = routeFiles.filter((file) => relFromRepo(file).startsWith(`${ROUTES_REL}/_ops/`));
    // Vacuous until the bindings are written; the day they are, their lazy imports are in the graph above.
    for (const file of ops) expect(buildGraph([file]).nonLiteral.has(file)).toBe(false);
    expect(!existsSync(abs(`${ROUTES_REL}/_ops`)) || ops.length > 0).toBe(true);
  }, 60_000); // one graph per binding file: slow on a loaded machine
});

// ─── The layer matrix ────────────────────────────────────────────────

/**
 * Which top-level module of the assistant imports which, at run time (type-only imports are erased and do not count). The
 * list is the current truth of plan 3.2, written out so that a new edge shows up as a diff in review. `root` is `env.ts`
 * and `index.ts`.
 */
const ALLOWED_LAYER_EDGES: Record<string, readonly string[]> = {
  // The harness sits on top of everything and nothing imports it.
  eval: ['loop', 'plans', 'previews', 'prompts', 'readers', 'registry', 'root', 'store'],
  // The loop knows the store's pure pieces (errors, ids, payload guard) and nothing else: tools, staging and dispatch are injected.
  loop: ['store'],
  previews: ['registry'],
  // The executor dispatches approved steps through `dispatch/`; staging imports nothing from it.
  proposals: ['dispatch', 'plans', 'registry', 'root', 'store'],
  readers: ['plans', 'registry'],
  registry: ['plans', 'previews', 'readers'],
  root: ['loop', 'prompts', 'registry', 'store'],
  // The stage-only tools (Plan tools, staging, clarification, the private draft writes): wired in by the route layer, never imported by the
  // core. The draft runner dispatches through `dispatch/` (`checkCall`, `invokeRoute`); its bindings are injected, never imported.
  staged: ['dispatch', 'plans', 'proposals', 'registry'],
  store: ['root'],
  // Leaves.
  dispatch: [],
  plans: [],
  prompts: [],
};

const layerOf = (file: string): string => {
  const parts = path.relative(AGENT_DIR, file).split(path.sep);
  return parts.length === 1 ? 'root' : parts[0];
};
const inAgent = (file: string): boolean => !path.relative(AGENT_DIR, file).startsWith('..');

describe('layer matrix (plan 3.2)', () => {
  const graph = buildGraph(agentFiles);
  const actual = new Map<string, Set<string>>();
  for (const [file, deps] of graph.edges) {
    if (!inAgent(file) || isTestPath(relFromRepo(file))) continue;
    for (const dep of deps) {
      if (!inAgent(dep) || isTestPath(relFromRepo(dep)) || layerOf(file) === layerOf(dep)) continue;
      actual.set(layerOf(file), (actual.get(layerOf(file)) ?? new Set()).add(layerOf(dep)));
    }
  }

  it('lists every layer', () => {
    const layers = new Set(agentFiles.map(layerOf));
    expect([...layers].sort()).toEqual(Object.keys(ALLOWED_LAYER_EDGES).sort());
  });

  it('has no import between layers that the matrix does not list', () => {
    const extra: string[] = [];
    for (const [layer, deps] of actual) for (const dep of deps) if (!ALLOWED_LAYER_EDGES[layer]?.includes(dep)) extra.push(`${layer} -> ${dep}`);
    expect(extra).toEqual([]);
  });

  it('lists no edge that does not exist (a stale permission is a hole)', () => {
    const stale: string[] = [];
    for (const [layer, deps] of Object.entries(ALLOWED_LAYER_EDGES)) for (const dep of deps) if (!actual.get(layer)?.has(dep)) stale.push(`${layer} -> ${dep}`);
    expect(stale).toEqual([]);
  });

  it('keeps the privileged-looking layers pure: the planner, the dispatcher and the prompt import no other assistant module', () => {
    for (const layer of ['plans', 'dispatch', 'prompts']) expect([...(actual.get(layer) ?? [])], layer).toEqual([]);
  });

  it('is imported by nothing from outside itself and the scripts: eval is a leaf', () => {
    const importers = [...graph.edges.entries()].filter(([file, deps]) => !relFromRepo(file).startsWith(`${AGENT_REL}/eval/`) && deps.some((dep) => relFromRepo(dep).startsWith(`${AGENT_REL}/eval/`)));
    expect(importers.map(([file]) => relFromRepo(file))).toEqual([]);
  });

  it('keeps the core free of any route or component (layering: a lib never imports the app)', () => {
    const offenders = [...graph.edges.entries()].flatMap(([file, deps]) => (inAgent(file) ? deps.filter((dep) => /^src\/(app|components)\//.test(relFromRepo(dep))).map((dep) => `${relFromRepo(file)} -> ${relFromRepo(dep)}`) : []));
    expect(offenders).toEqual([]);
  });
});

// ─── The checker itself ──────────────────────────────────────────────

describe('the checker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'admin-agent-graph-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const write = (rel: string, text: string): string => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  };

  it('follows static, re-exported, side-effect and literal dynamic imports, and reports the chain', () => {
    const route = write('chat/route.ts', "import { loop } from '../lib/loop';\nexport const POST = loop;\n");
    write('lib/loop.ts', "export * from './barrel';\n");
    write('lib/barrel.ts', "import './side';\nexport const x = async () => (await import('./lazy')).run();\n");
    write('lib/side.ts', 'export {};\n');
    write('lib/lazy.ts', "import { go } from '../exec/executor';\nexport const run = go;\n");
    write('exec/executor.ts', 'export const go = 1;\n');
    const graph = buildGraph([route]);
    const chain = findPath(graph, [route], (file) => file.endsWith('executor.ts'));
    expect(chain?.map((file) => path.relative(root, file).split(path.sep).join('/'))).toEqual(['chat/route.ts', 'lib/loop.ts', 'lib/barrel.ts', 'lib/lazy.ts', 'exec/executor.ts']);
  });

  it('does not follow type-only imports, inline-type imports or comments', () => {
    const route = write('typed/route.ts', "import type { A } from '../exec/executor';\nimport { type B, type C } from '../exec/executor2';\nexport type { D } from '../exec/executor3';\n// import x from '../exec/executor4';\n/* import('../exec/executor5') */\nexport const y = 1;\n");
    for (const name of ['executor', 'executor2', 'executor3', 'executor4', 'executor5']) write(`exec/${name}.ts`, 'export type A = 1; export type B = 1; export type C = 1; export type D = 1;\n');
    const graph = buildGraph([route]);
    expect([...graph.edges.keys()].map((file) => path.basename(file))).toEqual(['route.ts']);
  });

  it('counts a non-literal import() and a template import() as unfollowable, and a literal one as a plain edge', () => {
    const parsed = parseImports("const a = await import(name);\nconst b = await import(`./x/${n}`);\nconst c = await import('./ok');\nconst d = await import(\"./ok2\");\n");
    expect(parsed.nonLiteralDynamic).toBe(2);
    expect(parsed.specifiers).toEqual(['./ok', './ok2']);
    const route = write('dyn/route.ts', 'const m = await import(path);\nexport {};\n');
    expect(buildGraph([route]).nonLiteral.get(route)).toBe(1);
  });

  it('treats packages and node built-ins as leaves and resolves the @/ alias into the real src tree', () => {
    const route = write('leaf/route.ts', "import { z } from 'zod';\nimport fs from 'node:fs';\nimport { UserFacingError } from '@/lib/api/user-facing-error';\nexport {};\n");
    const graph = buildGraph([route]);
    expect([...graph.edges.get(route)!].map(relFromRepo)).toEqual(['src/lib/api/user-facing-error.ts']);
  });

  it('terminates on an import cycle', () => {
    const a = write('cycle/a.ts', "import './b';\n");
    write('cycle/b.ts', "import './a';\n");
    expect(buildGraph([a]).edges.size).toBe(2);
  });

  it('classifies the privileged paths and the token reader', () => {
    expect(isPrivileged(`${AGENT_REL}/proposals/executor.ts`)).toBe(true);
    expect(isPrivileged(`${AGENT_REL}/proposals/executor/saga.ts`)).toBe(true);
    expect(isPrivileged(`${ROUTES_REL}/_ops/g/publish.ts`)).toBe(true);
    expect(isPrivileged(`${ROUTES_REL}/proposals/[id]/approve/route.ts`)).toBe(true);
    expect(isPrivileged(`${ROUTES_REL}/proposals/[id]/resume/route.ts`)).toBe(true);
    expect(isPrivileged(`${ROUTES_REL}/_lib/approve.ts`)).toBe(true);
    expect(isPrivileged(`${ROUTES_REL}/_lib/agent.ts`)).toBe(false);
    expect(isPrivileged(`${ROUTES_REL}/proposals/[id]/decline/route.ts`)).toBe(false);
    expect(isPrivileged(`${ROUTES_REL}/_ops/d/format.ts`)).toBe(false);
    expect(isPrivileged(`${AGENT_REL}/proposals/executor-notes.ts`)).toBe(false);
    expect(isPrivileged(`${AGENT_REL}/proposals/stage.ts`)).toBe(false);
    expect(isTokenSide(`${AGENT_REL}/proposals/serve.ts`)).toBe(true);
  });
});
