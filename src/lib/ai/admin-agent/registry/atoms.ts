/**
 * Zod building blocks shared by the tool argument schemas and the strict output schemas.
 *
 * Arguments: full constraints here (the server validates them); `toWireSchema` strips them for the model, so the
 * `.describe()` text carries the limit in prose.
 *
 * Outputs: a string field is one of
 *  - an `id()` / `code()` / `isoDateTime()` / an enum: a constrained token that cannot carry prose;
 *  - a `label()` (a short stored name) or a `userText()` (longer stored text), both `meta({ fenced })`-marked. The
 *    projection must pass the value through `fenceLabel` / `fenceText` (`fence.ts`); the structure test
 *    (`__tests__/projection.test.ts`) fails on any other free-text string and on a fenced field with another name.
 */
import { z } from 'zod';
import { LABEL_MAX, USER_TEXT_MAX } from './fence';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Arguments ───────────────────────────────────────────────────────────────

/** A uuid argument. */
export const uuidArg = (what: string) => z.string().regex(UUID, 'must be a UUID').describe(`${what} (UUID)`);

/** A whole number argument in `[min, max]`. */
export const intArg = (what: string, min: number, max: number) =>
  z.number().int().min(min).max(max).describe(`${what} (whole number ${min} to ${max})`);

/** Short free text typed by the model (a search query, a name). Plain text, no links. */
export const textArg = (what: string, max: number) => z.string().trim().min(1).max(max).describe(`${what} (up to ${max} characters)`);

export const localeArg = z.enum(['en', 'de']);

// ─── Outputs ─────────────────────────────────────────────────────────────────

/** A uuid in a result. Marked `idRef`: the loop records it as an id the conversation has seen (`result-refs.ts`). */
export const id = () => z.string().regex(UUID).meta({ idRef: true });

/** A stable machine token (status, kind, slug, catalog id, error code). Cannot hold prose. */
export const code = () => z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_:.\-/]{0,79}$/);

/** An ISO-8601 date or date-time as the database stores it. */
export const isoDateTime = () => z.string().regex(/^\d{4}-\d{2}-\d{2}([T ][0-9:.]+(Z|[+-]\d{2}(:?\d{2})?)?)?$/);

/** A short stored name. Key must be `label`. Fenced by the projection. */
export const label = () => z.string().max(LABEL_MAX).meta({ fenced: 'label' });

/** Longer stored text. Key must be `user_text` or end in `_user_text`. Fenced by the projection. */
export const userText = (max: number = USER_TEXT_MAX) => z.string().max(max).meta({ fenced: 'user_text' });

/** A dex-derived display name or a catalog name (engine data, not stored text): constrained to the characters names use. */
export const dexName = () => z.string().regex(/^[\p{L}\p{N} .'’:%&()+\-/!?]{1,80}$/u);

/** A list result that says when it was cut at `cap` (plan 3.6.2: "truncated" at the real cap). */
export const capped = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative().nullable(),
    truncated: z.boolean(),
    cap: z.number().int().positive(),
  });

/** Builds a `capped` result. `total` is `null` when the source cannot count past its own cap. */
export function cappedResult<T>(items: readonly T[], cap: number, total: number | null = null) {
  const truncated = total !== null ? items.length < total : items.length >= cap;
  return { items: items.slice(0, cap), total, truncated, cap };
}

/** A paged list (`limit` / `offset` as the studio list routes use them); `truncated` says more rows follow. */
export const paged = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    truncated: z.boolean(),
  });

/** Builds a `paged` result from one page and the exact total. */
export function pagedResult<T>(items: readonly T[], total: number, limit: number, offset: number) {
  return { items: [...items], total, limit, offset, truncated: offset + items.length < total };
}
