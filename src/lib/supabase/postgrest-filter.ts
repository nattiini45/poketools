/**
 * Safe building blocks for string-built PostgREST filters.
 *
 * `.eq()`, `.ilike()`, `.in()` and friends send each value as its own query
 * parameter, so PostgREST parses it as a plain value. `.or()` and `.not()`
 * with a logic tree do NOT: postgrest-js appends the string as-is
 * (`or=(<your string>)`) and PostgREST parses it with its logic-tree grammar,
 * where `,` separates conditions, `(`/`)` open and close groups and `.`
 * separates column, operator and value. An unquoted user value can therefore
 * end its condition early and add conditions of its own, run by the
 * service-role client that bypasses RLS.
 *
 * Inside a logic tree PostgREST accepts a double-quoted value; within the
 * quotes `\"` is a literal quote and `\\` a literal backslash, and `,` `(`
 * `)` `.` lose their meaning. Every user value that goes into an `.or()`
 * string goes through `postgrestQuoted`, and a LIKE pattern built from user
 * text escapes its own wildcards first (`escapeLikeTerm`).
 *
 * One PostgREST rule cannot be escaped: in a `like`/`ilike` value, `*` is an
 * alias of `%`. A `*` typed into a search box therefore still matches any
 * run of characters. That only widens the match on the columns the caller
 * named; it cannot add conditions.
 */

const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Escape the LIKE wildcards (`%`, `_`) and the LIKE escape character (`\`) in
 * `term`, so the term matches literally inside a LIKE/ILIKE pattern.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Double-quote `value` for a PostgREST logic tree (`.or()` / `.not()` /
 * `.and()` strings): `"` and `\` are backslash-escaped and the whole value is
 * wrapped in quotes, so no character in it can end the condition.
 */
export function postgrestQuoted(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/**
 * An `.or()` string that matches rows where any of `columns` contains `term`
 * case-insensitively (`col.ilike."%term%"`, joined with commas).
 *
 * Column names come from code, never from a request; a name that is not a
 * plain lower-case identifier throws instead of being dropped.
 */
export function ilikeAnyOf(columns: readonly string[], term: string): string {
  if (columns.length === 0) {
    throw new Error('ilikeAnyOf: at least one column is required');
  }
  const pattern = postgrestQuoted(`%${escapeLikeTerm(term)}%`);
  return columns
    .map((column) => {
      if (!COLUMN_NAME.test(column)) {
        throw new Error(`ilikeAnyOf: invalid column name "${column}"`);
      }
      return `${column}.ilike.${pattern}`;
    })
    .join(',');
}
