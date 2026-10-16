import type { Locale } from '@/i18n/config';
import { paintText } from '../../paint-copy';

/**
 * The sakura roster frieze's top-line note (fidelity W1 clarity), in the
 * viewer's language (`world-themes.paint.note.*`).
 *
 * The old overflow note sent visitors to "the section below" — but on the
 * route tier every semantic section is `visibility: hidden`, so the note
 * pointed at nothing. The note now names what the visitor can DO here: tap
 * (or click) the wall, which is the wall's focus subject — the camera
 * frames the frieze at its readable focus pose (ADR-0003; design decision D4:
 * "one visible tap away and readable at the focus pose"). It stays honest
 * about the count: the frieze paints the first `shown` lines of `total`.
 *
 * `fullListOnTap` is for the day the wall gains a DOM list panel (the
 * roster-panel follow-up): only then may the note promise every line on a
 * tap. Until then it promises the close-up, which is what a tap delivers.
 */
export function rosterWallNote(shown: number, total: number, fullListOnTap = false, locale: Locale = 'en'): string {
  if (total > shown) {
    return fullListOnTap
      ? paintText(locale, 'note.rosterWallAll', { shown, total })
      : paintText(locale, 'note.rosterWallSome', { shown, total });
  }
  return paintText(locale, 'note.rosterWall');
}
