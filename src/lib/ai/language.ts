/**
 * Output language of generated AI text (i18n-core §6.4).
 *
 * The prompts themselves stay English; one instruction line, appended to the
 * system prompt, sets the language the model writes in:
 *   - stored artifacts (match analysis, scouting reports) follow the league,
 *     via `resolveContentLocale` (`seasons.language`);
 *   - live, per-viewer AI (agent chat, threat assessment, the teambuilder
 *     coaches) follows the viewer, via `getRequestLocale(request)`.
 * Kale (the soft-deprecated report pipeline and the `kale` agent persona)
 * stays English: its validator is English-specific.
 *
 * Pure: no server-only imports, so the agent core stays transport-agnostic.
 */
import type { Locale } from '@/i18n/config';

const GERMAN_INSTRUCTION =
  'Write all prose in German (du-Form). Use official German Pokémon, move, ability and item names; ' +
  'keep Showdown export blocks and numbers unchanged. ' +
  // Structured answers: the UI renders sprites and links from the `pokemon`
  // fields and parses the keys, so only the prose values change language.
  'If you answer with JSON, keep every key, and every `pokemon` field, exactly as specified ' +
  '(the English Showdown name); only the prose values are German.';

const ENGLISH_INSTRUCTION = 'Write in English.';

/** The language line for a generation in `locale`. */
export function outputLanguageInstruction(locale: Locale): string {
  return locale === 'de' ? GERMAN_INSTRUCTION : ENGLISH_INSTRUCTION;
}

/** `systemPrompt` with the language line for `locale` appended as its last paragraph. */
export function withOutputLanguage(systemPrompt: string, locale: Locale): string {
  return `${systemPrompt}\n\n${outputLanguageInstruction(locale)}`;
}
