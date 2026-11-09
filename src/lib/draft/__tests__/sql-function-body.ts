/**
 * Static readers of the draft SQL: the latest `CREATE [OR REPLACE] FUNCTION` of a function across
 * `supabase/migrations`, comments stripped. Shared by the SQL parity tests (seat limits, the draft
 * state machines); no database.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

/**
 * Drops SQL comments in one left-to-right scan, so commented-out examples never
 * count: a `--` comment runs to the end of its line (a `/*` inside it opens
 * nothing), `/* ... *\/` blocks nest as in Postgres, and single-quoted strings
 * (with `''` escapes) are copied untouched, so a `--` or `/*` inside one is
 * text. Comments inside dollar-quoted bodies are stripped too: plpgsql uses the
 * same comment syntax, so dollar quotes are scanned like plain SQL.
 */
export function stripComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const eol = sql.indexOf('\n', i);
      i = eol < 0 ? sql.length : eol; // keep the newline itself
    } else if (two === '/*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        const pair = sql.slice(i, i + 2);
        if (pair === '/*') {
          depth++;
          i += 2;
        } else if (pair === '*/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") break;
        else j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
}

/**
 * Any statement that starts a new body: `CREATE [OR REPLACE] FUNCTION | PROCEDURE | TRIGGER`,
 * or an anonymous `DO [LANGUAGE x] $$` block (also ending in `END $$;`), with or without a space
 * before the dollar quote.
 */
const DEFINITION_START = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER)\b|\bDO\b(?:\s+LANGUAGE\s+\w+)?\s*\$\$/;

/**
 * The body of the latest `CREATE [OR REPLACE] FUNCTION public.<name>(` across
 * the migrations (comments stripped), up to its `END $$;`. Fails closed: a
 * missing definition, a terminator spelled otherwise, or another definition
 * or `DO` block starting before the terminator throws instead of reading some
 * other region of the file. Limits of text scanning: DDL inside a string
 * literal (dynamic SQL in a body) reads as a definition, so such a body throws
 * "another definition starts" although it is well-formed; and an unbalanced
 * `'` inside a dollar-quoted string that is not code (e.g. a `COMMENT ... IS
 * $$it's$$`) would make the comment scan treat what follows as a string.
 * None of the draft migrations does either today.
 */
export function functionBodyIn(sources: readonly { file: string; sql: string }[], name: string): string {
  const anchor = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'g');
  let body: string | null = null;
  for (const { file, sql: raw } of sources) {
    // Cheap prefilter: only files that mention the function are stripped and scanned.
    if (!raw.includes(`public.${name}`)) continue;
    const sql = stripComments(raw);
    const definitions = [...sql.matchAll(anchor)];
    if (definitions.length === 0) continue;
    const start = definitions[definitions.length - 1].index ?? 0;
    const rest = sql.slice(start);
    const end = /\bEND\s*\$\$\s*;/.exec(rest);
    if (end === null) throw new Error(`${file}: public.${name} has no \`END $$;\` terminator`);
    body = rest.slice(0, end.index);
    if (DEFINITION_START.test(body.slice(1))) {
      throw new Error(`${file}: another definition starts before public.${name}'s terminator`);
    }
  }
  if (body === null) throw new Error(`no migration defines public.${name}`);
  return body;
}

let migrationSources: { file: string; sql: string }[] | null = null;

/** `functionBodyIn` over `supabase/migrations/*.sql` in file (timestamp) order, read once per run. */
export function latestFunctionBody(name: string): string {
  migrationSources ??= readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS, file), 'utf8') }));
  return functionBodyIn(migrationSources, name);
}
