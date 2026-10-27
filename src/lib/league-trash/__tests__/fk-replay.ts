/**
 * Replays the SQL of `supabase/migrations/` (in file order) without a database, for tests that guard the schema:
 *
 * - `replayForeignKeys` : every foreign key (ADD / DROP CONSTRAINT, inline column references, table-level FOREIGN KEY
 *   clauses, DROP TABLE) with its ON DELETE action.
 * - `replayTriggers`    : every row trigger with the events it fires on (CREATE TRIGGER / DROP TRIGGER / DROP TABLE).
 * - `lastFunctionBody`  : the `$$` body of the LAST migration that defines a function (the inventory functions of the
 *   league recycle bin are plain `VALUES` lists, parsed from there).
 * - `declaredColumns`   : every table that declares a column of a given name (CREATE TABLE / ADD COLUMN).
 * - `replayInsertRevokes`: the tables whose INSERT a migration revoked from a role and never granted back.
 *
 * Shared by `inventory.test.ts` (league trash) and `season-delete.test.ts`. Not a test file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type OnDelete = 'cascade' | 'set null' | 'set default' | 'restrict' | 'no action';
export interface ForeignKey {
  child: string;
  parent: string;
  onDelete: OnDelete;
}

export interface TriggerDeclaration {
  table: string;
  name: string;
  events: readonly ('INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE')[];
}

export const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations');

const IDENT = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const REFS = new RegExp(String.raw`REFERENCES\s+${IDENT}\s*(?:\([^)]*\))?([^,]*)`, 'i');

function onDeleteOf(tail: string): OnDelete {
  const m = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(tail);
  return m ? (m[1].toLowerCase().replace(/\s+/g, ' ') as OnDelete) : 'no action';
}

/** SQL without comments and without dollar-quoted bodies (functions never declare foreign keys or triggers). */
export function strip(sql: string): string {
  return sql
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, ' ')
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Splits a parenthesised body at top-level commas. */
function topLevelItems(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function statementsOf(file: string): string[] {
  return strip(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    .split(';')
    .map((s) => s.trim());
}

export function replayForeignKeys(): Map<string, ForeignKey> {
  const fks = new Map<string, ForeignKey>();
  for (const file of migrationFiles()) {
    for (const stmt of statementsOf(file)) {
      const create = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*\(([\s\S]*)\)\s*$`, 'i').exec(stmt);
      if (create) {
        const table = create[1];
        for (const item of topLevelItems(create[2])) {
          const refs = REFS.exec(item);
          if (!refs) continue;
          const named = /^CONSTRAINT\s+"?([a-z0-9_]+)"?\s+FOREIGN\s+KEY/i.exec(item);
          const tableLevel = /^FOREIGN\s+KEY\s*\(\s*"?([a-z0-9_]+)"?/i.exec(item);
          const column = /^"?([a-z0-9_]+)"?\s/i.exec(item);
          const name = named?.[1] ?? `${table}_${tableLevel?.[1] ?? column?.[1]}_fkey`;
          fks.set(name, { child: table, parent: refs[1], onDelete: onDeleteOf(refs[2]) });
        }
        continue;
      }
      const drop = new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENT}`, 'i').exec(stmt);
      if (drop) {
        for (const [name, fk] of fks) if (fk.child === drop[1]) fks.delete(name);
        continue;
      }
      const alter = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?${IDENT}([\s\S]*)$`, 'i').exec(stmt);
      if (!alter) continue;
      const table = alter[1];
      for (const action of topLevelItems(alter[2])) {
        const dropped = /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?/i.exec(action);
        if (dropped) {
          fks.delete(dropped[1]);
          continue;
        }
        const refs = REFS.exec(action);
        if (!refs) continue;
        const named = /^ADD\s+CONSTRAINT\s+"?([a-z0-9_]+)"?\s+FOREIGN\s+KEY/i.exec(action);
        const column = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/i.exec(action);
        if (!named && !column) continue;
        const name = named?.[1] ?? `${table}_${column?.[1]}_fkey`;
        fks.set(name, { child: table, parent: refs[1], onDelete: onDeleteOf(refs[2]) });
      }
    }
  }
  return fks;
}

const TRIGGER = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+"?([a-z0-9_]+)"?\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+([\s\S]*?)\s+ON\s+${IDENT}(?:\s|$)`,
  'i',
);

/** The triggers the migrations leave behind, keyed `table.name`. */
export function replayTriggers(): Map<string, TriggerDeclaration> {
  const triggers = new Map<string, TriggerDeclaration>();
  for (const file of migrationFiles()) {
    for (const stmt of statementsOf(file)) {
      const create = TRIGGER.exec(stmt);
      if (create) {
        const events = (['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] as const).filter((e) =>
          new RegExp(String.raw`\b${e}\b`, 'i').test(create[2]),
        );
        triggers.set(`${create[3]}.${create[1]}`, { table: create[3], name: create[1], events });
        continue;
      }
      const dropTrigger = new RegExp(String.raw`^DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?([a-z0-9_]+)"?\s+ON\s+${IDENT}`, 'i').exec(stmt);
      if (dropTrigger) {
        triggers.delete(`${dropTrigger[2]}.${dropTrigger[1]}`);
        continue;
      }
      const dropTable = new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENT}`, 'i').exec(stmt);
      if (dropTable) {
        for (const [key, trigger] of triggers) if (trigger.table === dropTable[1]) triggers.delete(key);
      }
    }
  }
  return triggers;
}

/** The `$$ ... $$` body of the last migration that defines `public.<name>(...)`; throws when none does. */
export function lastFunctionBody(name: string): string {
  const pattern = new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${name}\s*\([^)]*\)[\s\S]*?AS\s+\$\$([\s\S]*?)\$\$`, 'i');
  let body: string | null = null;
  for (const file of migrationFiles()) {
    const match = pattern.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'));
    if (match) body = match[1];
  }
  if (body === null) throw new Error(`no migration defines public.${name}`);
  return body;
}

/** Tables whose CREATE TABLE or ADD COLUMN declares a column with a name matching `columnName` (dropped tables excluded). */
export function declaredColumns(columnName: RegExp): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    if (!columnName.test(column)) return;
    const set = found.get(table) ?? new Set<string>();
    set.add(column);
    found.set(table, set);
  };
  for (const file of migrationFiles()) {
    for (const stmt of statementsOf(file)) {
      const create = new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${IDENT}\s*\(([\s\S]*)\)\s*$`, 'i').exec(stmt);
      if (create) {
        for (const item of topLevelItems(create[2])) {
          const column = /^"?([a-z0-9_]+)"?\s/i.exec(item);
          if (column && !/^(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|LIKE)$/i.test(column[1])) add(create[1], column[1]);
        }
        continue;
      }
      const drop = new RegExp(String.raw`^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?${IDENT}`, 'i').exec(stmt);
      if (drop) {
        found.delete(drop[1]);
        continue;
      }
      const alter = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?${IDENT}([\s\S]*)$`, 'i').exec(stmt);
      if (!alter) continue;
      for (const action of topLevelItems(alter[2])) {
        const column = /^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_]+)"?/i.exec(action);
        if (column) add(alter[1], column[1]);
      }
    }
  }
  return found;
}

const GRANT_STATEMENT = /^(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+(?:TABLE\s+)?([\s\S]+?)\s+(?:TO|FROM)\s+([\s\S]+)$/i;

/** Tables whose INSERT was revoked from `role` (REVOKE INSERT / ALL ... FROM role) and not granted back since. */
export function replayInsertRevokes(role: string): Set<string> {
  const revoked = new Set<string>();
  for (const file of migrationFiles()) {
    for (const stmt of statementsOf(file)) {
      const match = GRANT_STATEMENT.exec(stmt);
      if (!match) continue;
      const [, verb, privileges, target, grantees] = match;
      if (/^(?:FUNCTION|SEQUENCE|SCHEMA|ALL|DATABASE|DOMAIN|TYPE)\b/i.test(target)) continue;
      if (!/\b(?:INSERT|ALL)\b/i.test(privileges)) continue;
      if (!grantees.split(',').some((g) => g.trim().replace(/"/g, '').toLowerCase() === role)) continue;
      for (const raw of target.split(',')) {
        const table = raw.trim().replace(/"/g, '').replace(/^public\./, '');
        if (!/^[a-z_][a-z0-9_]*$/.test(table)) continue;
        if (verb.toUpperCase() === 'REVOKE') revoked.add(table);
        else revoked.delete(table);
      }
    }
  }
  return revoked;
}
