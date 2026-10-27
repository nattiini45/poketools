/**
 * `plans/` is pure code (plan 3.2): no database, no route or page imports, no Next request context, no server-only
 * marker (the Plan panel imports its types and `planReadiness`). Persistence reaches it by injection through `store/`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname, '..');
const sources = readdirSync(dir)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') }));

const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'/g)].map((match) => match[1]);

describe('plans/ stays pure', () => {
  it('has source files to check', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('imports no database client, route, page, component or Next module', () => {
    for (const { name, text } of sources) {
      for (const specifier of importsOf(text)) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/supabase|^next(\/|$)|^server-only$|^@\/app\/|^@\/components\/|^@\/auth$/);
      }
    }
  });

  it('never touches an admin_agent table or the Supabase client', () => {
    for (const { name, text } of sources) {
      expect(text, name).not.toMatch(/\.from\(\s*['"`]admin_agent_/);
      expect(text, name).not.toMatch(/\.(insert|upsert|rpc)\(/);
    }
  });

  it('imports nothing from the other admin-agent modules (they inject, plans/ is the leaf)', () => {
    for (const { name, text } of sources) {
      for (const specifier of importsOf(text)) {
        expect(specifier, `${name} imports ${specifier}`).not.toMatch(/admin-agent\/(?!plans)|^\.\.\//);
      }
    }
  });
});
