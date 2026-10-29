import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structure rules of the loop and the prompt (plan 3.9 tests 3, 4, 5 and 8; spike S7; public-repo hygiene). They read the
 * source, so a later edit that breaks a rule fails here instead of in review.
 */
const ROOT = path.resolve(__dirname, '..', '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== '__tests__') out.push(...sources(full));
    } else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const loopFiles = sources(path.join(ROOT, 'loop'));
const promptFiles = sources(path.join(ROOT, 'prompts'));
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => readFileSync(file, 'utf8');
/** Source with comments removed, so prose in a header cannot trip a code rule. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('loop/ and prompts/ structure', () => {
  it('finds the files it checks', () => {
    expect(loopFiles.length).toBeGreaterThan(10);
    expect(promptFiles.length).toBeGreaterThan(0);
  });

  it('never touches the database or the admin_agent tables (only store/ does)', () => {
    for (const file of [...loopFiles, ...promptFiles]) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/\.from\(\s*['"`]/);
      expect(text, rel(file)).not.toMatch(/\.rpc\(/);
      // `createHash(...).update(...)` is the crypto API, not a table write.
      expect(text.replace(/create(?:Hash|Hmac)\([^)]*\)\s*\.update\(/g, ''), rel(file)).not.toMatch(/\.(insert|update|upsert|delete)\(/);
      expect(text, rel(file)).not.toMatch(/admin_agent_/);
      expect(text, rel(file)).not.toMatch(/@\/lib\/supabase/);
      expect(text, rel(file)).not.toMatch(/@supabase\//);
    }
  });

  it('reaches the store only through its public pieces, always as types or the pure helpers', () => {
    for (const file of loopFiles) {
      for (const match of read(file).matchAll(/from '(\.\.\/store[^']*)'/g)) {
        expect(['../store/types', '../store/ids', '../store/create', '../store/errors', '../store/conversations', '../store/payload-guard'], `${rel(file)}: ${match[1]}`).toContain(match[1]);
      }
      expect(code(file), rel(file)).not.toMatch(/adminAgentStore/);
    }
  });

  it('imports no route, no executor, no binding and no verified-session override', () => {
    for (const file of loopFiles) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/runAsVerifiedSession|getVerifiedSession|session-override/);
      expect(text, rel(file)).not.toMatch(/@\/app\//);
      expect(text, rel(file)).not.toMatch(/_ops|executor|proposals\//);
      expect(text, rel(file)).not.toMatch(/\bimport\(/);
      // The dispatch types are fine; its runtime is not.
      for (const match of text.matchAll(/^import (?!type)[^;]*from '(\.\.\/dispatch[^']*)'/gm)) throw new Error(`${rel(file)} imports ${match[1]} at runtime`);
    }
  });

  it('is not wired to the client connection (spike S7)', () => {
    for (const file of loopFiles) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/request\.signal|req\.signal|\.signal\b(?!\s*\))/);
      expect(text, rel(file)).not.toMatch(/\bnew AbortController\b/);
    }
    // The only signal is the port's own wall-clock timeout.
    const withSignal = loopFiles.filter((file) => /AbortSignal/.test(code(file))).map(rel);
    expect(withSignal).toEqual(['loop/ai-sdk-port.ts']);
  });

  it('reads no process environment: the AI SDK port takes the key from the single reader, anthropicApiKey()', () => {
    const readers = loopFiles.filter((file) => /process\.env/.test(code(file))).map(rel);
    expect(readers).toEqual([]);
    expect(code(loopFiles.find((file) => rel(file) === 'loop/ai-sdk-port.ts')!)).toMatch(/anthropicApiKey\(\)/);
  });

  it('uses no `any`', () => {
    for (const file of [...loopFiles, ...promptFiles]) {
      expect(code(file), rel(file)).not.toMatch(/:\s*any\b|\bas any\b|<any>/);
    }
  });

  it('names no deployment fact and no private pack in code or comments', () => {
    const banned = [/evoliga/i, /\bplc\b/i, /vercel/i, /\.supabase\.co/i, /format-packs\/private/i, /\.internal\//i, /poketools\.(app|dev|com)/i];
    for (const file of [...loopFiles, ...promptFiles]) {
      const text = read(file);
      for (const pattern of banned) expect(text, `${rel(file)} ${String(pattern)}`).not.toMatch(pattern);
    }
  });

  it('keeps the tool-failure path free of error text: no err.message is put into a result or an event', () => {
    for (const file of loopFiles) {
      const text = code(file);
      expect(text, rel(file)).not.toMatch(/(?:error|err|e)\.message\b[^;]*(?:serialized|failure|emit|content|params)/);
    }
  });
});
