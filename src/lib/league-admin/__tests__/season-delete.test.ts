import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEASON_DELETE_BLOCKERS,
  SEASON_DELETE_CASCADES,
  SEASON_DELETE_UNLINKS,
  SEASON_DELETE_UNNAMED_CASCADES,
} from '../season-delete';

/**
 * Keeps `season-delete.ts` equal to the schema: replays every foreign key of the public migrations (in file
 * order: ADD / DROP CONSTRAINT, inline column references, table-level FOREIGN KEY clauses, DROP TABLE) and
 * derives what a `DELETE FROM seasons` cascades to, what blocks it and what it unlinks.
 */

type OnDelete = 'cascade' | 'set null' | 'set default' | 'restrict' | 'no action';
interface ForeignKey {
  child: string;
  parent: string;
  onDelete: OnDelete;
}

const MIGRATIONS = path.resolve(__dirname, '../../../../supabase/migrations');

const IDENT = String.raw`(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?`;
const REFS = new RegExp(String.raw`REFERENCES\s+${IDENT}\s*(?:\([^)]*\))?([^,]*)`, 'i');

function onDeleteOf(tail: string): OnDelete {
  const m = /ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i.exec(tail);
  return m ? (m[1].toLowerCase().replace(/\s+/g, ' ') as OnDelete) : 'no action';
}

/** SQL without comments and without dollar-quoted bodies (functions never declare foreign keys). */
function strip(sql: string): string {
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

function replayForeignKeys(): Map<string, ForeignKey> {
  const fks = new Map<string, ForeignKey>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    for (const raw of strip(readFileSync(path.join(MIGRATIONS, file), 'utf8')).split(';')) {
      const stmt = raw.trim();
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

function effectsOfSeasonDelete() {
  const fks = [...replayForeignKeys().values()];
  const cascaded = new Set<string>();
  const queue = ['seasons'];
  while (queue.length > 0) {
    const parent = queue.shift();
    for (const fk of fks) {
      if (fk.parent !== parent || fk.onDelete !== 'cascade' || fk.child === 'seasons' || cascaded.has(fk.child)) continue;
      cascaded.add(fk.child);
      queue.push(fk.child);
    }
  }
  const direct = fks.filter((fk) => fk.parent === 'seasons');
  return {
    fks,
    cascaded,
    blockers: new Set(direct.filter((fk) => fk.onDelete === 'no action' || fk.onDelete === 'restrict').map((fk) => fk.child)),
    unlinked: new Set(direct.filter((fk) => fk.onDelete === 'set null' || fk.onDelete === 'set default').map((fk) => fk.child)),
  };
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe('season delete effects (from the migrations)', () => {
  const effects = effectsOfSeasonDelete();

  it('the parser sees the known declarations (sanity)', () => {
    expect(effects.fks.find((fk) => fk.child === 'season_participants' && fk.parent === 'seasons')?.onDelete).toBe('cascade');
    expect(effects.fks.find((fk) => fk.child === 'tournaments' && fk.parent === 'seasons')?.onDelete).toBe('no action');
    // A later migration replaced the baseline constraint (DROP + ADD with CASCADE).
    expect(effects.fks.find((fk) => fk.child === 'evo_progress_log' && fk.parent === 'seasons')?.onDelete).toBe('cascade');
    // Reached through another cascaded table, not through seasons directly.
    expect(effects.cascaded.has('redraft_submissions')).toBe(true);
  });

  it('every cascaded table is listed exactly once (named groups + unnamed)', () => {
    const listed = [...Object.values(SEASON_DELETE_CASCADES).flat(), ...SEASON_DELETE_UNNAMED_CASCADES];
    expect(new Set(listed).size).toBe(listed.length);
    expect(sorted(listed)).toEqual(sorted(effects.cascaded));
  });

  it('the blockers are exactly the season keys without a delete action', () => {
    expect(sorted(Object.values(SEASON_DELETE_BLOCKERS).flat())).toEqual(sorted(effects.blockers));
  });

  it('the unlinked tables are exactly the SET NULL season keys', () => {
    expect(sorted(Object.values(SEASON_DELETE_UNLINKS).flat())).toEqual(sorted(effects.unlinked));
  });
});
