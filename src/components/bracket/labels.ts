import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/core';
import { bracketMessages } from '@/i18n/messages/bracket';
import { enumMessages } from '@/i18n/messages/enums';
import type { MatchStatus } from '@/types/match';

/**
 * The words the elimination bracket renderers print. The renderers default
 * to the viewer's language (`bracketLabelsFor(useLocale())`); a caller may
 * still pass its own set as an override. Plain strings only: the renderers
 * are client components, so these labels cross the server/client boundary
 * as props.
 */
export interface BracketLabels {
  winnersBracket: string;
  losersBracket: string;
  grandFinals: string;
  noRounds: string;
  /** An open slot or round with nobody in it yet. */
  tbd: string;
  /** "Match" in the skeleton card's accessible name ("Match 3 TBD"). */
  match: string;
  /** The skeleton card's accessible name when it has no match number. */
  tbdMatch: string;
  /**
   * Match status chip labels. Null keeps `MatchStatusBadge` (the English
   * chip every other match surface shows).
   */
  matchStatus: Readonly<Record<MatchStatus, string>> | null;
  /**
   * Double elimination: the short loss mark after an entrant's count on a
   * match card ("1 L"), and its spelled-out meaning (tooltip and screen
   * reader text, "Losses before this match: 1").
   */
  lossesShort: string;
  lossesEntering: string;
}

const labelsByLocale = new Map<Locale, BracketLabels>();

/**
 * The renderer's words in one language, from the `bracket` namespace. In
 * English the status chips stay null (`MatchStatusBadge`'s own chip, as every
 * other match surface shows it); other languages label them from `enums`.
 */
export function bracketLabelsFor(locale: Locale): BracketLabels {
  const cached = labelsByLocale.get(locale);
  if (cached) return cached;
  const labels: BracketLabels = {
    ...getMessages(bracketMessages, locale).labels,
    matchStatus: locale === 'en' ? null : { ...getMessages(enumMessages, locale).matchStatus },
  };
  labelsByLocale.set(locale, labels);
  return labels;
}

/** The English words: the renderers' fallback outside a language context. */
export const DEFAULT_BRACKET_LABELS: BracketLabels = bracketLabelsFor('en');

/**
 * A bracket in another language: the renderer labels, plus the translations
 * of the English names the bracket engine stores (round names) and builds
 * (feeder labels such as "Winner of M3"). Server-side only (functions):
 * `ElimBracketView` applies them before it hands the rounds and labels on.
 */
export interface BracketCopy {
  labels: BracketLabels;
  roundName: (name: string) => string;
  slotLabel: (label: string) => string;
}
