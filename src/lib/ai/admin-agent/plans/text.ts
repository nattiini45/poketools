/**
 * Model-authored text that becomes stored or posted text (plan 6.3 item 8): names and descriptions the routes would
 * store with only trim, min and max. Bidi overrides, control characters, URLs and markdown links are refused with
 * `text_not_allowed` before anything is staged; the Plan's own `title` and `assumptions[].value` are un-keyed prose
 * that never reaches outward text, so they are not scanned.
 *
 * Pure. The staging code (proposals/) applies the same function to the strings of a staged call.
 */
import { hasHiddenChars } from '@/lib/utils/hidden-text';
import type { PlanDocument } from './schema';

/** `bidi_characters` covers every hidden character of `src/lib/utils/hidden-text.ts`: bidi marks, zero-width characters, tag characters, variation selectors. */
export type DisallowedTextReason = 'control_characters' | 'bidi_characters' | 'url' | 'markdown_link';

// C0 controls except tab, line feed and carriage return; DEL; C1 controls; line and paragraph separators.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u2028\\u2029]');
const URL = /(?:\b[a-z][a-z0-9+.-]{1,15}:\/\/|\bwww\.|\bmailto:|\bdiscord(?:app)?\.(?:gg|com)\/)/i;
// `[text](target)` and the reference form `[text]: target`.
const MARKDOWN_LINK = /\[[^\]]*\]\s*\([^)]*\)|^\s*\[[^\]]+\]:\s*\S+/m;

/** The first reason `text` may not be stored or posted, or null. */
export function disallowedTextReason(text: string): DisallowedTextReason | null {
  if (CONTROL.test(text)) return 'control_characters';
  if (hasHiddenChars(text)) return 'bidi_characters';
  if (URL.test(text)) return 'url';
  if (MARKDOWN_LINK.test(text)) return 'markdown_link';
  return null;
}

export interface PlanTextFinding {
  /** RFC 6901 pointer to the string. */
  path: string;
  reason: DisallowedTextReason;
}

/** Every stored or outward string of the Plan that fails `disallowedTextReason`. */
export function scanPlanText(plan: PlanDocument): PlanTextFinding[] {
  const findings: PlanTextFinding[] = [];
  const check = (path: string, text: string | undefined) => {
    if (text === undefined) return;
    const reason = disallowedTextReason(text);
    if (reason !== null) findings.push({ path, reason });
  };
  const { league, phases, tournament, ruleset } = plan.slots;
  if (league) {
    check('/slots/league/name', league.name);
    check('/slots/league/description', league.description);
  }
  phases?.forEach((phase, index) => {
    check(`/slots/phases/${index}/name`, phase.name);
    check(`/slots/phases/${index}/description`, phase.description);
  });
  if (tournament) {
    check('/slots/tournament/name', tournament.name);
    check('/slots/tournament/description', tournament.description);
  }
  if (ruleset && (ruleset.mode === 'new' || ruleset.mode === 'fork')) check('/slots/ruleset/name', ruleset.name);
  return findings;
}
