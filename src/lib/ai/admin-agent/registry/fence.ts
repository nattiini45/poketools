/**
 * Fencing of text that comes out of the database (spec §18.12, plan 6.3 mitigation 2).
 *
 * Player and guest names, league, phase, tournament, format and ruleset names and descriptions, pool entries and tier
 * labels are stored text: anyone who can type one can try to talk to the model through it. Tool results are JSON in which
 * free text appears only in fields named `label` (a short name) or `user_text` / `*_user_text` (anything longer), and
 * every such value passes through `fenceLabel` / `fenceText`, which
 *  - normalises to NFC and strips hidden characters (bidi overrides and isolates, zero-width characters, Unicode tag
 *    characters, variation selectors; `src/lib/utils/hidden-text.ts`) and control characters,
 *  - collapses whitespace runs (a newline cannot start a "new section" inside a name),
 *  - defuses the harness-event marker the loop uses for approvals (a stored `[harness_event: ...]` cannot pose as one),
 *  - caps the length.
 * The frozen system prompt tells the model that these fields are data, never instructions. The structure test
 * (`__tests__/projection.test.ts`) fails when a reader's output schema has a free-text string under another name.
 */
import { resolveLText, type LText } from '@/lib/studio-core/ltext';
import { stripHiddenChars } from '@/lib/utils/hidden-text';

export const LABEL_MAX = 120;
export const USER_TEXT_MAX = 500;

/** C0 and C1 control characters, DEL. (Whitespace is collapsed first, so tab and newline are gone by then.) */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;
/** The approval marker of the loop's harness events: stored text must not be able to imitate it. */
const HARNESS_MARKER = /harness[\s_-]*event/giu;

/** Sanitises `value` to at most `max` characters; `null` and `undefined` become the empty string. */
export function fence(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Order matters: the byte-order mark and some bidi marks count as `\s`, so the invisible characters go first; tabs and
  // newlines are control characters, so whitespace collapses before the control characters are removed.
  let text = stripHiddenChars(value.normalize('NFC'));
  text = text.replace(/\s+/gu, ' ').replace(CONTROL, '');
  text = text.replace(HARNESS_MARKER, 'harness event');
  text = text.trim();
  // Cut on code points, not UTF-16 units, so a surrogate pair is never split.
  const points = Array.from(text);
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text;
}

/** A short name: the `label` field of a result. */
export const fenceLabel = (value: unknown): string => fence(value, LABEL_MAX);

/** Longer stored text: a `user_text` field of a result. */
export const fenceText = (value: unknown): string => fence(value, USER_TEXT_MAX);

/** The label of a bilingual stored text, in the viewer's language (English as the fallback), fenced. */
export function fenceLText(text: LText | null | undefined, locale: 'en' | 'de'): string {
  if (!text) return '';
  const resolved = resolveLText(text, { viewer: locale });
  return fenceLabel(resolved?.value ?? '');
}

/** Same, for a longer text. */
export function fenceLTextBody(text: LText | null | undefined, locale: 'en' | 'de'): string {
  if (!text) return '';
  const resolved = resolveLText(text, { viewer: locale });
  return fenceText(resolved?.value ?? '');
}
