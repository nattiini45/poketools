/**
 * Zod schemas of the text shapes both kits and both studios share (server side; the browser reads the same shapes
 * through the format kit's Spec interpreter): a bounded string, a NUL-free text string and the bilingual `LText`.
 * The `LText` types and helpers live in `ltext.ts`; the `Expect<Same<...>>` check in the format kit's
 * `schema/index.ts` keeps this schema and that type in step.
 */
import { z } from 'zod';
import { TEXT_PATTERN } from './keys';
import { LTEXT_MAX_CHARS } from './ltext';

/**
 * A string of `min..max` characters. The length check is a custom issue (`params.code = 'length'`)
 * that only runs on strings: zod's own length checks also run on any value that has a `length`
 * (an array, an object with a `length` key) and would report a second issue next to the type one.
 */
export function boundedString(min: number, max: number) {
  return z.string().refine((value) => value.length >= min && value.length <= max, {
    params: { code: 'length' },
    when: (payload) => typeof payload.value === 'string',
  });
}

/** A string without NUL, `min..max` characters. */
export function textString(min: number, max: number) {
  return boundedString(min, max).regex(TEXT_PATTERN);
}

const ltextValueSchema = z.strictObject({
  v: textString(1, LTEXT_MAX_CHARS),
  s: z.enum(['human', 'machine', 'reviewed']),
});

/**
 * `{ en?, de?, base }`: each present language is `{ v, s }`, and the `base` language must be
 * present (a `refine` issue with rule `ltext_base_present`). The refine does not run when a
 * field already failed with a type, required or enum issue.
 */
export const ltextSchema = z
  .strictObject({
    en: ltextValueSchema.optional(),
    de: ltextValueSchema.optional(),
    base: z.enum(['en', 'de']),
  })
  .refine((text) => text[text.base] !== undefined, { params: { code: 'refine', rule: 'ltext_base_present' } });
