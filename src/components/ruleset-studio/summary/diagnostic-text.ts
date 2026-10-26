import type { Translator } from '@/i18n/core';
import type { rulesetStudioDiagnosticsMessages } from '@/i18n/messages/ruleset-studio/diagnostics';
import { clauseName } from '@/lib/pkmn/clauses';
import type { RulesetDiagnostic, RulesetDiagnosticCode } from '@/lib/ruleset-kit/compile';
import { RULESET_CATEGORIES, type RulesetCategory } from '@/lib/ruleset-kit/types';

export type DiagnosticsT = Translator<typeof rulesetStudioDiagnosticsMessages.en>;

const isCategory = (value: unknown): value is RulesetCategory => (RULESET_CATEGORIES as readonly unknown[]).includes(value);

/**
 * One diagnostic as a sentence in the viewer's language. The compile reports a code and parameters; the words are the
 * `ruleset-studio/diagnostics` namespace, with the entry name from the name layer (`nameOf`, the id when the catalog has not
 * loaded) and clause names as Showdown spells them.
 */
export function diagnosticText(
  diagnostic: RulesetDiagnostic,
  t: DiagnosticsT,
  nameOf: (category: RulesetCategory, id: string) => string,
): string {
  const params = diagnostic.params ?? {};
  const id = typeof params.id === 'string' ? params.id : '';
  const category = params.category;
  const name = isCategory(category) ? nameOf(category, id) : clauseName(id);
  const issue = typeof params.issue === 'string' ? params.issue : '';
  return t.dynamic(`code.${diagnostic.code}`, {
    name,
    id,
    category: typeof category === 'string' ? t.dynamic(`category.${category}`) : '',
    clause: clauseName(id),
    preset: typeof params.preset === 'string' ? params.preset : '',
    issue: t.has(`structure.${issue}`) ? t.dynamic(`structure.${issue}`) : issue,
  });
}

/** The key of `fix.*` that labels the one-click fix of a diagnostic code. */
export function fixKey(code: RulesetDiagnosticCode): 'remove' | 'clear' | 'blank' {
  if (code === 'allowlist_with_bans') return 'clear';
  if (code === 'preset_unknown') return 'blank';
  return 'remove';
}
