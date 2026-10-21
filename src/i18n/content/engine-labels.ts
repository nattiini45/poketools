/**
 * Display-time translation of the English names the engines store in the DB
 * (i18n-core §5.1): round names, bracket slot labels, group names, the full
 * bracket marker, system notes and the system actor. Writers are unchanged;
 * `locale: 'en'` is the identity. Text that matches no pattern (an admin's
 * own "Woche 1") is returned unchanged.
 */
import type { Locale } from '../config';
import { createTranslator } from '../core';
import { contentMessages } from '../messages/content';
import type { Leaves } from '../types';

export type EngineLabelKind = 'round' | 'slot' | 'group' | 'bracket' | 'note' | 'actor';

type ContentKey = Leaves<typeof contentMessages.en>;
type Pattern = readonly [pattern: RegExp, key: ContentKey, param?: string];

/** `bracket-structure.ts`, `single-elim.ts`, `double-elim.ts`, `round-robin.ts`, `swiss.ts` round names. */
const ROUND_PATTERNS: readonly Pattern[] = [
  [/^Round (\d+)$/, 'round.round', 'n'],
  [/^Winners Round (\d+)$/, 'round.winnersRound', 'n'],
  [/^Losers Round (\d+)$/, 'round.losersRound', 'n'],
  [/^Winners Finals?$/, 'round.winnersFinal'],
  [/^Losers Finals?$/, 'round.losersFinal'],
  [/^Grand Finals? Reset$/, 'round.grandFinalReset'],
  [/^Grand Finals?$/, 'round.grandFinal'],
  [/^Finals?$/, 'round.final'],
  [/^Semifinals?$/, 'round.semifinal'],
  [/^Quarterfinals?$/, 'round.quarterfinal'],
];

/** `feederLabel` slot labels ("Winner of M3", "Seed 2 (LB)", "BYE"). */
const SLOT_PATTERNS: readonly Pattern[] = [
  [/^Winner of M(\d+|\?)$/, 'slot.winnerOf', 'match'],
  [/^Loser of M(\d+|\?)$/, 'slot.loserOf', 'match'],
  [/^Seed (\d+) \(LB\)$/, 'slot.seedLosers', 'seed'],
  [/^Seed (\d+)$/, 'slot.seed', 'seed'],
  [/^BYE$/, 'slot.bye'],
];

const GROUP_PATTERNS: readonly Pattern[] = [[/^Group (.+)$/, 'group.group', 'label']];
const BRACKET_PATTERNS: readonly Pattern[] = [[/^Full bracket$/, 'bracket.fullBracket']];
const NOTE_PATTERNS: readonly Pattern[] = [
  [/^Auto-confirmed after timeout\.$/, 'note.autoConfirmed'],
  [/^Rejected by moderator$/, 'note.rejectedByModerator'],
  [/^Admin correction$/, 'note.adminCorrection'],
];
const ACTOR_PATTERNS: readonly Pattern[] = [[/^System$/, 'actor.system']];

const IF_NECESSARY = / \(if necessary\)$/;

function applyPatterns(patterns: readonly Pattern[], text: string, locale: Locale): string | null {
  const t = createTranslator(contentMessages, locale);
  for (const [pattern, key, param] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    return param ? t.dynamic(key, { [param]: match[1] ?? '' }) : t.dynamic(key);
  }
  return null;
}

function translateSlot(text: string, locale: Locale): string {
  if (IF_NECESSARY.test(text)) {
    const core = text.replace(IF_NECESSARY, '');
    const label = applyPatterns(SLOT_PATTERNS, core, locale) ?? core;
    return createTranslator(contentMessages, locale)('slot.ifNecessary', { label });
  }
  return applyPatterns(SLOT_PATTERNS, text, locale) ?? text;
}

function translateNote(text: string, locale: Locale): string {
  // System notes are appended to admin notes on their own line ("…\nAuto-confirmed after timeout.").
  return text
    .split('\n')
    .map((line) => applyPatterns(NOTE_PATTERNS, line.trim(), locale) ?? line)
    .join('\n');
}

export function translateEngineLabel(kind: EngineLabelKind, text: string, locale: Locale): string {
  if (locale === 'en' || !text) return text;
  switch (kind) {
    case 'round': {
      const trimmed = text.trim();
      return applyPatterns(ROUND_PATTERNS, trimmed, locale) ?? text;
    }
    case 'slot':
      return translateSlot(text, locale);
    case 'group':
      return applyPatterns(GROUP_PATTERNS, text.trim(), locale) ?? text;
    case 'bracket':
      return applyPatterns(BRACKET_PATTERNS, text.trim(), locale) ?? text;
    case 'note':
      return translateNote(text, locale);
    case 'actor':
      return applyPatterns(ACTOR_PATTERNS, text.trim(), locale) ?? text;
  }
}
