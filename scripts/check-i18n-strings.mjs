// i18n guard: finds hard-coded user-facing strings and locale hazards in src/
// (i18n-core design §8.3, package G0-TOOL-DOC). User-facing text goes through
// src/i18n (AGENTS.md "Text goes through src/i18n"); this script reports text
// that still bypasses it. It parses with the repo's own `typescript` compiler
// API, so it adds no dependency.
//
// Inputs (one of):
//   --paths <glob|dir|file …>  explicit files, directories or globs (several
//                              values, or one value separated by spaces/commas)
//   --all                      every .ts/.tsx file under src/ (CI, the sweep)
//   (neither)                  the files changed against ${BASE:-origin/main}:
//                              git diff --name-only --diff-filter=AM BASE...HEAD
//
// Modes, controlled by the `ENFORCE` env var:
//   - report-only (default): prints findings, exits 0
//   - enforce (ENFORCE=1): prints findings, exits 1 if any remain
// A tool failure (bad arguments, git failure, unreadable allowlist) exits 2;
// so does a --paths entry that matches no file (a typo must not pass vacuously).
//
// Rules (rules 1-4 and 6 apply to src/app, src/components and src/lib, never to
// src/app/api/**; rule 5 applies to all of src outside src/i18n/**; tests,
// .d.ts files and src/i18n/messages/** are never scanned):
//   1 jsx-text     JSX text with >= 2 letters
//   2 jsx-attr     a string literal as the value of a text attribute
//                  (aria-label, title, placeholder, alt, label, …, *Label,
//                  *Text, *Title, *Message, *Placeholder)
//   3 call-arg     a string literal or prose template as the first argument of
//                  setError/setSuccess/setMessage/setStatusText/confirm/alert/toast*
//   4 object-text  a string of >= 2 words, or with a capitalised word of >= 3
//                  letters, under the key label/title/description/text/message
//                  of an object literal (src/components and src/app only)
//   6 jsx-expr     a string literal or prose template rendered as a JSX child:
//                  <p>{'Save'}</p>, {ok ? 'Yes' : 'No'}, {busy && 'Saving'},
//                  {`${n} picks`}, {'Total: ' + n}, {['a', 'b'].join(' ')},
//                  {names.join(' and ')} (same filter as rule 1; not inside
//                  <style>/<script>; call arguments such as {t('key')} are not
//                  walked, except those of join and concat)
//   5 locale       toLocale{Date,Time,}String() without arguments;
//                  Intl.{DateTimeFormat,NumberFormat}(undefined …); the literals
//                  'en-US' / 'en-GB' / 'de-DE'; new Date() or Date.now() during
//                  a component render under src/components or src/app (not api)
//
// Ignored: a node whose preceding line carries `// i18n-ignore: <reason>` or
// `{/* i18n-ignore: <reason> */}` (the reason is required; for rule 6 a marker
// above the first line of a multi-line {…} child covers all of it); files matched by
// scripts/i18n-allowlist.json; strings with no lowercase letter and length <= 4
// (HP, KO, VS); punctuation and symbols; the allowlist tokens and format ids
// (gen9…); CSS/Tailwind-looking strings; URLs and paths; arguments of
// console.*, logger.*, expect(), `new …Error(` and `throw`.
//
// "During a component render" (rule 5) is a heuristic: the nearest enclosing
// named function is PascalCase (`Page`, not `GET`). Anonymous callbacks (effects, handlers, timers)
// stop the walk, except the render-time ones passed to useMemo/useState.
//
// Usage:
//   node scripts/check-i18n-strings.mjs --paths "src/components/league/**"
//   node scripts/check-i18n-strings.mjs --all
//   ENFORCE=1 node scripts/check-i18n-strings.mjs --all
//
// The scan is pure (`scanSource`) and the CLI is `run()`; both are exported for
// scripts/__tests__/check-i18n-strings.test.mjs. Importing the module runs nothing.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join('scripts', 'i18n-allowlist.json');

export const IGNORE_MARKER = 'i18n-ignore:';

const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const LOWER = /[a-zß-öø-ÿ]/;

const TEXT_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'title',
  'placeholder',
  'alt',
  'label',
  'subtitle',
  'description',
  'heading',
  'message',
  'emptyMessage',
  'confirmLabel',
  'cancelLabel',
  'pendingMessage',
]);
const TEXT_ATTR_SUFFIX = /(Label|Text|Title|Message|Placeholder)$/;

const TEXT_CALLS = new Set(['setError', 'setSuccess', 'setMessage', 'setStatusText', 'confirm', 'alert']);
const OBJECT_TEXT_KEYS = new Set(['label', 'title', 'description', 'text', 'message']);
const LOCALE_LITERALS = new Set(['en-US', 'en-GB', 'de-DE']);
const LOCALE_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);
const RENDER_TIME_HOOKS = new Set(['useMemo', 'useState']);
const SILENT_CALL_ROOTS = new Set(['console', 'logger']);

const DEFAULT_TOKENS = ['PokéTools', 'EvoLiga', 'Discord', 'Showdown', 'Pokémon', 'OBS', 'Smogon', 'Bo3'];

// ---------------------------------------------------------------------------
// String classification (pure)
// ---------------------------------------------------------------------------

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function letterCount(s) {
  return (s.match(LETTER) ?? []).length;
}

/** Removes HTML entities (`&nbsp;`, `&#183;`), allowlist tokens and format ids. */
function stripNonProse(text, tokens) {
  let out = text.replace(/&(?:[A-Za-z]+|#\d+|#x[0-9A-Fa-f]+);/g, ' ');
  for (const token of tokens) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(token)}(?=$|[^\\p{L}\\p{N}])`, 'gu'), '$1 ');
  }
  return out.replace(/\bgen\d\w*/gi, ' ');
}

function isCssLike(s) {
  return /^[a-z0-9\-:/[\]#.% ]+$/.test(s) && /[-:]/.test(s);
}

const FILE_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|glb|gltf|bin|ktx2|json|csv|tsv|txt|md|pdf|mp3|mp4|webm|ogg|wav|zip)$/i;

function isUrlOrPath(s) {
  // A bare file name such as `{}.png` (a template whose stem is a substitution) or `figure.glb`.
  if (!/\s/.test(s) && FILE_EXTENSION.test(s)) return true;
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:|data:|\/|\.\.?\/|#|\?)/i.test(s)) return true;
  // `image/png`, `api/foo/bar`: one lowercase token with a slash. `Win/Loss` stays text.
  return !/\s/.test(s) && /[/\\]/.test(s) && !/[A-ZÀ-ÖØ-Þ]/.test(s);
}

/**
 * True when `raw` reads as user-facing prose: it has >= 2 letters once tokens,
 * entities and format ids are removed, and it is not a short all-caps code, CSS
 * or a URL/path. Every rule 1-4 candidate passes through this filter.
 */
export function looksLikeText(raw, tokens = DEFAULT_TOKENS) {
  // `{}` marks a template substitution (templateText): only the literal parts are judged.
  const text = raw.replace(/\{\}/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length === 0) return false;
  if (!LOWER.test(text) && text.length <= 4) return false;
  if (isCssLike(text) || isUrlOrPath(text)) return false;
  return letterCount(stripNonProse(text, tokens)) >= 2;
}

/** Rule 4's bar: >= 2 words, or one capitalised word of >= 3 letters. */
function looksLikeLabel(raw, tokens) {
  if (!looksLikeText(raw, tokens)) return false;
  const prose = stripNonProse(raw, tokens);
  const words = prose.match(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g) ?? [];
  if (words.length >= 2) return true;
  return words.some((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w) && w.length >= 3);
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function scriptKindFor(fileName) {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function isStringLike(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

/** The literal text of a template expression with `{}` standing in for each substitution. */
function templateText(node) {
  return node.head.text + node.templateSpans.map((span) => `{}${span.literal.text}`).join('');
}

/** String-literal leaves of an expression: through parentheses, `as`, `?:`, `??` and `||`. */
function literalLeaves(expr) {
  if (!expr) return [];
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) {
    return literalLeaves(expr.expression);
  }
  if (ts.isConditionalExpression(expr)) return [...literalLeaves(expr.whenTrue), ...literalLeaves(expr.whenFalse)];
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...literalLeaves(expr.left), ...literalLeaves(expr.right)];
  }
  if (isStringLike(expr)) return [{ node: expr, text: expr.text }];
  if (ts.isTemplateExpression(expr)) return [{ node: expr, text: templateText(expr) }];
  return [];
}

/** Array methods whose result renders the receiver's own elements (rule 6 walks their receiver). */
const RECEIVER_RENDERING_METHODS = new Set([
  'join', 'concat', 'toString', 'slice', 'filter', 'reverse', 'sort', 'toReversed', 'toSorted', 'flat', 'at', 'find',
  'findLast',
]);

/**
 * The subset of RECEIVER_RENDERING_METHODS whose ARGUMENTS render too: a join
 * separator (`{names.join(' and ')}`) and concat payloads (`{a.concat(' and ')}`).
 */
const ARGUMENT_RENDERING_METHODS = new Set(['join', 'concat']);

/**
 * Rule 6: the leaves of a JSX child expression. Walks the shapes that still render
 * their strings: parentheses, `x!`, `as`/`satisfies`, `?:`, the right side of
 * `&&`, both sides of `??`, `||` and `+`, the template of a tagged template,
 * the elements of an array literal (`{['a', 'b']}`) and the receiver of a method
 * whose result still holds the receiver's elements (`{['Save', 'changes'].join(' ')}`;
 * not `.map(cb)`, whose receiver is usually a list of keys and only the callback renders).
 * Call ARGUMENTS are not walked, on purpose: a generic call such as
 * `{t('draft.key')}` or `{cn('…')}` takes keys and class names, not prose, and
 * would only be false positives; rule 3 covers the calls known to take text.
 * filter/find/at callbacks and indices stay exempt too. The one exception is
 * ARGUMENT_RENDERING_METHODS (join, concat), whose arguments end up in the output.
 */
function childLeaves(expr) {
  if (!expr) return [];
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  ) {
    return childLeaves(expr.expression);
  }
  if (ts.isConditionalExpression(expr)) return [...childLeaves(expr.whenTrue), ...childLeaves(expr.whenFalse)];
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return childLeaves(expr.right);
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expr.operatorToken.kind === ts.SyntaxKind.PlusToken)
  ) {
    return [...childLeaves(expr.left), ...childLeaves(expr.right)];
  }
  if (ts.isTaggedTemplateExpression(expr)) return childLeaves(expr.template);
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((el) => childLeaves(ts.isSpreadElement(el) ? el.expression : el));
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression) &&
    RECEIVER_RENDERING_METHODS.has(expr.expression.name.text)
  ) {
    const receiver = childLeaves(expr.expression.expression);
    if (!ARGUMENT_RENDERING_METHODS.has(expr.expression.name.text)) return receiver;
    const args = expr.arguments.flatMap((arg) => childLeaves(ts.isSpreadElement(arg) ? arg.expression : arg));
    return [...receiver, ...args];
  }
  return literalLeaves(expr);
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  return null;
}

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

function calleeRoot(expr) {
  let e = expr;
  while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isCallExpression(e)) e = e.expression;
  return ts.isIdentifier(e) ? e.text : null;
}

/** The callee is one of rule 3's text setters/dialogs (`toast`, `toast.error`, `window.confirm` included). */
function isTextCall(call) {
  const name = calleeName(call.expression);
  if (name === null) return false;
  if (TEXT_CALLS.has(name)) {
    // `confirm`/`alert` as a method only on `window`; setters may be called on anything.
    if (ts.isPropertyAccessExpression(call.expression) && (name === 'confirm' || name === 'alert')) {
      return calleeRoot(call.expression) === 'window';
    }
    return true;
  }
  if (/^toast/.test(name)) return true;
  return ts.isPropertyAccessExpression(call.expression) && calleeRoot(call.expression) === 'toast';
}

/** Inside console.*, logger.*, expect(), `new …Error(` or a throw: developer text, never shown. */
function inSilentContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isThrowStatement(p)) return true;
    if (ts.isCallExpression(p)) {
      const root = calleeRoot(p.expression);
      if (root !== null && SILENT_CALL_ROOTS.has(root) && ts.isPropertyAccessExpression(p.expression)) return true;
      if (ts.isIdentifier(p.expression) && p.expression.text === 'expect') return true;
    }
    if (ts.isNewExpression(p)) {
      const name = calleeName(p.expression);
      if (name !== null && /Error$/.test(name)) return true;
    }
    if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}

function functionName(fn) {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  // `const Card = memo(function (…) {…})` / `forwardRef((…) => …)`
  if (parent && ts.isCallExpression(parent)) {
    const decl = parent.parent;
    if (decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
      const wrapper = calleeName(parent.expression);
      if (wrapper === 'memo' || wrapper === 'forwardRef') return decl.name.text;
    }
  }
  if (parent && (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent))) return propertyNameText(parent.name);
  if (ts.isMethodDeclaration(fn)) return propertyNameText(fn.name);
  return null;
}

/** Rule 5 heuristic: the clock read runs while a PascalCase component renders. */
function inComponentRender(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (!ts.isFunctionLike(p)) continue;
    const name = functionName(p);
    // PascalCase with a lowercase letter: `Page`, `DraftBoard` — not `GET`/`POST` handlers.
    if (name !== null) return /^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/.test(name);
    const call = p.parent;
    if (call && ts.isCallExpression(call) && call.arguments.includes(p)) {
      const hook = calleeName(call.expression);
      if (hook !== null && RENDER_TIME_HOOKS.has(hook)) continue;
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The scan (pure)
// ---------------------------------------------------------------------------

/** Normalises a path to repo-relative forward slashes. */
export function toPosix(p) {
  return p.split(sep).join('/').replace(/^\.\//, '');
}

function isUiTextScope(file) {
  return /^src\/(app|components|lib)\//.test(file) && !file.startsWith('src/app/api/');
}

/**
 * Scans one source file. `fileName` is repo-relative (forward slashes) and
 * decides which rules apply. Returns `{ line, column, rule, text }[]`, 1-based.
 */
export function scanSource(sourceText, fileName, options = {}) {
  const tokens = options.tokens ?? DEFAULT_TOKENS;
  const file = toPosix(fileName);
  const textRules = isUiTextScope(file);
  const objectRule = /^src\/(components|app)\//.test(file) && !file.startsWith('src/app/api/');
  const localeRule = file.startsWith('src/') && !file.startsWith('src/i18n/');
  const renderClockRule = /^src\/(components|app)\//.test(file) && !file.startsWith('src/app/api/');
  if (!textRules && !localeRule) return [];

  const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const lines = sourceText.split(/\r?\n/);
  const findings = [];

  const ignored = (line) => {
    const prev = lines[line - 2];
    if (prev === undefined) return false;
    const at = prev.indexOf(IGNORE_MARKER);
    if (at === -1) return false;
    const reason = prev.slice(at + IGNORE_MARKER.length).replace(/\*\/\s*\}?\s*$/, '').trim();
    return reason.length > 0;
  };

  const report = (node, rule, text) => {
    // getStart skips leading trivia, so multi-line JSX text points at its first visible character.
    const start = node.getStart(sf);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    if (ignored(line + 1)) return;
    findings.push({ line: line + 1, column: character + 1, rule, text: text.replace(/\s+/g, ' ').trim().slice(0, 80) });
  };

  const visit = (node) => {
    if (textRules) {
      // Rule 1: JSX text.
      if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
        const tag = ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText(sf) : '';
        if (tag !== 'style' && tag !== 'script' && looksLikeText(node.text, tokens)) report(node, 'jsx-text', node.text);
      }
      // Rule 6: string literals rendered as JSX children.
      if (
        ts.isJsxExpression(node) &&
        node.expression &&
        node.parent &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
      ) {
        const tag = ts.isJsxElement(node.parent) ? node.parent.openingElement.tagName.getText(sf) : '';
        // A marker on the line above the expression's first line covers every leaf of a
        // multi-line child (`{cond` / `? 'Yes'` / `: 'No'}`); each leaf still honours its own.
        const exprLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        if (tag !== 'style' && tag !== 'script' && !ignored(exprLine)) {
          for (const leaf of childLeaves(node.expression)) {
            if (looksLikeText(leaf.text, tokens) && !inSilentContext(leaf.node)) report(leaf.node, 'jsx-expr', leaf.text);
          }
        }
      }
      // Rule 2: text attributes.
      if (ts.isJsxAttribute(node) && node.initializer) {
        const name = node.name.getText(sf);
        if (TEXT_ATTRS.has(name) || TEXT_ATTR_SUFFIX.test(name)) {
          const init = node.initializer;
          const leaves = ts.isStringLiteral(init)
            ? [{ node: init, text: init.text }]
            : ts.isJsxExpression(init)
              ? literalLeaves(init.expression)
              : [];
          for (const leaf of leaves) {
            if (looksLikeText(leaf.text, tokens)) report(leaf.node, 'jsx-attr', `${name}=${leaf.text}`);
          }
        }
      }
      // Rule 3: setters, dialogs, toasts.
      if (ts.isCallExpression(node) && node.arguments.length > 0 && isTextCall(node)) {
        for (const leaf of literalLeaves(node.arguments[0])) {
          if (looksLikeText(leaf.text, tokens) && !inSilentContext(leaf.node)) report(leaf.node, 'call-arg', leaf.text);
        }
      }
      // Rule 4: label-like object properties.
      if (objectRule && ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.parent)) {
        const key = propertyNameText(node.name);
        if (key !== null && OBJECT_TEXT_KEYS.has(key)) {
          for (const leaf of literalLeaves(node.initializer)) {
            if (looksLikeLabel(leaf.text, tokens) && !inSilentContext(leaf.node)) {
              report(leaf.node, 'object-text', `${key}: ${leaf.text}`);
            }
          }
        }
      }
    }

    if (localeRule) {
      // Rule 5a: argument-less toLocale*String().
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 0 &&
        ts.isPropertyAccessExpression(node.expression) &&
        LOCALE_METHODS.has(node.expression.name.text)
      ) {
        report(node, 'locale', `${node.expression.name.text}() without a locale`);
      }
      // Rule 5b: Intl.DateTimeFormat(undefined …) / Intl.NumberFormat(undefined …).
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments && node.arguments.length > 0) {
        const callee = node.expression;
        if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === 'Intl' &&
          (callee.name.text === 'DateTimeFormat' || callee.name.text === 'NumberFormat') &&
          ts.isIdentifier(node.arguments[0]) &&
          node.arguments[0].text === 'undefined'
        ) {
          report(node, 'locale', `Intl.${callee.name.text}(undefined)`);
        }
      }
      // Rule 5c: hard-coded locale tags.
      if (isStringLike(node) && LOCALE_LITERALS.has(node.text) && !(node.parent && ts.isLiteralTypeNode(node.parent))) {
        report(node, 'locale', `'${node.text}'`);
      }
      // Rule 5d: the clock read during a component render.
      if (renderClockRule) {
        const isNewDate =
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'Date' &&
          (!node.arguments || node.arguments.length === 0);
        const isDateNow =
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Date' &&
          node.expression.name.text === 'now';
        if ((isNewDate || isDateNow) && inComponentRender(node)) {
          report(node, 'locale', `${isNewDate ? 'new Date()' : 'Date.now()'} during render`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return findings;
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

/**
 * Converts a glob to an anchored RegExp. Supports `**`, `*`, `?` and `{a,b}`;
 * every other character is literal, so Next.js segments such as `(public)` and
 * `[id]` need no escaping.
 */
export function globToRegExp(glob) {
  const g = toPosix(glob);
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const slashAfter = g[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      braceDepth += 1;
      re += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth -= 1;
      re += ')';
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
    } else {
      re += escapeRegExp(c);
    }
  }
  return new RegExp(`^${re}$`);
}

/** Reads and validates scripts/i18n-allowlist.json under `root`. Throws on a malformed file. */
export function loadAllowlist(root = REPO_ROOT) {
  const raw = JSON.parse(readFileSync(join(root, ALLOWLIST_PATH), 'utf8'));
  const files = Array.isArray(raw.files) ? raw.files : null;
  const tokens = Array.isArray(raw.tokens) ? raw.tokens : null;
  if (files === null || tokens === null) throw new Error(`${ALLOWLIST_PATH} needs "files" and "tokens" arrays`);
  for (const entry of files) {
    if (typeof entry?.glob !== 'string' || typeof entry?.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`${ALLOWLIST_PATH}: every file entry needs a "glob" and a non-empty "reason"`);
    }
  }
  if (!tokens.every((t) => typeof t === 'string' && t.length > 0)) {
    throw new Error(`${ALLOWLIST_PATH}: "tokens" must be non-empty strings`);
  }
  return { files: files.map((f) => ({ ...f, re: globToRegExp(f.glob) })), tokens };
}

export function isAllowlisted(file, allowlist) {
  const f = toPosix(file);
  return allowlist.files.some((entry) => entry.re.test(f));
}

/** A file this tool scans at all: .ts/.tsx under src/, not a test, a declaration or a message dictionary. */
export function isScannable(file) {
  const f = toPosix(file);
  if (!f.startsWith('src/') || !/\.tsx?$/.test(f) || f.endsWith('.d.ts')) return false;
  if (/(^|\/)__tests__\//.test(f) || /\.(test|spec)\.tsx?$/.test(f) || f.startsWith('src/test/')) return false;
  if (f.startsWith('src/i18n/messages/')) return false;
  return true;
}

function walk(root, dir, acc) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return acc;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, rel, acc);
    else if (entry.isFile()) acc.push(rel);
  }
  return acc;
}

/** The directory part of a glob before its first wildcard, so expansion walks as little as possible. */
function globBase(glob) {
  const parts = toPosix(glob).split('/');
  const fixed = [];
  for (const part of parts) {
    if (/[*?{]/.test(part)) break;
    fixed.push(part);
  }
  return fixed.join('/');
}

/**
 * Splits one `--paths` value into items on whitespace, and on commas only
 * outside `{…}`, so `src/types/{draft,evolution}.ts` stays one glob while
 * `a.ts,b.ts` is still two paths.
 */
export function splitPathList(value) {
  const items = [];
  let current = '';
  let depth = 0;
  for (const c of value) {
    if (c === '{') depth += 1;
    else if (c === '}' && depth > 0) depth -= 1;
    if (/\s/.test(c) || (c === ',' && depth === 0)) {
      if (current) items.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current) items.push(current);
  return items;
}

/**
 * Expands `--paths` values (files, directories, globs) to repo-relative files
 * under `root`. `unmatched`, when given, collects every item that expanded to
 * no file at all (a missing path, an empty directory, a glob with no match).
 */
export function expandPaths(values, root = REPO_ROOT, unmatched = null) {
  const out = new Set();
  for (const value of values) {
    for (const item of splitPathList(value)) {
      const p = toPosix(item).replace(/\/+$/, '');
      let hits = 0;
      if (/[*?{]/.test(p)) {
        const re = globToRegExp(p);
        const base = globBase(p);
        const baseAbs = join(root, base);
        const start = existsSync(baseAbs) && statSync(baseAbs).isFile() ? [base] : walk(root, base, []);
        for (const f of start) {
          if (re.test(f)) {
            out.add(f);
            hits += 1;
          }
        }
      } else {
        const abs = join(root, p);
        if (existsSync(abs)) {
          if (statSync(abs).isDirectory()) {
            for (const f of walk(root, p, [])) {
              out.add(f);
              hits += 1;
            }
          } else {
            out.add(p);
            hits += 1;
          }
        }
      }
      if (hits === 0 && unmatched) unmatched.push(item);
    }
  }
  return [...out].sort();
}

/**
 * Pathspecs for changed-files mode. The `:(glob)` magic makes `**` match zero
 * or more directories, so top-level files such as `src/middleware.ts` match too;
 * a plain `src/**\/*.ts` pathspec is fnmatch-style and needs a directory level.
 */
export const CHANGED_PATHSPECS = [':(glob)src/**/*.ts', ':(glob)src/**/*.tsx'];

function changedFiles(root, base) {
  const res = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', ...CHANGED_PATHSPECS],
    { cwd: root, encoding: 'utf8' },
  );
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || res.error?.message || 'spawn failed').trim();
    throw new Error(`git diff against ${base} failed: ${detail} (pass --paths or --all, or set BASE)`);
  }
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  const opts = { all: false, paths: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--paths') {
      const values = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) values.push(argv[(i += 1)]);
      if (values.length === 0) throw new Error('--paths needs at least one file, directory or glob');
      opts.paths = [...(opts.paths ?? []), ...values];
    } else {
      throw new Error(`unknown argument "${arg}" (expected --paths <…> or --all)`);
    }
  }
  if (opts.all && opts.paths) throw new Error('use either --all or --paths, not both');
  return opts;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Runs the check and returns `{ exitCode, findings, files, output }` instead of
 * exiting, so tests can drive it against a scratch `root`.
 */
export function run(argv, { root = REPO_ROOT, env = process.env } = {}) {
  const out = [];
  const log = (line) => out.push(line);
  const enforce = env.ENFORCE === '1';
  let opts;
  let allowlist;
  let candidates;
  try {
    opts = parseArgs(argv);
    allowlist = loadAllowlist(root);
    if (opts.all) candidates = walk(root, 'src', []);
    else if (opts.paths) {
      const unmatched = [];
      candidates = expandPaths(opts.paths, root, unmatched);
      if (unmatched.length > 0) {
        throw new Error(`--paths matched no file for: ${unmatched.map((u) => JSON.stringify(u)).join(', ')}`);
      }
    }
    else candidates = changedFiles(root, env.BASE || 'origin/main');
  } catch (error) {
    log(`[i18n-strings] error: ${error instanceof Error ? error.message : String(error)}`);
    return { exitCode: 2, findings: [], files: [], output: out.join('\n') };
  }

  const files = candidates
    .map(toPosix)
    .filter((f) => isScannable(f) && !isAllowlisted(f, allowlist) && existsSync(join(root, f)));
  const findings = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const f of scanSource(text, file, { tokens: allowlist.tokens })) findings.push({ file, ...f });
  }

  const scope = opts.all ? '--all' : opts.paths ? '--paths' : `changed vs ${env.BASE || 'origin/main'}`;
  if (opts.paths && files.length === 0) {
    // Every --paths entry exists, but none is a scannable src file: say so, and fail under ENFORCE.
    log(`[i18n-strings] ${enforce ? 'error' : 'warning'}: --paths selected no scannable src/**/*.ts(x) file.`);
    if (enforce) return { exitCode: 2, findings: [], files, output: out.join('\n') };
  }
  if (findings.length === 0) {
    log(`[i18n-strings] OK: no hard-coded user-facing strings or locale hazards in ${files.length} file(s) (${scope}).`);
    return { exitCode: 0, findings, files, output: out.join('\n') };
  }
  const fileCount = new Set(findings.map((f) => f.file)).size;
  log(`[i18n-strings] ${findings.length} finding(s) in ${fileCount} of ${files.length} file(s) (${scope}):`);
  for (const f of findings) log(`  ${f.file}:${f.line}:${f.column}  [${f.rule}]  ${JSON.stringify(f.text)}`);
  log(`[i18n-strings] fix: move the text into a namespace under src/i18n/messages (docs/i18n.md), or add`);
  log(`[i18n-strings]      \`// i18n-ignore: <reason>\` on the line above when it must stay as it is.`);
  log(`[i18n-strings] mode: ${enforce ? 'ENFORCE' : 'report-only'}`);
  if (enforce) {
    log('[i18n-strings] ENFORCE mode: failing.');
    return { exitCode: 1, findings, files, output: out.join('\n') };
  }
  return { exitCode: 0, findings, files, output: out.join('\n') };
}

function isCli() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  const invoked = resolve(process.argv[1]);
  return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
}

if (isCli()) {
  const result = run(process.argv.slice(2));
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.output);
  process.exit(result.exitCode);
}

