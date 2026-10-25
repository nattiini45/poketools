/**
 * PostgREST caps every response at `max_rows` (1000 in `supabase/config.toml`), so `.limit(N)` with N above 1000
 * silently returns 1000 rows and the caller never learns about the rest. A read that needs every row pages with
 * `readBoundedPages` or `readAllPages`; a read that wants a display cap uses a number of at most 1000. This walks the
 * query modules so an oversized literal (or a same-file constant) cannot ship.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const QUERIES_DIR = path.join(process.cwd(), 'src', 'lib', 'supabase', 'queries');
const MAX_ROWS = 1000;

/** `'<file relative to the queries dir>:<limit argument as written>'` -> one-line reason. Keep empty if possible. */
const ALLOWED: Record<string, string> = {};

interface Violation {
  line: number;
  arg: string;
  value: number;
}

/** Blank out block and line comments (keeping newlines, so line numbers hold) and leave string contents alone. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\' && next !== undefined) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    out += ch;
    i += 1;
  }
  return out;
}

/** Every `.limit(<arg>)` whose argument is a number, or a same-file `const NAME = <number>;`, above 1000. */
function findOversizedLimits(source: string): Violation[] {
  const src = stripComments(source);
  const found: Violation[] = [];
  const opener = /\.limit\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(src))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < src.length && depth > 0) {
      if (src[end] === '(') depth += 1;
      else if (src[end] === ')') depth -= 1;
      end += 1;
    }
    const arg = src.slice(start, end - 1).trim();
    let value: number | null = null;
    if (/^\d[\d_]*$/.test(arg)) {
      value = Number(arg.replace(/_/g, ''));
    } else if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
      const decl = new RegExp(`\\bconst\\s+${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?::\\s*number)?\\s*=\\s*(\\d[\\d_]*)\\s*;`).exec(src);
      if (decl) value = Number(decl[1].replace(/_/g, ''));
    }
    if (value !== null && value > MAX_ROWS) {
      found.push({ line: src.slice(0, match.index).split('\n').length, arg, value });
    }
  }
  return found;
}

function queryModules(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...queryModules(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('findOversizedLimits (scanner self-check)', () => {
  it('flags a numeric literal above 1000', () => {
    expect(findOversizedLimits('q.limit(2000);')).toEqual([{ line: 1, arg: '2000', value: 2000 }]);
  });

  it('flags a literal with numeric separators', () => {
    expect(findOversizedLimits('q.limit(1_001);')).toEqual([{ line: 1, arg: '1_001', value: 1001 }]);
  });

  it('flags a same-file constant above 1000', () => {
    const src = 'const CAP = 5000;\nconst rows = q\n  .limit(CAP);';
    expect(findOversizedLimits(src)).toEqual([{ line: 3, arg: 'CAP', value: 5000 }]);
  });

  it('flags a typed constant above 1000', () => {
    expect(findOversizedLimits('const CAP: number = 1500;\nq.limit(CAP);')).toHaveLength(1);
  });

  it('allows exactly 1000, smaller literals, parameters and small constants', () => {
    expect(findOversizedLimits('q.limit(1000);')).toEqual([]);
    expect(findOversizedLimits('q.limit(500);')).toEqual([]);
    expect(findOversizedLimits('function f(limit: number) { return q.limit(limit); }')).toEqual([]);
    expect(findOversizedLimits('const CAP = 200;\nq.limit(CAP + 1);\nq.limit(CAP);')).toEqual([]);
  });

  it('ignores comments that mention an oversized limit', () => {
    expect(findOversizedLimits('// .limit(2000) was the old cap\nq.range(0, 999);')).toEqual([]);
    expect(findOversizedLimits('/** an explicit .limit(5000)\n * is capped too */\nq.range(0, 999);')).toEqual([]);
    expect(findOversizedLimits("const url = 'http://x'; q.limit(2000); // trailing")).toHaveLength(1);
  });
});

describe('query modules never ask for more than max_rows with .limit()', () => {
  const files = queryModules(QUERIES_DIR);
  const seen = new Set<string>();
  const violations: string[] = [];

  for (const file of files) {
    const rel = path.relative(QUERIES_DIR, file).split(path.sep).join('/');
    for (const v of findOversizedLimits(readFileSync(file, 'utf8'))) {
      const key = `${rel}:${v.arg}`;
      seen.add(key);
      if (ALLOWED[key]) continue;
      violations.push(
        `${rel}:${v.line} .limit(${v.arg}) asks for ${v.value} rows but PostgREST returns at most ${MAX_ROWS}; ` +
          'page with readBoundedPages (src/lib/supabase/read-bounded-pages.ts) or readAllPages.',
      );
    }
  }

  it('scans the query modules (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('has no oversized .limit() literal', () => {
    expect(violations).toEqual([]);
  });

  it('keeps no stale allow-list entry', () => {
    const stale = Object.keys(ALLOWED).filter((key) => !seen.has(key));
    expect(stale, 'remove allow-list entries that no longer match an occurrence').toEqual([]);
  });
});
