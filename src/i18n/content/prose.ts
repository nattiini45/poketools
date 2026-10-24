/**
 * German league prose from the EPB workbook (`rationale`, `historical_data`). It is never translated into stored English:
 * English mode shows the German text verbatim, and the caller marks its
 * element with the returned `lang` (`<p lang={lang}>{text}</p>`).
 * Special-rule text uses `specialRulesTextFor` (`src/lib/draft/special-rules-text.ts`) instead.
 */

/** League prose stored in German (EPB rationale / historical data). Always German; the caller sets lang. */
export function leagueProse(text: string | null | undefined): { text: string | null; lang: 'de' } {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  return { text: trimmed === '' ? null : trimmed, lang: 'de' };
}
