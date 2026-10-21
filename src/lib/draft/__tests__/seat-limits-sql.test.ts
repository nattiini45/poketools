/**
 * The seat limits the admin league page gates the EPB create on
 * (`DRAFT_CONFIG_LIMITS.participant_order`) must stay the SQL's own limits:
 * `draft__validate_seats` refuses more than `max` seats at create, and
 * `draft_start` refuses fewer than `min`. Both are literals in SQL, so this
 * reads the latest migration that defines each function and compares. If the
 * SQL moves alone, the page would let a create through that the RPC refuses
 * with SEATS_INVALID (or block one it would take).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRAFT_CONFIG_LIMITS } from '../schemas';

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations');

/**
 * Drops SQL comments in one left-to-right scan, so commented-out examples never
 * count: a `--` comment runs to the end of its line (a `/*` inside it opens
 * nothing), `/* ... *\/` blocks nest as in Postgres, and single-quoted strings
 * (with `''` escapes) are copied untouched, so a `--` or `/*` inside one is
 * text. Comments inside dollar-quoted bodies are stripped too: plpgsql uses the
 * same comment syntax, so dollar quotes are scanned like plain SQL.
 */
function stripComments(sql: string): string {
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
function functionBodyIn(sources: readonly { file: string; sql: string }[], name: string): string {
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
function latestFunctionBody(name: string): string {
  migrationSources ??= readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(path.join(MIGRATIONS, file), 'utf8') }));
  return functionBodyIn(migrationSources, name);
}

/** The single integer `pattern` captures in `body`. */
function bound(body: string, pattern: RegExp): number {
  const matches = [...body.matchAll(pattern)];
  expect(matches, `exactly one match of ${pattern}`).toHaveLength(1);
  return Number(matches[0][1]);
}

describe('draft seat limits: TypeScript and SQL agree', () => {
  it('draft__validate_seats refuses more seats than participant_order.max', () => {
    const max = bound(latestFunctionBody('draft__validate_seats'), /v_n > (\d+)/g);
    expect(max).toBe(DRAFT_CONFIG_LIMITS.participant_order.max);
  });

  it('draft_start refuses fewer seats than participant_order.min', () => {
    const min = bound(latestFunctionBody('draft_start'), /IF v_n < (\d+) THEN RAISE EXCEPTION 'SEATS_INVALID'/g);
    expect(min).toBe(DRAFT_CONFIG_LIMITS.participant_order.min);
  });

  it('draft__validate_seats needs at least one seat at create', () => {
    expect(bound(latestFunctionBody('draft__validate_seats'), /jsonb_array_length\(p_seats\) < (\d+)/g)).toBe(1);
  });
});

describe('functionBodyIn (the lookup fails closed)', () => {
  const def = (n: number) =>
    `CREATE OR REPLACE FUNCTION public.f(p int) RETURNS int LANGUAGE plpgsql AS $$\nBEGIN\n  IF v_n > ${n} THEN RAISE; END IF;\nEND $$;\n`;

  it('takes the latest definition across files', () => {
    const body = functionBodyIn([{ file: 'a.sql', sql: def(32) }, { file: 'b.sql', sql: def(40) }], 'f');
    expect(body).toContain('v_n > 40');
  });

  it('ignores one-line GRANT/DROP statements and commented-out copies after the definition', () => {
    const later = [
      'GRANT EXECUTE ON FUNCTION public.f(int) TO service_role;',
      'DROP FUNCTION IF EXISTS public.f(int, int);',
      '-- CREATE OR REPLACE FUNCTION public.f(p int) ... IF v_n > 99 ... END $$;',
    ].join('\n');
    const body = functionBodyIn([{ file: 'a.sql', sql: def(32) }, { file: 'b.sql', sql: later }], 'f');
    expect(body).toContain('v_n > 32');
    expect(body).not.toContain('99');
  });

  it('throws when the terminator is spelled otherwise', () => {
    // Replacer functions: in a replacement string `$$` would collapse to `$`.
    const sql = def(32).replace('END $$;', () => 'END;\n$$;');
    expect(sql).toContain('END;\n$$;');
    expect(() => functionBodyIn([{ file: 'a.sql', sql }], 'f')).toThrow(/no `END \$\$;` terminator/);
  });

  it.each([
    ['CREATE OR REPLACE FUNCTION', (s: string) => s],
    ['a plain CREATE FUNCTION', (s: string) => s.replace('CREATE OR REPLACE FUNCTION', () => 'CREATE FUNCTION')],
    ['CREATE OR REPLACE PROCEDURE', (s: string) => s.replace('FUNCTION', () => 'PROCEDURE')],
    // The trigger has no body of its own: the `END $$;` after it is the first terminator f's lookup meets.
    ['CREATE TRIGGER', () => 'CREATE TRIGGER t AFTER INSERT ON x FOR EACH ROW EXECUTE FUNCTION g();\nEND $$;\n'],
  ])('throws when %s starts before the terminator', (_label, next) => {
    const sql = def(32).replace('END $$;', () => '') + next(def(50).replace('public.f(', () => 'public.g('));
    expect(() => functionBodyIn([{ file: 'a.sql', sql }], 'f')).toThrow(/another definition starts/);
  });

  it.each([
    ['DO $$', 'DO $$\nBEGIN\n  PERFORM 1;\nEND $$;\n'],
    ['DO$$', 'DO$$\nBEGIN\n  PERFORM 1;\nEND$$;\n'],
    ['DO LANGUAGE plpgsql $$', 'DO LANGUAGE plpgsql $$\nBEGIN\n  PERFORM 1;\nEND $$;\n'],
    ['DO LANGUAGE plpgsql$$', 'DO LANGUAGE plpgsql$$\nBEGIN\n  PERFORM 1;\nEND$$;\n'],
  ])('throws when a %s block starts before the terminator', (_label, block) => {
    const sql = def(32).replace('END $$;', () => 'END;\n$$;') + block;
    expect(() => functionBodyIn([{ file: 'a.sql', sql }], 'f')).toThrow(/another definition starts/);
  });

  it('does not take `ON CONFLICT ... DO NOTHING` for a DO block', () => {
    const sql = def(32).replace('BEGIN', () => 'BEGIN\n  INSERT INTO t VALUES (1) ON CONFLICT DO NOTHING;');
    expect(functionBodyIn([{ file: 'a.sql', sql }], 'f')).toContain('v_n > 32');
  });

  it('ignores DDL inside a block comment in the body', () => {
    const sql = def(32).replace('BEGIN', () => 'BEGIN\n  /* was: CREATE OR REPLACE FUNCTION public.g() ... */');
    expect(functionBodyIn([{ file: 'a.sql', sql }], 'f')).toContain('v_n > 32');
  });

  it('a plain CREATE FUNCTION counts as a definition', () => {
    const sql = def(40).replace('CREATE OR REPLACE FUNCTION', () => 'CREATE FUNCTION');
    expect(functionBodyIn([{ file: 'a.sql', sql: def(32) }, { file: 'b.sql', sql }], 'f')).toContain('v_n > 40');
  });

  it('throws when no migration defines the function', () => {
    expect(() => functionBodyIn([{ file: 'a.sql', sql: def(32) }], 'g')).toThrow(/no migration defines public\.g/);
  });
});

describe('stripComments', () => {
  it('drops line and block comments, keeping the newline of a line comment', () => {
    expect(stripComments('a -- note\nb /* gone */ c')).toBe('a \nb  c');
  });

  it('a `/*` inside a line comment opens nothing', () => {
    const sql = '-- we used to /* ...\nCREATE OR REPLACE FUNCTION public.f(\n/* real */ x';
    expect(stripComments(sql)).toBe('\nCREATE OR REPLACE FUNCTION public.f(\n x');
  });

  it('nests block comments as Postgres does', () => {
    expect(stripComments('a /* outer /* inner */ still outer */ b')).toBe('a  b');
  });

  it('keeps `--` and `/*` inside single-quoted strings, with `\'\'` escapes', () => {
    const sql = "SELECT '-- not a comment', 'it''s /* text */' -- gone\n";
    expect(stripComments(sql)).toBe("SELECT '-- not a comment', 'it''s /* text */' \n");
  });

  it('a migration-shaped line with a quoted error code loses only its trailing comment', () => {
    expect(stripComments("IF x THEN RAISE EXCEPTION 'SEATS_INVALID'; END IF; -- why\n")).toBe(
      "IF x THEN RAISE EXCEPTION 'SEATS_INVALID'; END IF; \n",
    );
  });
});
