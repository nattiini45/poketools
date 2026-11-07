/**
 * Small helpers shared by the islands of the league admin "Live format" tab. Plain TypeScript, client-safe: no server
 * module, no React.
 */
import type { Locale } from '@/i18n/config';
import { resolveLText, type LText } from '@/lib/studio-core/ltext';

/** Touch target of a control: 44 px tall on a phone, the normal height from `sm` up (as the attach panel). */
export const BUTTON_TOUCH = 'min-h-11 sm:min-h-0';

/** Longest `reason` of an adjustment and longest `note` of a check verdict, in characters (code points), as the server. */
export const TEXT_MAX = 500;

/** Rows per page of the adjustment history and the resolved-check list. */
export const PAGE_SIZE = 20;

/** The names of the league's players, by id: ids the league does not know are missing. */
export type PlayerNames = Readonly<Record<string, string>>;

/** The length the server counts: code points, so an emoji is one character. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** A bilingual label in the viewer's language, or `fallback` (a key, say) when the label is missing. */
export function labelText(text: LText | null | undefined, locale: Locale, fallback: string): string {
  if (text === null || text === undefined) return fallback;
  return resolveLText(text, { viewer: locale })?.value ?? fallback;
}

/** The name of a player id, or null when the league does not know the player. */
export function nameOf(names: PlayerNames, id: string): string | null {
  return Object.hasOwn(names, id) ? names[id] : null;
}
