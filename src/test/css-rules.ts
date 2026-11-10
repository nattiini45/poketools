/**
 * A small CSS reader for the tests that pin hand-written stylesheet rules (globals.css and the CSS
 * modules). It returns the leaf rules with their declarations, so an assertion reads a selector and a
 * property instead of the file's text: indentation, line breaks, an enclosing `@layer` / `@media` /
 * `@supports` wrapper and the quote style of attribute selectors do not change the result. The
 * at-rules around a rule stay readable through `context` (e.g. a reduced-motion override, a keyframe
 * step).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface CssRule {
  /** Whitespace-collapsed selector, `, ` between list items, attribute values in double quotes. */
  selector: string;
  /** Enclosing preludes, outermost first, whitespace-collapsed (`@layer utilities`, `@media (…)`, `@keyframes x`). */
  context: string[];
  /** Declarations in source order (duplicates kept), values whitespace-collapsed. */
  list: Array<[string, string]>;
  /** The last value per property. */
  decls: Map<string, string>;
  /** The declarations as `prop: value;` joined by single spaces, for pattern checks on a whole rule. */
  body: string;
}

const GLOBALS_CSS = fileURLToPath(new URL('../app/globals.css', import.meta.url));

export const stripCssComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

export const normalizeSelector = (selector: string) =>
  collapse(selector)
    .replace(/\s*,\s*/g, ', ')
    .replace(/(\[[\w-]+[~|^$*]?=)'([^']*)'\]/g, '$1"$2"]');

/** Splits on `;` outside parentheses and strings. */
function parseDeclarations(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const push = (chunk: string) => {
    const colon = chunk.indexOf(':');
    if (colon > 0) out.push([chunk.slice(0, colon).trim(), collapse(chunk.slice(colon + 1))]);
  };
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) {
      push(body.slice(start, i));
      start = i + 1;
    }
  }
  push(body.slice(start));
  return out;
}

/** Every leaf rule (a block without nested blocks), wrappers recorded in `context`. Throws on unbalanced braces. */
export function parseCssRules(css: string): CssRule[] {
  const source = stripCssComments(css);
  const rules: CssRule[] = [];
  const stack: Array<{ prelude: string; bodyStart: number; hasChild: boolean }> = [];
  let preludeStart = 0;
  let quote: string | null = null;
  let parens = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') parens++;
    else if (ch === ')') parens--;
    else if (ch === '{') {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ prelude: source.slice(preludeStart, i), bodyStart: i + 1, hasChild: false });
      preludeStart = i + 1;
    } else if (ch === '}') {
      const top = stack.pop();
      if (!top) throw new Error(`unbalanced } at offset ${i}`);
      if (!top.hasChild) {
        const list = parseDeclarations(source.slice(top.bodyStart, i));
        rules.push({
          selector: normalizeSelector(top.prelude),
          context: stack.map((entry) => normalizeSelector(entry.prelude)),
          list,
          decls: new Map(list),
          body: list.map(([name, value]) => `${name}: ${value};`).join(' '),
        });
      }
      preludeStart = i + 1;
    } else if (ch === ';' && parens === 0) {
      preludeStart = i + 1;
    }
  }
  if (stack.length > 0) throw new Error(`${stack.length} unclosed block(s)`);
  return rules;
}

export const readGlobalsCss = () => readFileSync(GLOBALS_CSS, 'utf8');

/** The text between the `/* === name === *\/` and `/* === end name === *\/` markers of a stylesheet. */
export function cssSection(css: string, name: string): string {
  const start = css.indexOf(`/* === ${name} === */`);
  const end = css.indexOf(`/* === end ${name} === */`);
  if (start < 0 || end <= start) throw new Error(`section "${name}" not found`);
  return css.slice(start, end);
}

/** The @keyframes name a rule is a step of, or null. */
export function keyframesOf(rule: CssRule): string | null {
  for (const prelude of rule.context) {
    const match = /^@(?:-webkit-)?keyframes\s+(\S+)$/.exec(prelude);
    if (match) return match[1];
  }
  return null;
}

export const inReducedMotion = (rule: CssRule) =>
  rule.context.some((prelude) => /^@media\b.*prefers-reduced-motion:\s*reduce/.test(prelude));
