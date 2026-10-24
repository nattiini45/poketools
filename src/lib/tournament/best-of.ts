/**
 * Best-of values a match series can have. Pure and client-safe: the forms
 * (tournament, phase, round, override pickers) and `bestOfSchema` in
 * `src/lib/validation/schemas.ts` share these bounds, so a picker never
 * offers a value the API refuses.
 *
 * A series needs a winner, so only odd lengths are valid (1, 3, ... 15).
 */

export const BEST_OF_MIN = 1;
export const BEST_OF_MAX = 15;

/** Every valid best-of, ascending: the odd numbers from 1 to 15. */
export const BEST_OF_VALUES: readonly number[] = [1, 3, 5, 7, 9, 11, 13, 15];

/** Whether `value` is a valid best-of: an odd integer from 1 to 15. */
export function isValidBestOf(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= BEST_OF_MIN &&
    value <= BEST_OF_MAX &&
    value % 2 === 1
  );
}

/**
 * The validation issues for a best-of update that sets an even value the record does not
 * already hold. An unchanged stored even value (the form sends the whole record back) passes;
 * a new or different one is refused like `bestOfSchema` refuses it. Each issue is `path: message`,
 * the shape `formatZodErrors` produces.
 */
export function newEvenBestOfIssues(
  body: { best_of_default?: number; bo_overrides?: Record<string, number> },
  stored: { best_of_default?: number | null; bo_overrides?: Record<string, number> | null },
): string[] {
  const message = 'best of must be an odd number';
  const issues: string[] = [];
  if (
    body.best_of_default !== undefined &&
    body.best_of_default % 2 === 0 &&
    body.best_of_default !== stored.best_of_default
  ) {
    issues.push(`best_of_default: ${message}`);
  }
  for (const [key, value] of Object.entries(body.bo_overrides ?? {})) {
    if (value % 2 === 0 && value !== stored.bo_overrides?.[key]) {
      issues.push(`bo_overrides.${key}: ${message}`);
    }
  }
  return issues;
}

/**
 * The options a best-of picker offers. A stored legacy value that is not odd
 * (earlier versions accepted any 1..15) is merged in, in sorted position, so
 * a form that edits such a record shows it instead of silently selecting a
 * neighbour. Anything outside 1..15 is not merged.
 */
export function bestOfChoices(current?: number | null): number[] {
  const choices = [...BEST_OF_VALUES];
  if (
    typeof current === 'number' &&
    Number.isInteger(current) &&
    current >= BEST_OF_MIN &&
    current <= BEST_OF_MAX &&
    !choices.includes(current)
  ) {
    choices.push(current);
    choices.sort((a, b) => a - b);
  }
  return choices;
}
