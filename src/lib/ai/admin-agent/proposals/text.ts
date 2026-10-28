/**
 * Text in staged calls and on cards (plan 6.3 item 8, 4.5 "The card").
 *
 *  - `scanStagedText` finds model-authored strings that may not be stored or posted (bidi or control characters, URLs,
 *    markdown links) in the arguments of a staged call: `text_not_allowed` at staging. It reuses the Plan's own detector
 *    (`plans/text.ts`), so a Plan edit and a staged call agree.
 *  - `sanitizeCardText` makes stored text safe to show: hidden characters stripped (and counted, for the "contains N hidden
 *    characters" badge), whitespace collapsed, length capped. A card never shows raw stored text.
 */
import { countHiddenChars, stripHiddenChars } from '@/lib/utils/hidden-text';
import { disallowedTextReason, type DisallowedTextReason } from '../plans/text';

export interface StagedTextFinding {
  /** RFC 6901 pointer to the string inside the arguments. */
  path: string;
  reason: DisallowedTextReason;
}

const MAX_NODES = 5_000;
const MAX_DEPTH = 12;

/** Every string leaf of `value` that fails the Plan's text rule. Keys are not scanned (they come from our own schemas). */
export function scanStagedText(value: unknown): StagedTextFinding[] {
  const findings: StagedTextFinding[] = [];
  let nodes = 0;
  const visit = (node: unknown, path: string, depth: number): void => {
    if (nodes++ > MAX_NODES || depth > MAX_DEPTH) return;
    if (typeof node === 'string') {
      const reason = disallowedTextReason(node);
      if (reason !== null) findings.push({ path, reason });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}/${index}`, depth + 1));
    } else if (typeof node === 'object' && node !== null) {
      for (const [key, item] of Object.entries(node)) visit(item, `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, depth + 1);
    }
  };
  visit(value, '', 0);
  return findings;
}

/** Stored text as a card shows it: plain, capped, and honest about what was removed. */
export interface CardText {
  text: string;
  /** How many control or bidi characters were removed. A card with `hidden > 0` shows the badge. */
  hidden: number;
}

// Controls other than tab, line feed and carriage return (those become spaces), DEL, C1 controls, line and paragraph
// separators. The hidden characters (bidi, zero-width, tag characters, variation selectors) come from `src/lib/utils/hidden-text.ts`.
const CONTROLS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u2028\\u2029]', 'g');

export const CARD_TEXT_MAX = 120;

export function sanitizeCardText(raw: string, max: number = CARD_TEXT_MAX): CardText {
  const hidden = (raw.match(CONTROLS) ?? []).length + countHiddenChars(raw);
  const collapsed = stripHiddenChars(raw.replace(CONTROLS, '')).normalize('NFC').replace(/\s+/g, ' ').trim();
  const points = [...collapsed];
  return { text: points.length > max ? `${points.slice(0, max - 1).join('')}…` : collapsed, hidden };
}

/** The longest typed confirmation the approve request carries (UTF-16 units); a card's expected text is at most `CARD_TEXT_MAX` characters. */
export const TYPED_NAME_WIRE_MAX = 400;

/**
 * A typed confirmation as it is compared with a card's `expected.text`: the same cleaning the expected text went through
 * (hidden and control characters removed, NFC, whitespace collapsed) and never truncated, so a typed text longer than the
 * expected one can never match it.
 */
export function normalizeTypedName(raw: string): string {
  return sanitizeCardText(raw, TYPED_NAME_WIRE_MAX).text;
}
