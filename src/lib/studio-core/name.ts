/**
 * The rule for the name of a new definition: 1 to 120 characters after trimming, no NUL and no UTF-16 surrogate half
 * without its partner. The one copy of the rule: the browser checks it with `nameProblem`, and the API builds
 * `definitionNameSchema` from `DEFINITION_NAME_MAX` and `isStorableName`. Pure and client-safe.
 */

import { isStorableText } from './keys';

export const DEFINITION_NAME_MAX = 120;

/** Whether `name` holds only characters that can be stored (no NUL, no lone surrogate half): the shared text rule. */
export const isStorableName: (name: string) => boolean = isStorableText;

export type NameProblem = 'required' | 'invalid' | null;

export function nameProblem(raw: string): NameProblem {
  const name = raw.trim();
  if (name === '') return 'required';
  if (name.length > DEFINITION_NAME_MAX || !isStorableName(name)) return 'invalid';
  return null;
}
