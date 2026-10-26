import 'server-only';
/**
 * The rules text of a ruleset on a server page: `describeRuleset` with entry names resolved from the dex (English names for
 * the ids, then the reader's data language through the name layer). The pure sentences live in the kit
 * (`@/lib/ruleset-kit/describe`); this file only supplies what needs the dex.
 */
import type { Locale } from '@/i18n/config';
import { describeRuleset, type DescribedRuleset } from '@/lib/ruleset-kit/describe';
import type { ResolvedRules } from '@/lib/ruleset-kit/types';
import { KIND_OF, displayNameOf } from './editor/picker/display';
import { entryName } from './names.server';

export function describeResolved(rules: ResolvedRules, locale: Locale, presetName: string | null): DescribedRuleset {
  return describeRuleset(rules, locale, {
    presetName,
    nameOf: (category, id) => displayNameOf(KIND_OF[category], entryName(category, id), locale),
  });
}
