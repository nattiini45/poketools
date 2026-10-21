/**
 * Namespace constructors (i18n-core §1.3).
 *
 * ```ts
 * // messages/<ns>/de.ts
 * export default defineDe<typeof en>()({ ... });
 * // messages/<ns>/index.ts
 * export const fooMessages = defineNamespace('foo', en, de);
 * ```
 */
import type { CheckDe, DeShape, MessageTree, Namespace } from './types';

/**
 * Type-checks a German dictionary against the English source: a missing key,
 * an extra key, a renamed placeholder or tag, or a string-vs-plural mismatch
 * fails `tsc`. Returns its argument unchanged.
 */
export function defineDe<E>() {
  return <const D extends DeShape<E>>(de: D & CheckDe<E, D>): D => de;
}

export function defineNamespace<E extends MessageTree>(id: string, en: E, de: DeShape<E>): Namespace<E> {
  return Object.freeze({ id, en, de });
}
