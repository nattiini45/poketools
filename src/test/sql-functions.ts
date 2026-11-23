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

/** One replay pass: CREATE registers the latest definition, ALTER ... RENAME carries it to the new name. */
const FUNCTION_EVENT = new RegExp(
  String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\([\s\S]*?AS\s+\$\$([\s\S]*?)\$\$` +
    String.raw`|ALTER\s+FUNCTION\s+"?public"?\."?([a-z0-9_]+)"?\s*\([^)]*\)\s+RENAME\s+TO\s+([a-z0-9_]+)`,
  'gi',
);

let definitionsCache: Map<string, SqlFunctionDefinition> | null = null;
const definitions = () =>
  (definitionsCache ??= (() => {
    const defs = new Map<string, SqlFunctionDefinition>();
    for (const [file, text] of migrations()) {
      for (const m of text.matchAll(FUNCTION_EVENT)) {
        if (m[3] !== undefined) {
          const def = defs.get(m[3]);
          if (def) {
            defs.delete(m[3]);
            defs.set(m[4], def);
          }
          continue;
        }
        defs.set(m[1], {
          file: `supabase/migrations/${file}`,
          body: m[2]
            .split('\n')
            .map((line) => line.replace(/--.*$/, ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim(),
        });
      }
    }
    return defs;
  })());

export function lastSqlFunction(name: string): SqlFunctionDefinition {
  const found = definitions().get(name);
  if (!found) throw new Error(`no migration defines public.${name}`);
  return found;
}

/** Names of every function a migration defines in schema public, each with its last definition. */
export function allSqlFunctions(): Map<string, SqlFunctionDefinition> {
  return new Map([...definitions().keys()].sort().map((name) => [name, definitions().get(name)!]));
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
