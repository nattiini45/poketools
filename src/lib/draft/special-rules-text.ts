/**
 * Per-line special-rule prose in two languages.
 * Client-safe, pure, no crypto.
 *
 * German is the workbook prose (`special_rules_text`, stored verbatim). English is
 * authored in the active format pack for every line that carries text. Each English entry pins the
 * hash of the German text it translates: when the stored German text changes (a
 * new list version), the English entry is stale and the German text is shown with
 * `lang: 'de'` instead, so the UI never shows an outdated translation. No `_en`
 * columns and no machine translation.
 */

import type { Locale } from '@/i18n/config';
import type { AppliedOverride } from '@/lib/draft/league-overrides';
import { lineIdOfEntry, type LineId, type LineKeyedEntry } from '@/lib/draft/line-identity';
import { epbPack } from '@/lib/format-pack';

/** FNV-1a 32-bit (8 lowercase hex digits) over the UTF-8 bytes of `text.normalize('NFC')`. */
export function proseHash(text: string): string {
  const bytes = new TextEncoder().encode(text.normalize('NFC'));
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Authored English for the lines whose workbook row carries special-rule text: the active format
 * pack's `epb.specialRulesEn` (`@/lib/format-pack`).
 */
export const SPECIAL_RULES_EN: Readonly<Record<LineId, { de_hash: string; en: string }>> = epbPack.specialRulesEn;

function join(parts: (string | null | undefined)[]): string | null {
  const text = parts.filter((p): p is string => !!p && p.trim().length > 0).join(' ');
  return text.length > 0 ? text : null;
}

function overrideReasons(overrides: readonly AppliedOverride[] | undefined, lang: Locale): string[] {
  if (!overrides || overrides.length === 0) return [];
  return [...new Set(overrides.map((o) => o.reason[lang]))];
}

/**
 * The special-rule text of a line in `locale`, with the league override reasons
 * (`epb.lineOverrides`) appended. `lang` is the language the text is actually in: an English
 * request falls back to the German workbook text (`lang: 'de'`) when no current
 * English entry exists, so the UI can set `lang="de"`.
 */
export function specialRulesTextFor(
  entry: LineKeyedEntry & { special_rules_text: string | null; overrides?: AppliedOverride[] },
  locale: Locale,
): { text: string | null; lang: Locale } {
  const de = entry.special_rules_text?.trim() ? entry.special_rules_text : null;

  if (locale === 'de') {
    return { text: join([de, ...overrideReasons(entry.overrides, 'de')]), lang: 'de' };
  }

  if (de === null) {
    return { text: join(overrideReasons(entry.overrides, 'en')), lang: 'en' };
  }
  const authored = SPECIAL_RULES_EN[lineIdOfEntry(entry)];
  if (authored && authored.de_hash === proseHash(de)) {
    return { text: join([authored.en, ...overrideReasons(entry.overrides, 'en')]), lang: 'en' };
  }
  // No current English: show the workbook German as German, reasons in German too (one language per text).
  return { text: join([de, ...overrideReasons(entry.overrides, 'de')]), lang: 'de' };
}
