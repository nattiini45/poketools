/**
 * route-manifest-scan.mjs: the pure part of the route-manifest scanner (no fs, no git, no process
 * access), so it is unit-tested on in-memory fixtures. The CLI wrapper is scripts/route-manifest.mjs.
 *
 * What it does. For each BOUND route (METHOD + URL path, from scripts/data/route-manifest-bindings.json)
 * it parses the route file with the TypeScript compiler API (already a devDependency) and records:
 *   - guards:     the auth guard helpers the handler calls (GUARD_HELPERS, plus `isSuperadmin` calls),
 *   - schemas:    zod schema names the handler parses with (`<name>.safeParse(...)`, `.parse(...)`, or a
 *                 `...Schema` identifier passed as an argument),
 *   - rateLimits: `checkRateLimit` bucket names,
 *   - expires:    `expire*` / `revalidate*` calls,
 *   - audit:      `logAuditEvent` action names,
 *   - emits:      `emitDiscordEvent` / `emitSocialEvent` calls with the event type when it is a literal,
 *   - imports:    the route file's direct runtime imports (names + a hash of each import's transitive closure),
 *   - importFingerprint: a hash over the names the route file imports TRANSITIVELY.
 *
 * What it understands (each case has a fixture test):
 *   - a handler declared as `export function POST`, `export const POST = ...`, `export { x as POST }`,
 *     `export { POST } from '...'`, `export * from '...'` or `export const { POST } = ...`;
 *   - helper functions and consts declared in the same file: a handler is credited with the calls of
 *     every top-level declaration it references (so `export const GET = handle` works);
 *   - guards imported under an alias (`import { requireAdmin as guard }`), through a namespace import
 *     (`auth.requireAdmin()`), through a dynamic `await import()` destructure, or re-exported under
 *     another name by a tracked module (`export { requireAnyAdmin as requireStaff } from ...`);
 *   - dynamic `import()` with a literal specifier, `require()`, `export ... from` and side-effect imports
 *     in the import fingerprint (type-only imports are erased by TypeScript and are not part of it).
 *
 * Stated limit (docs/poketools-spec.md section 18, plan 3.9 #1): behaviour inside the libraries a route
 * calls (a guard called by a helper that lives in another module, `createTournament`, ...) is visible
 * only through the import-name fingerprint, not through the per-call lists.
 *
 * Only files in the `files` list are ever visited or resolved to (the CLI passes `git ls-files` minus
 * the overlay roots), so the result is the same on a maintainer checkout and in CI.
 *
 * An import that resolves only to an untracked (not ignored) file is recorded as unresolved, like any
 * import the scan cannot follow, and is reported separately (`untrackedImports`): once that file is
 * tracked the import graph, and so the manifest, changes. The CLI refuses to write the manifest then.
 */

import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import ts from 'typescript';

export const ROUTE_METHODS = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

/** Guard vocabulary (plan 3.9 test 2). `isSuperadmin` is a predicate, recorded because it gates a branch. */
export const GUARD_HELPERS = [
  'isSuperadmin',
  'requireAdmin',
  'requireAnyAdmin',
  'requireAuth',
  'requireDraftAdmin',
  'requireFormatOwner',
  'requireFormatViewer',
  'requirePlayer',
  'requireResourceAdmin',
  'requireRulesetOwner',
  'requireRulesetViewer',
  'requireSuperadmin',
];

const GUARD_SET = new Set(GUARD_HELPERS);
const EMIT_HELPERS = new Set(['emitDiscordEvent', 'emitSocialEvent']);
const EXPIRE_CALL = /^(?:expire|revalidate)[A-Z]/;
const PARSE_METHODS = new Set(['parse', 'parseAsync', 'safeParse', 'safeParseAsync']);
const CODE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const ROUTE_FILE = /^src\/app\/(?:.*\/)?route\.(?:ts|tsx|js|jsx)$/;
const MAX_CHASE = 8;

/** Raised for problems with the bindings or the manifest that the caller must fix (never swallowed). */
export class ManifestError extends Error {
  /** @param {string[]} problems */
  constructor(problems) {
    super(problems.join('\n'));
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

const sortedUnique = (values) => [...new Set(values)].sort();
const hashLines = (lines) => createHash('sha256').update([...lines].sort().join('\n')).digest('hex').slice(0, 16);

/**
 * `src/app/api/formats/[id]/draft/route.ts` -> `/api/formats/[id]/draft`; route groups `(x)` are not URL
 * segments. Returns null for a file that is not an App Router route file.
 * @param {string} file repo-relative posix path
 * @returns {string | null}
 */
export function routePathOf(file) {
  if (!ROUTE_FILE.test(file)) return null;
  const segments = file
    .replace(/^src\/app\//, '')
    .split('/')
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.join('/')}`;
}

// ── Module parsing ──────────────────────────────────────────────────────────────────────────────

function scriptKindOf(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

const hasModifier = (node, kind) => (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);

/** Names bound by a destructuring pattern (`{ a, b: c, ...d }` -> a, c, d). */
function bindingNames(pattern, out = []) {
  for (const element of pattern.elements) {
    if (ts.isOmittedExpression(element)) continue;
    if (ts.isIdentifier(element.name)) out.push(element.name.text);
    else bindingNames(element.name, out);
  }
  return out;
}

function unwrap(expression) {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * Parse one source file into the facts the scanner needs.
 * @param {string} file repo-relative posix path
 * @param {string} source
 */
export function parseModule(file, source) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const mod = {
    file,
    sf,
    /** Runtime module edges: { specifier, names }. Type-only imports and re-exports are not edges. */
    edges: [],
    /** local name -> { specifier, imported } ('default' and '*' are the default and namespace imports). */
    bindings: new Map(),
    /** exported name -> { kind: 'local', local } | { kind: 'from', specifier, imported }. */
    exports: new Map(),
    /** Specifiers of `export * from`. */
    starExports: [],
    /** Top-level binding name -> declaration node (function, variable declaration, class). */
    decls: new Map(),
    /** Any-depth variable name -> initializer nodes, for resolving `const action = '...'`. */
    variables: new Map(),
  };

  for (const statement of sf.statements) readStatement(mod, statement);
  readDeep(mod, sf);
  return mod;
}

function readStatement(mod, statement) {
  if (ts.isImportDeclaration(statement)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause?.isTypeOnly) return;
    const names = [];
    if (clause) {
      if (clause.name) {
        names.push('default');
        mod.bindings.set(clause.name.text, { specifier, imported: 'default' });
      }
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        names.push('*');
        mod.bindings.set(named.name.text, { specifier, imported: '*' });
      } else if (named) {
        const values = named.elements.filter((element) => !element.isTypeOnly);
        // `import { type A } from 'x'` is erased entirely.
        if (named.elements.length > 0 && values.length === 0 && !clause.name) return;
        for (const element of values) {
          const imported = (element.propertyName ?? element.name).text;
          names.push(imported);
          mod.bindings.set(element.name.text, { specifier, imported });
        }
      }
    }
    mod.edges.push({ specifier, names: sortedUnique(names) });
    return;
  }

  if (ts.isImportEqualsDeclaration(statement)) {
    const reference = statement.moduleReference;
    if (ts.isExternalModuleReference(reference) && ts.isStringLiteral(reference.expression) && !statement.isTypeOnly) {
      mod.edges.push({ specifier: reference.expression.text, names: ['*'] });
      mod.bindings.set(statement.name.text, { specifier: reference.expression.text, imported: '*' });
    }
    return;
  }

  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return;
    const clause = statement.exportClause;
    if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (!clause) {
        mod.edges.push({ specifier, names: ['*'] });
        mod.starExports.push(specifier);
      } else if (ts.isNamespaceExport(clause)) {
        mod.edges.push({ specifier, names: ['*'] });
        mod.exports.set(clause.name.text, { kind: 'from', specifier, imported: '*' });
      } else {
        const values = clause.elements.filter((element) => !element.isTypeOnly);
        if (clause.elements.length > 0 && values.length === 0) return;
        const names = [];
        for (const element of values) {
          const imported = (element.propertyName ?? element.name).text;
          names.push(imported);
          mod.exports.set(element.name.text, { kind: 'from', specifier, imported });
        }
        mod.edges.push({ specifier, names: sortedUnique(names) });
      }
    } else if (clause && ts.isNamedExports(clause)) {
      for (const element of clause.elements) {
        if (element.isTypeOnly) continue;
        mod.exports.set(element.name.text, { kind: 'local', local: (element.propertyName ?? element.name).text });
      }
    }
    return;
  }

  if (ts.isExportAssignment(statement)) {
    const expression = unwrap(statement.expression);
    if (ts.isIdentifier(expression)) {
      mod.exports.set('default', { kind: 'local', local: expression.text });
    } else {
      mod.decls.set('default', statement);
      mod.exports.set('default', { kind: 'local', local: 'default' });
    }
    return;
  }

  const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    const name = statement.name?.text ?? 'default';
    mod.decls.set(name, statement);
    if (exported) mod.exports.set(isDefault ? 'default' : name, { kind: 'local', local: name });
    return;
  }

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      const names = ts.isIdentifier(declaration.name) ? [declaration.name.text] : bindingNames(declaration.name);
      for (const name of names) {
        mod.decls.set(name, declaration);
        if (exported) mod.exports.set(name, { kind: 'local', local: name });
      }
    }
  }
}

/** Walks the whole file for what can sit at any depth: variable initializers and dynamic loads. */
function readDeep(mod, root) {
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const list = mod.variables.get(node.name.text) ?? [];
      list.push(node.initializer);
      mod.variables.set(node.name.text, list);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require' && !mod.bindings.has('require');
      if (isDynamicImport || isRequire) {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
          const names = dynamicImportNames(mod, node);
          mod.edges.push({ specifier: arg.text, names });
        } else {
          mod.edges.push({ specifier: isDynamicImport ? '<non-literal import()>' : '<non-literal require()>', names: [] });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}

/** `const { a, b: c } = await import('x')` -> a, b (and a, c become bindings); anything else -> '*'. */
function dynamicImportNames(mod, call) {
  const specifier = call.arguments[0].text;
  let holder = call.parent;
  if (holder && ts.isAwaitExpression(holder)) holder = holder.parent;
  if (holder && ts.isVariableDeclaration(holder) && ts.isObjectBindingPattern(holder.name)) {
    const names = [];
    for (const element of holder.name.elements) {
      if (element.dotDotDotToken || !ts.isIdentifier(element.name)) return ['*'];
      const imported = (element.propertyName ?? element.name).text;
      names.push(imported);
      mod.bindings.set(element.name.text, { specifier, imported });
    }
    return sortedUnique(names);
  }
  return ['*'];
}

// ── Project: resolution, export chasing, fact collection ───────────────────────────────────────

/**
 * @param {{
 *   files: string[],
 *   readFile: (file: string) => string | undefined,
 *   pathAliases?: { pattern: string, targets: string[] }[],
 *   untracked?: string[],
 * }} options `files`: repo-relative posix paths this scan may visit or resolve to. `pathAliases`: tsconfig
 *   `paths` with the targets already made repo-relative (`{ pattern: '@/*', targets: ['src/*'] }`).
 *   `untracked`: files that exist but are not in `files`; never followed, only reported when an import hits one.
 */
export function createProject({ files, readFile, pathAliases = [], untracked = [] }) {
  const tracked = new Set(files);
  const pending = new Set(untracked);
  const untrackedHits = new Set();
  const modules = new Map();
  const edgeCache = new Map();

  function getModule(file) {
    if (modules.has(file)) return modules.get(file);
    let mod = null;
    if (CODE_FILE.test(file)) {
      const source = readFile(file);
      if (source !== undefined) mod = parseModule(file, source);
    }
    modules.set(file, mod);
    return mod;
  }

  function resolveFileBase(base) {
    const clean = posix.normalize(base);
    const candidates = [clean];
    const jsToTs = clean.match(/^(.*)\.(?:js|mjs|cjs|jsx)$/);
    if (jsToTs) candidates.push(`${jsToTs[1]}.ts`, `${jsToTs[1]}.tsx`);
    for (const extension of RESOLVE_EXTENSIONS) candidates.push(`${clean}${extension}`);
    for (const extension of RESOLVE_EXTENSIONS) candidates.push(posix.join(clean, `index${extension}`));
    const found = candidates.find((candidate) => tracked.has(candidate));
    if (!found) {
      const hit = candidates.find((candidate) => pending.has(candidate));
      if (hit) untrackedHits.add(hit);
    }
    return found;
  }

  /** @returns {{ kind: 'file', file: string } | { kind: 'package', name: string } | { kind: 'unresolved', specifier: string }} */
  function resolveSpecifier(from, specifier) {
    if (specifier.startsWith('.')) {
      const file = resolveFileBase(posix.join(posix.dirname(from), specifier));
      return file ? { kind: 'file', file } : { kind: 'unresolved', specifier };
    }
    if (specifier.startsWith('<')) return { kind: 'unresolved', specifier };
    if (specifier.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(specifier)) {
      return specifier.startsWith('node:') ? { kind: 'package', name: specifier } : { kind: 'unresolved', specifier };
    }
    let matched = false;
    for (const { pattern, targets } of pathAliases) {
      const star = pattern.indexOf('*');
      let captured = null;
      if (star === -1) {
        if (specifier === pattern) captured = '';
      } else {
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (specifier.startsWith(prefix) && specifier.endsWith(suffix) && specifier.length >= prefix.length + suffix.length) {
          captured = specifier.slice(prefix.length, specifier.length - suffix.length);
        }
      }
      if (captured === null) continue;
      matched = true;
      for (const target of targets) {
        const file = resolveFileBase(target.replace('*', captured));
        if (file) return { kind: 'file', file };
      }
    }
    return matched ? { kind: 'unresolved', specifier } : { kind: 'package', name: specifier };
  }

  /** The module's edges merged per specifier, each with its resolution. */
  function directEdges(file) {
    const mod = getModule(file);
    if (!mod) return [];
    const merged = new Map();
    for (const edge of mod.edges) {
      const names = merged.get(edge.specifier) ?? [];
      names.push(...edge.names);
      merged.set(edge.specifier, names);
    }
    return [...merged].map(([specifier, names]) => ({
      specifier,
      names: sortedUnique(names),
      target: resolveSpecifier(file, specifier),
    }));
  }

  /** Canonical lines of one file's imports, and the files they lead to. */
  function fileEdges(file) {
    const cached = edgeCache.get(file);
    if (cached) return cached;
    const lines = [];
    const next = [];
    for (const edge of directEdges(file)) {
      const names = edge.names.join(',');
      if (edge.target.kind === 'file') {
        lines.push(`${file}>${edge.target.file}#${names}`);
        next.push(edge.target.file);
      } else if (edge.target.kind === 'package') {
        lines.push(`${file}>pkg:${edge.target.name}`);
      } else {
        lines.push(`${file}>unresolved:${edge.specifier}#${names}`);
      }
    }
    const result = { lines, next };
    edgeCache.set(file, result);
    return result;
  }

  /** The files reachable from `entry` by runtime imports (entry included) and the canonical edge lines. */
  function closure(entry) {
    const seen = new Set([entry]);
    const stack = [entry];
    const lines = [];
    while (stack.length > 0) {
      const file = stack.pop();
      const edges = fileEdges(file);
      lines.push(...edges.lines);
      for (const target of edges.next) {
        if (!seen.has(target)) {
          seen.add(target);
          stack.push(target);
        }
      }
    }
    return { files: seen.size, lines };
  }

  /**
   * The exported name at its origin: follows `import { a as b }` aliases and `export { a as b } from` chains
   * through tracked modules. A module that defines the export itself ends the chase (its export name stands).
   */
  function originName(from, specifier, imported) {
    let name = imported;
    let currentFrom = from;
    let currentSpecifier = specifier;
    for (let step = 0; step < MAX_CHASE; step++) {
      if (name === 'default' || name === '*') return name;
      const target = resolveSpecifier(currentFrom, currentSpecifier);
      if (target.kind !== 'file') return name;
      const mod = getModule(target.file);
      const entry = mod?.exports.get(name);
      if (!mod || !entry) return name;
      if (entry.kind === 'from') {
        name = entry.imported;
        currentFrom = mod.file;
        currentSpecifier = entry.specifier;
        continue;
      }
      const binding = mod.bindings.get(entry.local);
      if (!binding) return name;
      name = binding.imported;
      currentFrom = mod.file;
      currentSpecifier = binding.specifier;
    }
    return name;
  }

  /** The module and local declaration that provide export `name` of `file`, chasing re-exports. */
  function resolveExport(file, name, depth = 0) {
    if (depth > MAX_CHASE) return null;
    const mod = getModule(file);
    if (!mod) return null;
    const entry = mod.exports.get(name);
    if (entry?.kind === 'local') {
      if (mod.decls.has(entry.local)) return { mod, local: entry.local };
      const binding = mod.bindings.get(entry.local);
      if (binding) return chase(file, binding.specifier, binding.imported, mod, depth);
      return null;
    }
    if (entry?.kind === 'from') return chase(file, entry.specifier, entry.imported, mod, depth);
    for (const specifier of mod.starExports) {
      const target = resolveSpecifier(file, specifier);
      if (target.kind !== 'file') continue;
      const found = resolveExport(target.file, name, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function chase(file, specifier, imported, mod, depth) {
    const target = resolveSpecifier(file, specifier);
    // A handler provided by an external package exists but cannot be read: empty facts, never a silent skip.
    if (target.kind !== 'file') return { mod, local: null };
    return resolveExport(target.file, imported, depth + 1);
  }

  /** Facts of the handler `local` declared in `mod`. */
  function collectFacts(mod, local) {
    const facts = {
      guards: new Set(),
      schemas: new Set(),
      rateLimits: new Set(),
      expires: new Set(),
      audit: new Set(),
      emits: new Set(),
    };
    if (local === null) return facts;
    const visited = new Set();

    const visitDeclaration = (name) => {
      if (visited.has(name)) return;
      visited.add(name);
      const declaration = mod.decls.get(name);
      if (declaration) walk(declaration);
    };

    const walk = (node) => {
      if (ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node)) inspectCall(mod, node, facts);
      else if (ts.isIdentifier(node) && isReference(node) && mod.decls.has(node.text)) visitDeclaration(node.text);
      ts.forEachChild(node, walk);
    };

    visitDeclaration(local);
    return facts;
  }

  function inspectCall(mod, call, facts) {
    const callee = unwrap(call.expression);
    let name = null;
    if (ts.isIdentifier(callee)) {
      const binding = mod.bindings.get(callee.text);
      if (binding) name = originName(mod.file, binding.specifier, binding.imported);
    } else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const binding = mod.bindings.get(callee.expression.text);
      if (binding?.imported === '*') name = originName(mod.file, binding.specifier, callee.name.text);
    }

    if (name !== null) {
      if (GUARD_SET.has(name)) {
        facts.guards.add(name);
      } else if (name === 'checkRateLimit') {
        const bucket = call.arguments[0];
        for (const value of bucket ? resolveStrings(mod, bucket) : ['<dynamic: no bucket>']) facts.rateLimits.add(value);
      } else if (EXPIRE_CALL.test(name)) {
        facts.expires.add(name);
      } else if (name === 'logAuditEvent') {
        for (const value of auditActions(mod, call.arguments[0])) facts.audit.add(value);
      } else if (EMIT_HELPERS.has(name)) {
        facts.emits.add(`${name}(${eventTypes(mod, call.arguments[0]).join('|')})`);
      }
    }

    if (ts.isPropertyAccessExpression(callee) && PARSE_METHODS.has(callee.name.text)) {
      const root = receiverRoot(unwrap(callee.expression));
      if (root !== null && /schema/i.test(root)) facts.schemas.add(root);
      else if (root !== null && /^z(?:\.|$)/.test(root)) facts.schemas.add('(inline)');
    }
    for (const arg of call.arguments) {
      const argument = unwrap(arg);
      if (ts.isIdentifier(argument) && /Schema$/.test(argument.text)) facts.schemas.add(argument.text);
    }
  }

  function auditActions(mod, argument) {
    if (!argument) return ['<dynamic: no entry>'];
    const objects = resolveObjects(mod, argument);
    const values = [];
    for (const object of objects) {
      const action = propertyValue(object, 'action');
      if (action) values.push(...resolveStrings(mod, action));
    }
    return values.length > 0 ? sortedUnique(values) : [`<dynamic: ${shortText(mod, argument)}>`];
  }

  function eventTypes(mod, argument) {
    if (!argument) return ['?'];
    const values = [];
    for (const object of resolveObjects(mod, argument)) {
      const type = propertyValue(object, 'event_type');
      if (type) values.push(...resolveStrings(mod, type));
    }
    return values.length > 0 ? sortedUnique(values) : ['?'];
  }

  /** String values an expression can take, resolving same-file consts; anything else is `<dynamic: ...>`. */
  function resolveStrings(mod, expression, depth = 0) {
    const node = unwrap(expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isConditionalExpression(node)) {
      return [...resolveStrings(mod, node.whenTrue, depth), ...resolveStrings(mod, node.whenFalse, depth)];
    }
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.BarBarToken || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
    ) {
      return [...resolveStrings(mod, node.left, depth), ...resolveStrings(mod, node.right, depth)];
    }
    if (ts.isIdentifier(node) && depth < 4) {
      const initializers = mod.variables.get(node.text);
      if (initializers) return initializers.flatMap((initializer) => resolveStrings(mod, initializer, depth + 1));
    }
    return [`<dynamic: ${shortText(mod, node)}>`];
  }

  function resolveObjects(mod, expression, depth = 0) {
    const node = unwrap(expression);
    if (ts.isObjectLiteralExpression(node)) return [node];
    if (ts.isConditionalExpression(node)) {
      return [...resolveObjects(mod, node.whenTrue, depth), ...resolveObjects(mod, node.whenFalse, depth)];
    }
    if (ts.isIdentifier(node) && depth < 4) {
      return (mod.variables.get(node.text) ?? []).flatMap((initializer) => resolveObjects(mod, initializer, depth + 1));
    }
    return [];
  }

  return {
    files,
    getModule,
    resolveSpecifier,
    directEdges,
    closure,
    resolveExport,
    collectFacts,
    /** Untracked files an import resolved to while scanning (sorted). */
    untrackedImports: () => sortedUnique([...untrackedHits]),
    /** Route files (App Router `route.*`) by URL path. */
    routeFilesByPath() {
      const byPath = new Map();
      for (const file of files) {
        const path = routePathOf(file);
        if (path === null) continue;
        const list = byPath.get(path) ?? [];
        list.push(file);
        byPath.set(path, list);
      }
      return byPath;
    },
  };
}

function propertyValue(object, name) {
  for (const property of object.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
    if (ts.isPropertyAssignment(property)) {
      const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
      if (key === name) return property.initializer;
    }
  }
  return null;
}

/**
 * The name a parse receiver starts from: `fooSchema` for `fooSchema.omit({...})`, `fooSchema(id)` and `fooSchema`;
 * `schemas.create` for a property chain; `z` for an inline `z.object({...})`. Null for anything else.
 */
function receiverRoot(expression) {
  let node = expression;
  for (;;) {
    if (ts.isCallExpression(node)) {
      // `a.omit(...)`: the method is not part of the name; `fooSchema(id)`: the callee is.
      const callee = unwrap(node.expression);
      node = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : callee;
    } else if (ts.isPropertyAccessExpression(node)) {
      const chain = chainText(node);
      if (chain !== null) return chain;
      node = unwrap(node.expression);
    } else if (ts.isIdentifier(node)) {
      return node.text;
    } else {
      return null;
    }
  }
}

function chainText(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const head = chainText(unwrap(expression.expression));
    return head === null ? null : `${head}.${expression.name.text}`;
  }
  return null;
}

function shortText(mod, node) {
  const text = node.getText(mod.sf).replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** True when an identifier reads a binding (not a property key, a declared name or a member access). */
function isReference(identifier) {
  const parent = identifier.parent;
  if (!parent) return true;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (parent.name === identifier) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === identifier) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  return true;
}

// ── Manifest ────────────────────────────────────────────────────────────────────────────────────

/**
 * Validates the bindings file contents.
 * @param {unknown} json parsed bindings file
 * @returns {{ method: string, path: string }[]} the binding entries (extra keys such as `class` are kept)
 */
export function parseBindings(json) {
  const problems = [];
  const list = json && typeof json === 'object' && 'bindings' in json ? json.bindings : null;
  if (!Array.isArray(list)) throw new ManifestError(['bindings file: expected { "bindings": [ ... ] }']);
  const seen = new Set();
  for (const [index, entry] of list.entries()) {
    const label = `bindings[${index}]`;
    if (!entry || typeof entry !== 'object') {
      problems.push(`${label}: expected an object`);
      continue;
    }
    const { method, path } = entry;
    if (!ROUTE_METHODS.includes(method)) problems.push(`${label}: method must be one of ${ROUTE_METHODS.join(', ')} (got ${JSON.stringify(method)})`);
    if (typeof path !== 'string' || !path.startsWith('/')) problems.push(`${label}: path must be a URL path starting with "/" (got ${JSON.stringify(path)})`);
    const key = `${method} ${path}`;
    if (seen.has(key)) problems.push(`${label}: duplicate binding ${key}`);
    seen.add(key);
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return list;
}

/** Removes files under the overlay roots (and the overlay's own files) from a file list. */
export function skipOverlay(files, overlay) {
  const roots = overlay?.roots ?? [];
  const named = new Set(Object.keys(overlay?.files ?? {}));
  return files.filter((file) => !named.has(file) && !roots.some((root) => file === root || file.startsWith(`${root}/`)));
}

/**
 * Builds the manifest for the bound routes.
 * @param {{
 *   files: string[],
 *   readFile: (file: string) => string | undefined,
 *   bindings: { method: string, path: string }[],
 *   pathAliases?: { pattern: string, targets: string[] }[],
 *   overlay?: { roots?: string[], files?: Record<string, unknown> } | null,
 *   untracked?: string[],
 * }} input
 */
export function buildManifest(input) {
  return buildManifestReport(input).manifest;
}

/**
 * Like buildManifest, plus the untracked files (from `input.untracked`) that an import of the scan hit.
 * Those imports are recorded as unresolved, so the manifest is only right once the files are tracked.
 * @returns {{ manifest: { version: number, routes: object }, untrackedImports: string[] }}
 */
export function buildManifestReport({ files, readFile, bindings, pathAliases = [], overlay = null, untracked = [] }) {
  const visible = skipOverlay(files, overlay);
  const project = createProject({ files: visible, readFile, pathAliases, untracked: skipOverlay(untracked, overlay) });
  const byPath = project.routeFilesByPath();
  const problems = [];
  const routes = {};

  for (const { method, path } of bindings) {
    const key = `${method} ${path}`;
    const candidates = byPath.get(path) ?? [];
    if (candidates.length === 0) {
      problems.push(`${key}: no tracked route file serves ${path}`);
      continue;
    }
    if (candidates.length > 1) {
      problems.push(`${key}: ${candidates.length} route files serve ${path} (${candidates.join(', ')})`);
      continue;
    }
    const file = candidates[0];
    const handler = project.resolveExport(file, method);
    if (!handler) {
      problems.push(`${key}: ${file} exports no ${method} handler`);
      continue;
    }
    const facts = project.collectFacts(handler.mod, handler.local);
    const entry = { file };
    if (handler.mod.file !== file) entry.handler = `${handler.mod.file}#${handler.local ?? method}`;
    entry.guards = sortedUnique(facts.guards);
    entry.schemas = sortedUnique(facts.schemas);
    entry.rateLimits = sortedUnique(facts.rateLimits);
    entry.expires = sortedUnique(facts.expires);
    entry.audit = sortedUnique(facts.audit);
    entry.emits = sortedUnique(facts.emits);
    Object.assign(entry, importSummary(project, file));
    routes[key] = entry;
  }

  if (problems.length > 0) throw new ManifestError(problems);
  const sorted = Object.fromEntries(Object.entries(routes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { manifest: { version: 1, routes: sorted }, untrackedImports: project.untrackedImports() };
}

/** Direct imports of the route file (with the hash of each closure) and the transitive fingerprint. */
function importSummary(project, file) {
  const imports = {};
  const packages = [];
  const unresolved = [];
  for (const edge of project.directEdges(file)) {
    if (edge.target.kind === 'file') {
      const inner = project.closure(edge.target.file);
      imports[edge.target.file] = { names: edge.names, closure: hashLines(inner.lines), files: inner.files };
    } else if (edge.target.kind === 'package') {
      packages.push(edge.target.name);
    } else {
      unresolved.push(edge.specifier);
    }
  }
  const whole = project.closure(file);
  const summary = {
    importFingerprint: hashLines(whole.lines),
    importFiles: whole.files,
    imports: Object.fromEntries(Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    packages: sortedUnique(packages),
  };
  if (unresolved.length > 0) summary.unresolved = sortedUnique(unresolved);
  return summary;
}

/**
 * Compares the declared guards of the bindings (the assistant registry, later) with the scanned ones
 * (plan 3.9 test 2). `declared`: `{ method, path, guards }`, `guards` a helper name or an array of names;
 * the sets must be equal. Wired for the registry: it imports this function and passes its own bindings.
 * @param {{ method: string, path: string, guards: string | string[] }[]} declared
 * @param {{ routes: Record<string, { guards: string[] }> }} manifest
 * @returns {{ key: string, kind: 'not_in_manifest' | 'unknown_guard' | 'guard_mismatch', declared: string[], scanned: string[] }[]}
 */
export function compareDeclaredGuards(declared, manifest) {
  const mismatches = [];
  for (const binding of declared) {
    const key = `${binding.method} ${binding.path}`;
    const want = sortedUnique(Array.isArray(binding.guards) ? binding.guards : [binding.guards]);
    const route = manifest.routes[key];
    if (!route) {
      mismatches.push({ key, kind: 'not_in_manifest', declared: want, scanned: [] });
      continue;
    }
    if (want.some((name) => !GUARD_SET.has(name))) {
      mismatches.push({ key, kind: 'unknown_guard', declared: want, scanned: route.guards });
      continue;
    }
    const scanned = sortedUnique(route.guards);
    if (want.length !== scanned.length || want.some((name, index) => name !== scanned[index])) {
      mismatches.push({ key, kind: 'guard_mismatch', declared: want, scanned });
    }
  }
  return mismatches;
}

// ── Output: stable formatting and a readable diff ───────────────────────────────────────────────

const WIDTH = 170;

/** The value with object keys in sorted order, so two manifests compare by content, not by key order. */
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

function inline(value) {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }`;
  }
  return JSON.stringify(value);
}

function render(value, indent, prefixLength) {
  const flat = inline(value);
  if (indent.length + prefixLength + flat.length <= WIDTH || typeof value !== 'object' || value === null) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    return `[\n${value.map((item) => `${inner}${render(item, inner, 0)}`).join(',\n')}\n${indent}]`;
  }
  const lines = Object.entries(value).map(([k, v]) => {
    const key = `${JSON.stringify(k)}: `;
    return `${inner}${key}${render(v, inner, key.length)}`;
  });
  return `{\n${lines.join(',\n')}\n${indent}}`;
}

/** The committed text of the manifest: stable key order, short entries on one line, LF, final newline. */
export function formatManifest(manifest) {
  return `${render(manifest, '', 0)}\n`;
}

/** Human-readable differences between the committed and the generated manifest (empty when equal). */
export function diffManifests(committed, generated) {
  const lines = [];
  const before = committed?.routes ?? {};
  const after = generated.routes;
  for (const key of sortedUnique([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in before)) {
      lines.push(`+ ${key}   (bound route missing from the committed manifest)`);
      continue;
    }
    if (!(key in after)) {
      lines.push(`- ${key}   (in the committed manifest, no longer bound)`);
      continue;
    }
    const changes = diffValue(before[key], after[key], '');
    if (changes.length > 0) lines.push(`~ ${key}`, ...changes.map((change) => `    ${change}`));
  }
  if (committed?.version !== generated.version) lines.push(`~ version: ${committed?.version} -> ${generated.version}`);
  return lines;
}

function diffValue(a, b, path) {
  if (inline(canonical(a)) === inline(canonical(b))) return [];
  if (Array.isArray(a) && Array.isArray(b) && a.every((x) => typeof x === 'string') && b.every((x) => typeof x === 'string')) {
    const removed = a.filter((x) => !b.includes(x)).map((x) => `- ${x}`);
    const added = b.filter((x) => !a.includes(x)).map((x) => `+ ${x}`);
    return [`${path}: ${[...removed, ...added].join('  ')}`];
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = [];
    for (const key of sortedUnique([...Object.keys(a), ...Object.keys(b)])) {
      const child = path === '' ? key : `${path}.${key}`;
      if (!(key in a)) out.push(`${child}: + ${inline(b[key])}`);
      else if (!(key in b)) out.push(`${child}: - ${inline(a[key])}`);
      else out.push(...diffValue(a[key], b[key], child));
    }
    return out;
  }
  return [`${path}: ${inline(a)} -> ${inline(b)}`];
}
