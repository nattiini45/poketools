/**
 * A small static import graph for the architecture tests (plan 3.9 tests 3, 4 and 6). It reads source text, not the
 * TypeScript program, so it needs no compiler and no build: the tests that use it run in `npm run test`.
 *
 * What counts as an edge: a runtime import (static, `export ... from`, side-effect) and an `import()` with a literal
 * specifier (plan S6 plans about thirty lazy route imports, so a lazy edge must be followed as well). `import type`, an
 * `export type ... from` and an import whose specifiers are all inline `type` are erased at build time and are not edges.
 * An `import()` with a non-literal specifier cannot be followed; it is counted, and the tests forbid it where privilege
 * depends on the graph (`dispatch/` and `_ops/`).
 *
 * Specifiers that are not files of this repository (packages, `next/*`, `node:*`) are leaves: not followed, not listed.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
export const SRC_ROOT = path.join(REPO_ROOT, 'src');

/** Source with comments removed, so prose in a header cannot create an edge. */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

export interface ParsedImports {
  /** Runtime specifiers, in source order, duplicates kept out. */
  specifiers: string[];
  /** Specifiers of erased (type-only) imports, for tests that care about types. */
  typeSpecifiers: string[];
  /** How many `import(...)` calls have a specifier that is not a plain string literal. */
  nonLiteralDynamic: number;
}

const STATIC_IMPORT = /(?:^|[\n;])\s*import\s+(type\s+)?([^'";]*?)\s*from\s*(['"])([^'"]+)\3/g;
const SIDE_EFFECT_IMPORT = /(?:^|[\n;])\s*import\s*(['"])([^'"]+)\1/g;
const EXPORT_FROM = /(?:^|[\n;])\s*export\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\2/g;
const DYNAMIC_LITERAL = /\bimport\(\s*(['"])([^'"]+)\1\s*\)/g;
const DYNAMIC_ANY = /\bimport\(/g;

/** True when every specifier in a `{ ... }` clause is an inline `type X`, so the whole import is erased. */
function allInlineTypes(clause: string): boolean {
  const named = /^\{([^}]*)\}$/.exec(clause.trim());
  if (named === null) return false;
  const parts = named[1].split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => /^type\s/.test(part));
}

export function parseImports(source: string): ParsedImports {
  const text = stripComments(source);
  const specifiers = new Set<string>();
  const typeSpecifiers = new Set<string>();
  for (const match of text.matchAll(STATIC_IMPORT)) {
    const [, typeKeyword, clause, , specifier] = match;
    (typeKeyword !== undefined || allInlineTypes(clause) ? typeSpecifiers : specifiers).add(specifier);
  }
  for (const match of text.matchAll(SIDE_EFFECT_IMPORT)) specifiers.add(match[2]);
  for (const match of text.matchAll(EXPORT_FROM)) (match[1] !== undefined ? typeSpecifiers : specifiers).add(match[3]);
  let literal = 0;
  for (const match of text.matchAll(DYNAMIC_LITERAL)) {
    specifiers.add(match[2]);
    literal += 1;
  }
  const dynamicTotal = [...text.matchAll(DYNAMIC_ANY)].length;
  return { specifiers: [...specifiers], typeSpecifiers: [...typeSpecifiers], nonLiteralDynamic: dynamicTotal - literal };
}

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'];

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function withExtension(base: string): string | null {
  if (isFile(base) && /\.(ts|tsx|mts|js|mjs|json)$/.test(base)) return base;
  for (const extension of EXTENSIONS) if (isFile(base + extension)) return base + extension;
  for (const extension of EXTENSIONS) if (isFile(path.join(base, `index${extension}`))) return path.join(base, `index${extension}`);
  return null;
}

/** The repository file a specifier names from `fromFile`, or `null` for a package, a Node built-in or a missing file. */
export function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return withExtension(path.join(SRC_ROOT, specifier.slice(2)));
  if (specifier.startsWith('.')) return withExtension(path.resolve(path.dirname(fromFile), specifier));
  return null;
}

export interface Graph {
  /** file (absolute) to its resolved runtime dependencies. */
  edges: Map<string, string[]>;
  /** file to the number of non-literal `import()` calls it contains. */
  nonLiteral: Map<string, number>;
}

/** Builds the graph reachable from `entries` (absolute paths of existing files). */
export function buildGraph(entries: readonly string[]): Graph {
  const edges = new Map<string, string[]>();
  const nonLiteral = new Map<string, number>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (edges.has(file)) continue;
    const deps: string[] = [];
    if (/\.(ts|tsx|mts|js|mjs)$/.test(file)) {
      const parsed = parseImports(readFileSync(file, 'utf8'));
      if (parsed.nonLiteralDynamic > 0) nonLiteral.set(file, parsed.nonLiteralDynamic);
      for (const specifier of parsed.specifiers) {
        const resolved = resolveSpecifier(file, specifier);
        if (resolved !== null) deps.push(resolved);
      }
    }
    edges.set(file, [...new Set(deps)]);
    for (const dep of deps) if (!edges.has(dep)) queue.push(dep);
  }
  return { edges, nonLiteral };
}

/** A shortest chain of files from an entry to the first file `hit` accepts, or `null`. */
export function findPath(graph: Graph, entries: readonly string[], hit: (file: string) => boolean): string[] | null {
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const entry of entries) {
    if (!parent.has(entry)) {
      parent.set(entry, null);
      queue.push(entry);
    }
  }
  for (let at = 0; at < queue.length; at += 1) {
    const file = queue[at];
    if (hit(file)) {
      const chain: string[] = [];
      for (let node: string | null | undefined = file; node !== null && node !== undefined; node = parent.get(node)) chain.unshift(node);
      return chain;
    }
    for (const dep of graph.edges.get(file) ?? []) {
      if (!parent.has(dep)) {
        parent.set(dep, file);
        queue.push(dep);
      }
    }
  }
  return null;
}

export const relFromRepo = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

/** Every file under `dir` for which `include` holds (relative to the repository, forward slashes), skipping `node_modules`. */
export function walkFiles(dir: string, include: (rel: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    if (!existsSync(current)) return;
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (name === 'node_modules' || name === '.next') continue;
      if (statSync(full).isDirectory()) visit(full);
      else if (include(relFromRepo(full))) out.push(full);
    }
  };
  visit(dir);
  return out;
}

/** Whether a repository-relative path is test code or a test helper. */
export const isTestPath = (rel: string): boolean => /(^|\/)(__tests__|test)\//.test(rel) || /\.(test|spec)\.tsx?$/.test(rel);
