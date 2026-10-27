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

/** The executor (the saga that dispatches approved steps), the Go-live/Build bindings and the approve route itself. */
const isPrivileged = (rel: string): boolean =>
  new RegExp(`^${AGENT_REL}/proposals/executor(\\.tsx?$|/)`).test(rel) || rel.startsWith(`${ROUTES_REL}/_ops/g/`) || rel.startsWith(`${ROUTES_REL}/proposals/[id]/approve/`);

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
    // Nothing imports the executor except the approve route, once both exist.
    const importers = agentFiles.concat(routeFiles).filter((file) => parseImports(readFileSync(file, 'utf8')).specifiers.some((specifier) => /executor/.test(specifier)));
    for (const file of importers) expect(relFromRepo(file), relFromRepo(file)).toMatch(/^src\/app\/api\/admin\/agent\/proposals\/\[id\]\/approve\//);
  });
});

/** A file's code without comments. */
const source = (file: string): string => stripComments(readFileSync(file, 'utf8'));

describe('lazy imports are literal', () => {
  it('has no import() with a non-literal specifier anywhere in the core, the routes or the bindings', () => {
    const files = [...agentFiles, ...routeFiles];
    const graph = buildGraph(files);
    const offenders = [...graph.nonLiteral.keys()].filter((file) => files.includes(file)).map(relFromRepo);
    expect(offenders).toEqual([]);
  });

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
  });
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
  proposals: ['plans', 'registry', 'root', 'store'],
  readers: ['plans', 'registry'],
  registry: ['plans', 'previews', 'readers'],
  root: ['loop', 'prompts', 'registry', 'store'],
  // The stage-only tools (Plan tools, staging, clarification): wired in by the route layer, never imported by the core.
  staged: ['plans', 'proposals', 'registry'],
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
    expect(isPrivileged(`${ROUTES_REL}/_ops/d/format.ts`)).toBe(false);
    expect(isPrivileged(`${AGENT_REL}/proposals/executor-notes.ts`)).toBe(false);
    expect(isPrivileged(`${AGENT_REL}/proposals/stage.ts`)).toBe(false);
    expect(isTokenSide(`${AGENT_REL}/proposals/serve.ts`)).toBe(true);
  });
});
