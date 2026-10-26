/**
 * The name of a new definition, checked in the browser with the rules the API applies (`definitionNameSchema`): 1 to 120
 * characters after trimming, no NUL and no UTF-16 surrogate half without its partner. Pure and client-safe.
 */

export const DEFINITION_NAME_MAX = 120;

// NUL, and a surrogate half that has no partner: neither belongs in a name.
const NAME_FORBIDDEN = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type NameProblem = 'required' | 'invalid' | null;

export function nameProblem(raw: string): NameProblem {
  const name = raw.trim();
  if (name === '') return 'required';
  if (name.length > DEFINITION_NAME_MAX || NAME_FORBIDDEN.test(name)) return 'invalid';
  return null;
}
