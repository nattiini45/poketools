/**
 * Identifier patterns and Map helpers shared by the whole format kit.
 *
 * Every pattern is a literal: no pattern is ever built from input. Lookups by user-chosen key go
 * through `Map` (see `toMap`), never through plain-object indexing, so keys such as `constructor`,
 * `toString` or `hasOwnProperty` are ordinary data. The Key pattern rejects `__proto__` (a leading
 * underscore is not allowed).
 */

/** A stage, edge, rule or metric key: lower-case letter first, then letters, digits, underscore; 1..32 chars. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
/** A reference name inside an expression: a Key, or `Key.Key` (the `item.field` form). */
export const REF_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}(?:\.[a-z][a-z0-9_]{0,31})?$/;
/** A primitive or rule kind such as `rule.custom`: dotted lower-case words, 1..64 chars. */
export const KIND_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
/** A URL slug: lower-case letters, digits and hyphens, 1..63 chars, no leading hyphen. */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** A UUID in any version, lower- or upper-case hex. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Key = string;
export type Slug = string;

export function isKey(s: unknown): s is Key {
  return typeof s === 'string' && KEY_PATTERN.test(s);
}

export function isRefName(s: unknown): s is string {
  return typeof s === 'string' && REF_NAME_PATTERN.test(s);
}

export function isKind(s: unknown): s is string {
  return typeof s === 'string' && KIND_PATTERN.test(s);
}

export function isSlug(s: unknown): s is Slug {
  return typeof s === 'string' && SLUG_PATTERN.test(s);
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_PATTERN.test(s);
}

/**
 * Index `items` by key. The first item wins; every later item with the same key is reported through
 * `onDuplicate` (item and its index) and not stored.
 */
export function toMap<T>(
  items: readonly T[],
  keyOf: (t: T) => string,
  onDuplicate?: (item: T, index: number) => void,
): Map<string, T> {
  const map = new Map<string, T>();
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (map.has(key)) {
      onDuplicate?.(item, index);
      return;
    }
    map.set(key, item);
  });
  return map;
}

/**
 * Own-property test. Uses `hasOwnProperty.call` (not `Object.hasOwn`) so it also runs in older
 * browser targets; it works on objects without a prototype and on an own `__proto__` key.
 */
export function hasOwn(o: object, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, k);
}
