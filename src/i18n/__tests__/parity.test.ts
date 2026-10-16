import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MessageTree, Namespace } from '../types';

/**
 * Runtime parity of every namespace (i18n-core §8.1). Redundant with `tsc`
 * (`defineDe`), but it catches `as` casts. Namespaces are discovered on disk
 * (`messages/**\/index.ts`); there is no registry.
 */

const MESSAGES_DIR = path.resolve(__dirname, '../messages');
const KEY = /^[A-Za-z0-9_]+$/;
const PLURAL_KEYS = new Set(['zero', 'one', 'other']);

function findIndexFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findIndexFiles(full));
    else if (entry.name === 'index.ts') out.push(full);
  }
  return out;
}

function isNamespace(v: unknown): v is Namespace<MessageTree> {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).en === 'object' &&
    typeof (v as Record<string, unknown>).de === 'object'
  );
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPlural = (v: unknown): v is Record<string, string> =>
  isObject(v) && typeof v.one === 'string' && typeof v.other === 'string' && Object.keys(v).every((k) => PLURAL_KEYS.has(k));

const placeholders = (s: string) => [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) =>
  [...s.matchAll(/<([A-Za-z0-9_]+)>/g)].map((m) => m[1]).sort();
/** Text left after removing placeholders and paired tags must not hold `{ } < >`. */
function strayBraces(s: string): boolean {
  const stripped = s.replace(/\{[A-Za-z0-9_]+\}/g, '').replace(/<\/?[A-Za-z0-9_]+>/g, '');
  return /[{}<>]/.test(stripped);
}

function compare(id: string, en: unknown, de: unknown, at: string, problems: string[]): void {
  if (typeof en === 'string') {
    if (typeof de !== 'string') return void problems.push(`${id}:${at} de is not a string`);
    if (en === '' || de === '') problems.push(`${id}:${at} empty string`);
    if (placeholders(en).join() !== placeholders(de).join()) problems.push(`${id}:${at} placeholders differ`);
    if (tags(en).join() !== tags(de).join()) problems.push(`${id}:${at} tags differ`);
    if (strayBraces(en) || strayBraces(de)) problems.push(`${id}:${at} literal {}<> outside placeholders/tags`);
    return;
  }
  if (isPlural(en)) {
    if (!isPlural(de)) return void problems.push(`${id}:${at} de is not a plural object`);
    const allowed = new Set([...placeholders(en.one), ...placeholders(en.other), 'count']);
    for (const form of Object.keys(de)) {
      const text = de[form];
      if (text === '') problems.push(`${id}:${at}.${form} empty string`);
      for (const p of placeholders(text)) if (!allowed.has(p)) problems.push(`${id}:${at}.${form} unknown placeholder ${p}`);
      if (strayBraces(text)) problems.push(`${id}:${at}.${form} literal {}<>`);
    }
    for (const form of Object.keys(en)) {
      if (en[form] === '') problems.push(`${id}:${at}.${form} empty string (en)`);
      if (strayBraces(en[form])) problems.push(`${id}:${at}.${form} literal {}<> (en)`);
    }
    return;
  }
  if (!isObject(en)) return void problems.push(`${id}:${at} en is neither a string, plural nor group`);
  if (!isObject(de) || isPlural(de)) return void problems.push(`${id}:${at} de is not a group`);
  const enKeys = Object.keys(en).sort();
  const deKeys = Object.keys(de).sort();
  if (enKeys.join() !== deKeys.join()) problems.push(`${id}:${at || '<root>'} key sets differ`);
  for (const key of enKeys) {
    if (!KEY.test(key)) problems.push(`${id}:${at} bad key "${key}"`);
    if (at !== '' && PLURAL_KEYS.has(key)) problems.push(`${id}:${at} group uses reserved key "${key}"`);
    if (at === '' && PLURAL_KEYS.has(key)) problems.push(`${id}: root uses reserved key "${key}"`);
    compare(id, en[key], de[key], at ? `${at}.${key}` : key, problems);
  }
}

describe('namespace parity', async () => {
  const files = findIndexFiles(MESSAGES_DIR);
  const loaded: { file: string; ns: Namespace<MessageTree> }[] = [];
  for (const file of files) {
    const mod: Record<string, unknown> = await import(/* @vite-ignore */ file);
    const namespaces = Object.values(mod).filter(isNamespace);
    for (const ns of namespaces) loaded.push({ file, ns });
  }

  it('discovers the namespaces, one per index.ts', () => {
    expect(files.length).toBeGreaterThanOrEqual(70);
    expect(loaded.length).toBe(files.length);
  });

  it('every id equals its directory path and no id is duplicated', () => {
    const ids = new Set<string>();
    for (const { file, ns } of loaded) {
      const dir = path.relative(MESSAGES_DIR, path.dirname(file)).split(path.sep).join('/');
      expect(ns.id, file).toBe(dir);
      expect(ids.has(ns.id), `duplicate id ${ns.id}`).toBe(false);
      ids.add(ns.id);
    }
  });

  it('en and de agree on keys, placeholders, tags and plural forms', () => {
    const problems: string[] = [];
    for (const { ns } of loaded) compare(ns.id, ns.en, ns.de, '', problems);
    expect(problems).toEqual([]);
  });
});
