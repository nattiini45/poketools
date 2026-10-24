/**
 * The Spec DSL: a plain-data description of a JSON shape. The browser validator interprets it
 * (`validate-spec.ts`) and the Studio forms will render from it; the server uses zod schemas that
 * describe the same shapes (`schema/`), and a fuzz parity test keeps the two in step.
 *
 * Only named string patterns exist; a pattern string coming from input is never compiled.
 * Zero zod, no server-only import.
 */
import { KEY_PATTERN, KIND_PATTERN, SLUG_PATTERN, UUID_PATTERN } from '../keys';
import type { JsonValue } from '../json';
import type { ExprType } from '../expr/ast';

export type JsonDefault = JsonValue;

/** `text` is any string without NUL (U+0000), which Postgres jsonb cannot store. */
export type StrPattern = 'key' | 'slug' | 'uuid' | 'kind' | 'text';

export const TEXT_PATTERN = /^[^\u0000]*$/;

const PATTERNS: ReadonlyMap<StrPattern, RegExp> = new Map<StrPattern, RegExp>([
  ['key', KEY_PATTERN],
  ['slug', SLUG_PATTERN],
  ['uuid', UUID_PATTERN],
  ['kind', KIND_PATTERN],
  ['text', TEXT_PATTERN],
]);

/** The literal RegExp of a named pattern. */
export function patternRegex(name: StrPattern): RegExp {
  const regex = PATTERNS.get(name);
  if (!regex) throw new Error(`unknown string pattern ${String(name)}`);
  return regex;
}

/** A string with no length ceiling of its own (the pattern bounds it). */
export const NO_MAX = Number.MAX_SAFE_INTEGER;
/** Number bounds that never trigger for a finite JSON number. */
export const NUM_MIN = -Number.MAX_VALUE;
export const NUM_MAX = Number.MAX_VALUE;

export interface FieldSpec {
  name: string;
  spec: Spec;
  /** Absent allowed, absent in the output. */
  optional?: true;
  /** Absent allowed, the (deep-cloned) default is in the output. */
  default?: JsonDefault;
}

export interface UnionVariant {
  tag: string;
  spec: Spec;
}

export type Spec =
  | { t: 'bool' }
  | { t: 'int'; min: number; max: number }
  | { t: 'num'; min: number; max: number }
  | { t: 'str'; min: number; max: number; pattern?: StrPattern }
  /** A value equal (===) to one of `values`; any other value, whatever its type, is `enum`. */
  | { t: 'enum'; values: readonly (string | number)[] }
  /** A bilingual text, see `ltext.ts`. */
  | { t: 'ltext' }
  | { t: 'expr'; type: ExprType }
  | { t: 'obj'; fields: readonly FieldSpec[]; reserved?: readonly string[] }
  | { t: 'arr'; item: Spec; min: number; max: number }
  /**
   * An object whose `tag` field picks the variant; each variant spec is an `obj` that lists the tag
   * field itself (an enum with the one value). `reservedTags` fail with `not_available_yet`.
   * `unknown: 'degrade_rule'` turns an unknown rule kind into a manual rule card (`rules` only).
   */
  | {
      t: 'union';
      tag: string;
      variants: readonly UnionVariant[];
      reservedTags?: readonly string[];
      unknown?: 'error' | 'degrade_rule';
    }
  /** The first option that accepts the value; see `validate-spec.ts` for the issue rules. */
  | { t: 'oneof'; options: readonly Spec[] };

export type SpecType = Spec['t'];
