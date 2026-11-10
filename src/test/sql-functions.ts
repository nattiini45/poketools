import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { MachineSpec } from '@/lib/state-machine/machine';

/**
 * Test helper for SQL-owned state machines (ADR 0004): reads the last `CREATE OR REPLACE FUNCTION public.<name>` in
 * `supabase/migrations` (the definition that wins on replay) so a parity test can hold its guards against the TS
 * definition that names it as a writer (`path#function`). No database.
 */
const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

let migrationCache: readonly (readonly [string, string])[] | null = null;
const migrations = () =>
  (migrationCache ??= readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => [f, readFileSync(path.join(MIGRATIONS, f), 'utf8')] as const));

export interface SqlFunctionDefinition {
  /** Repo-relative path of the migration holding the last definition. */
  readonly file: string;
  /** The `$$ ... $$` body, line comments removed and whitespace collapsed to single spaces. */
  readonly body: string;
}

export function lastSqlFunction(name: string): SqlFunctionDefinition {
  const pattern = new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?${name}"?\s*\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$`,
    'gi',
  );
  let found: SqlFunctionDefinition | null = null;
  for (const [file, text] of migrations()) {
    for (const match of text.matchAll(pattern)) {
      found = {
        file: `supabase/migrations/${file}`,
        body: match[1]
          .split('\n')
          .map((line) => line.replace(/--.*$/, ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      };
    }
  }
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}

/** Names of every function a migration defines in schema public, each with its last definition. */
export function allSqlFunctions(): Map<string, SqlFunctionDefinition> {
  const names = new Set<string>();
  for (const [, text] of migrations()) {
    for (const m of text.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\(/gi)) names.add(m[1]);
  }
  return new Map([...names].sort().map((name) => [name, lastSqlFunction(name)]));
}

/** Every SQL writer (`path#function`) a machine names, with the transitions that name it. */
export function sqlWriters(spec: MachineSpec<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of spec.transitions) {
    for (const writer of t.writers) {
      if (!writer.includes('#')) continue;
      out.set(writer, [...(out.get(writer) ?? []), t.event]);
    }
  }
  return out;
}

/** `'a', 'b'` as SQL lists it in `status IN (...)`. */
export const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(', ');
