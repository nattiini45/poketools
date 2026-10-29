import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Keeps the dispatch layer generic and inside its privilege boundary (plan 3.2, 3.9 tests 4 and 5): it imports no
 * route and no executor, uses only literal `import()` specifiers (here: none), never touches the assistant's tables,
 * never reads `err.message` into a result, and never sets a cookie or an authorization header on the synthetic
 * request.
 */
const DIR = path.resolve(__dirname, '..');
const sources = readdirSync(DIR)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, text: readFileSync(path.join(DIR, file), 'utf8') }));

/** The code of a file without its comments, so a comment may name what the code must not do. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('dispatch sources', () => {
  it('finds the module files', () => {
    expect(sources.map((s) => s.file).sort()).toEqual(['binding.ts', 'index.ts', 'invoke.ts', 'outcome.ts', 'types.ts']);
  });

  it.each(sources)('$file imports no route, no executor and no op binding', ({ text }) => {
    const imports = [...code(text).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/^@\/app\//);
      expect(specifier).not.toMatch(/executor|_ops/);
    }
  });

  it.each(sources)('$file has no dynamic import()', ({ text }) => {
    expect(code(text)).not.toMatch(/\bimport\s*\(/);
  });

  it.each(sources)('$file never touches the assistant tables', ({ text }) => {
    expect(code(text)).not.toMatch(/admin_agent_/);
  });

  it.each(sources)('$file never builds a result from err.message', ({ text }) => {
    expect(code(text)).not.toMatch(/\.message/);
  });

  it('never sets a cookie or an authorization header, nor reads the inbound cookie', () => {
    const invoke = code(sources.find((s) => s.file === 'invoke.ts')?.text ?? '');
    expect(invoke).not.toMatch(/['"](cookie|authorization)['"]/i);
    expect(invoke).not.toMatch(/\bcookies\s*\(/);
    // The only inbound headers it reads are the two client-address headers.
    expect([...invoke.matchAll(/inbound\.headers\.get\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['name']);
    expect(invoke).toMatch(/COPIED_HEADERS = \['x-forwarded-for', 'x-real-ip'\] as const/);
  });

  it('is the only layer here that imports runAsVerifiedSession', () => {
    const importers = sources.filter((s) => /\brunAsVerifiedSession\b/.test(code(s.text))).map((s) => s.file);
    expect(importers).toEqual(['invoke.ts']);
  });
});
