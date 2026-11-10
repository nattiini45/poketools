/**
 * The seat limits the admin league page gates the EPB create on
 * (`DRAFT_CONFIG_LIMITS.participant_order`) must stay the SQL's own limits:
 * `draft__validate_seats` refuses more than `max` seats at create, and
 * `draft_start` refuses fewer than `min`. Both are literals in SQL, so this
 * reads the latest migration that defines each function and compares. If the
 * SQL moves alone, the page would let a create through that the RPC refuses
 * with SEATS_INVALID (or block one it would take).
 */
import { describe, expect, it } from 'vitest';
import { DRAFT_CONFIG_LIMITS } from '../schemas';
import { functionBodyIn, latestFunctionBody, stripComments } from './sql-function-body';

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
