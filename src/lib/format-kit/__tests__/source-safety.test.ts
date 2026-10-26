import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source scan of the whole kit. The kit evaluates stored, user-authored expressions and documents, so its
 * source must not contain a way to run text as code, read a clock or a random source, compile a pattern from
 * input, touch the network, or read the environment. It also keeps `any` and open-ended records out.
 *
 * The patterns are assembled from pieces so this file does not trip its own scan (it is excluded by name too).
 */

interface Rule {
  id: string;
  pattern: RegExp;
  /** Only files whose path (with `/`) matches this apply the rule. */
  only?: RegExp;
}

const word = (s: string) => `\\b${s}`;
const call = (s: string) => new RegExp(`${word(s)}\\s*\\(`);

export const RULES: readonly Rule[] = [
  { id: 'eval call', pattern: call('ev' + 'al') },
  { id: 'Function call', pattern: call('Func' + 'tion') },
  { id: 'new Function', pattern: new RegExp(`${word('new')}\\s+Func${'tion'}${'\\b'}`) },
  { id: 'new RegExp', pattern: new RegExp(`${word('new')}\\s+Reg${'Exp'}\\s*\\(`) },
  { id: 'RegExp call', pattern: call('Reg' + 'Exp') },
  { id: 'Math.random', pattern: new RegExp(`${word('Math')}\\.ran${'dom'}${'\\b'}`) },
  { id: 'Date.now', pattern: new RegExp(`${word('Date')}\\.n${'ow'}${'\\b'}`) },
  { id: 'new Date', pattern: new RegExp(`${word('new')}\\s+Da${'te'}${'\\b'}`) },
  { id: 'performance.now', pattern: new RegExp(`${word('performance')}\\.n${'ow'}${'\\b'}`) },
  { id: 'setTimeout', pattern: new RegExp(`${word('set')}Time${'out'}${'\\b'}`) },
  { id: 'fetch call', pattern: call('fe' + 'tch') },
  { id: 'process.env', pattern: new RegExp(`${word('process')}\\.e${'nv'}${'\\b'}`) },
  { id: 'z.record in schema', pattern: new RegExp(`${word('z')}\\.rec${'ord'}${'\\b'}`), only: /(^|\/)schema(\/|\.ts$)/ },
  { id: 'z.any in schema', pattern: new RegExp(`${word('z')}\\.a${'ny'}${'\\b'}`), only: /(^|\/)schema(\/|\.ts$)/ },
  { id: 'as any', pattern: new RegExp(`${word('as')}\\s+a${'ny'}${'\\b'}`) },
  { id: 'any annotation', pattern: new RegExp(`:\\s*a${'ny'}${'\\b'}`) },
];

/** The rules a source text breaks, as `id` strings. Comments are scanned too: say "no eval", never write a call. */
export function scanSource(text: string, relPath: string): string[] {
  const normalized = relPath.split(path.sep).join('/');
  return RULES.filter((rule) => (rule.only ? rule.only.test(normalized) : true))
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.id);
}

const KIT = path.resolve(__dirname, '..');
const SELF = path.resolve(__filename);

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('scanner', () => {
  const hostile = [
    'const a = ev' + 'al("1");',
    'const f = new Func' + 'tion("return 1");',
    'const r = new Reg' + 'Exp(input);',
    'const x = Math.ran' + 'dom();',
    'const t = Date.n' + 'ow();',
    'const d = new Da' + 'te();',
    'setTime' + 'out(run, 1);',
    'await fe' + 'tch(url);',
    'const e = process.e' + 'nv.KEY;',
    'const v = value as a' + 'ny;',
    'function g(v: a' + 'ny) {}',
  ].join('\n');
  const schemaHostile = 'const s = z.rec' + 'ord(z.string(), z.a' + 'ny());';
  const clean = [
    '// no eval, no clock, no random source',
    'const reviver = (key: string, value: unknown) => value;',
    'const stamp = "Date"; const fn = "Function";',
    'const result: unknown = JSON.parse(text);',
    'export const anyOf = (items: string[]) => items.some(Boolean);',
  ].join('\n');

  it('flags a hostile sample for every rule', () => {
    const found = scanSource(hostile, 'expr/x.ts');
    for (const id of ['eval call', 'Function call', 'new Function', 'new RegExp', 'RegExp call', 'Math.random', 'Date.now', 'new Date', 'setTimeout', 'fetch call', 'process.env', 'as any', 'any annotation']) {
      expect(found, id).toContain(id);
    }
  });

  it('applies the schema rules to schema files only', () => {
    expect(scanSource(schemaHostile, 'schema/document.ts')).toEqual(expect.arrayContaining(['z.record in schema', 'z.any in schema']));
    expect(scanSource(schemaHostile, 'expr/schema.ts')).toEqual(expect.arrayContaining(['z.record in schema']));
    expect(scanSource(schemaHostile, 'engine/core.ts')).toEqual([]);
  });

  it('passes a clean sample', () => {
    expect(scanSource(clean, 'expr/x.ts')).toEqual([]);
  });

  it('tolerates Windows line endings', () => {
    expect(scanSource(hostile.replace(/\n/g, '\r\n'), 'expr/x.ts')).toContain('eval call');
    expect(scanSource(clean.replace(/\n/g, '\r\n'), 'expr/x.ts')).toEqual([]);
  });
});

describe('kit source', () => {
  const files = listTs(KIT).filter((f) => path.resolve(f) !== SELF);

  it('scans a real tree', () => {
    expect(files.length).toBeGreaterThan(60);
    expect(files.some((f) => f.endsWith(`${path.sep}expr${path.sep}eval.ts`))).toBe(true);
  });

  it('contains none of the banned constructs', () => {
    const offenders = files.flatMap((file) => {
      const hits = scanSource(fs.readFileSync(file, 'utf8'), path.relative(KIT, file));
      return hits.map((id) => `${path.relative(KIT, file).split(path.sep).join('/')}: ${id}`);
    });
    expect(offenders).toEqual([]);
  });
});
