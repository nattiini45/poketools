/**
 * The characters a reader cannot see but a model reads (Admin Assistant plan 6.3 mitigations 2 and 8): one definition for
 * every place that strips, counts or refuses them (`ai/admin-agent/registry/fence.ts`, `plans/text.ts`, `proposals/text.ts`,
 * `loop/harness.ts`, `loop/titles.ts`, `dispatch/outcome.ts`). It lives here, outside the assistant, because the planner and
 * the dispatcher import no other assistant module. A name of up to 120 characters can otherwise carry a hidden instruction in
 * Unicode tag characters (the "ASCII smuggling" range U+E0000 to U+E007F) that the admin never sees.
 *
 * Pure and dependency-free, so the privileged dispatch layer may import it. The class is written with escapes only: no
 * invisible character appears in this file's source.
 *
 * What is NOT here: U+FE0F (emoji presentation) and U+200D (zero-width joiner) are legitimate parts of an emoji
 * sequence; the fence strips U+200D with the other zero-width characters because a league name has no use for a joiner,
 * while `neutralizeAdminText` keeps the admin's own emoji (it strips only to look for a hidden marker).
 */

/** Bidi marks, embeddings, overrides and isolates; zero-width characters; word joiner and invisible operators; BOM; soft hyphen. */
const BIDI_AND_ZERO_WIDTH = '\\u061C\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF\\u00AD';
/** Unicode tag characters, the plane-14 variation selectors, and the variation selectors of the BMP except U+FE0F. */
const TAGS_AND_SELECTORS = '\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}\\uFE00-\\uFE0E\\u180B-\\u180D';
/** Characters that render as nothing: combining grapheme joiner, Mongolian vowel separator, Hangul and Braille fillers. */
const BLANK_FILLERS = '\\u034F\\u115F\\u1160\\u180E\\u2800\\u3164\\uFFA0';

/** The body of a character class that matches every hidden character above (for building a larger class). */
export const HIDDEN_CLASS_BODY = `${BIDI_AND_ZERO_WIDTH}${TAGS_AND_SELECTORS}${BLANK_FILLERS}`;

/** A fresh global matcher on every call: a shared `g` regex carries `lastIndex` between callers. */
const global = (): RegExp => new RegExp(`[${HIDDEN_CLASS_BODY}]`, 'gu');
const single = new RegExp(`[${HIDDEN_CLASS_BODY}]`, 'u');

/** True when `text` holds at least one hidden character. */
export const hasHiddenChars = (text: string): boolean => single.test(text);

/** `text` without its hidden characters (or with each replaced by `replacement`). */
export const stripHiddenChars = (text: string, replacement = ''): string => text.replace(global(), replacement);

/** How many hidden characters `text` holds (code points, so a tag character counts once). */
export const countHiddenChars = (text: string): number => (text.match(global()) ?? []).length;
