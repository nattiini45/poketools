/**
 * Static import-graph walker for boundary tests (design pkmn-l10n.md §7, `client-boundary.test.ts`; PK-4's
 * `pkmn-chokepoint-imports.test.ts` reuses `reachableFiles`).
 *
 * Follows runtime imports only: `import … from`, side-effect `import '…'`, `export … from`, dynamic `import('…')`
 * and `require('…')`. Type-only imports and re-exports (`import type`, `export type`, or an import whose every
 * binding is `type`) are skipped, as TypeScript erases them. Specifiers: relative and `@/` (→ `src/`), resolved
 * with `.ts/.tsx/.js/.jsx/.mjs/.json` and `/index.*`. Bare specifiers (npm packages) are recorded, not followed.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const REPO_ROOT = path.resolve(__dirname, '../../../../..');
export const SRC_ROOT = path.join(REPO_ROOT, 'src');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'];

export interface ImportGraph {
  /** Absolute, normalized paths of every reachable source file (the entry included). */
  files: Set<string>;
  /** Bare package specifiers imported by any reachable file (`@pkmn/dex`, `react`). */
  packages: Set<string>;
  /** For each reached file, the file that first imported it (for failure messages). */
  parent: Map<string, string>;
}

const depsCache = new Map<string, { files: string[]; packages: string[] }>();

function resolveFile(base: string): string | undefined {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return path.normalize(base);
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return path.normalize(base + ext);
  }
  for (const ext of EXTENSIONS) {
    const index = path.join(base, `index${ext}`);
    if (fs.existsSync(index)) return path.normalize(index);
  }
  return undefined;
}

function resolveSpecifier(fromFile: string, spec: string): { file?: string; pkg?: string } {
  if (spec.startsWith('@/')) return { file: resolveFile(path.join(SRC_ROOT, spec.slice(2))) };
  if (spec.startsWith('./') || spec.startsWith('../') || spec === '.' || spec === '..') {
    return { file: resolveFile(path.resolve(path.dirname(fromFile), spec)) };
  }
  if (spec.startsWith('node:') || path.isAbsolute(spec)) return {};
  return { pkg: spec };
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // side-effect import
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return false;
  return bindings.elements.length > 0 && bindings.elements.every((el) => el.isTypeOnly);
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const clause = node.exportClause;
  if (!clause || !ts.isNamedExports(clause)) return false;
  return clause.elements.length > 0 && clause.elements.every((el) => el.isTypeOnly);
}

/** The runtime module specifiers of one source file. */
export function runtimeSpecifiers(file: string, source = fs.readFileSync(file, 'utf8')): string[] {
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!isTypeOnlyImport(node) && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
      return;
    }
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && !isTypeOnlyExport(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        specs.push(node.moduleSpecifier.text);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const [arg] = node.arguments;
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isRequire) && arg && ts.isStringLiteralLike(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

function directDeps(file: string): { files: string[]; packages: string[] } {
  const cached = depsCache.get(file);
  if (cached) return cached;
  const result: { files: string[]; packages: string[] } = { files: [], packages: [] };
  if (!file.endsWith('.json')) {
    for (const spec of runtimeSpecifiers(file)) {
      const resolved = resolveSpecifier(file, spec);
      if (resolved.file) result.files.push(resolved.file);
      else if (resolved.pkg) result.packages.push(resolved.pkg);
    }
  }
  depsCache.set(file, result);
  return result;
}

/**
 * Breadth-first walk from one or more entries; `files` includes the entries themselves.
 * `stopAt` files are recorded when reached but not followed (documented, pre-existing bridges).
 */
export function reachableGraph(
  entries: string | readonly string[],
  opts?: { stopAt?: ReadonlySet<string> },
): ImportGraph {
  const starts = (typeof entries === 'string' ? [entries] : entries).map((e) => path.normalize(path.resolve(e)));
  const graph: ImportGraph = { files: new Set(starts), packages: new Set(), parent: new Map() };
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (opts?.stopAt?.has(file)) continue;
    const deps = directDeps(file);
    for (const pkg of deps.packages) graph.packages.add(pkg);
    for (const dep of deps.files) {
      if (graph.files.has(dep)) continue;
      graph.files.add(dep);
      graph.parent.set(dep, file);
      queue.push(dep);
    }
  }
  return graph;
}

/** Every source file reachable from `entry` through runtime imports (absolute, normalized paths). */
export function reachableFiles(entry: string): Set<string> {
  return reachableGraph(entry).files;
}

/** The import chain from a walk's entry to `file`, repo-relative, for failure messages. */
export function importChain(graph: ImportGraph, file: string): string {
  const chain: string[] = [];
  let cur: string | undefined = path.normalize(file);
  while (cur) {
    chain.unshift(path.relative(REPO_ROOT, cur).replace(/\\/g, '/'));
    cur = graph.parent.get(cur);
  }
  return chain.join(' -> ');
}

/** True when the file's first statement is the `'use client'` directive. */
export function isUseClientFile(file: string): boolean {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const first = sf.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === 'use client'
  );
}

/** Every `.ts` / `.tsx` file under `dir`, skipping `__tests__`, `node_modules` and dot-directories. */
export function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path.normalize(full));
  }
  return out;
}
