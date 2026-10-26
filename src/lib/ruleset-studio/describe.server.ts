import 'server-only';
/**
 * The rules text of a ruleset on a server page: `describeRuleset` with entry names resolved from the dex (English names for
 * the ids, then the reader's data language through the name layer). The pure sentences live in the kit
 * (`@/lib/ruleset-kit/describe`); this file only supplies what needs the dex.
 */
import type { Locale } from '@/i18n/config';
import { describeRuleset, type DescribedRuleset } from '@/lib/ruleset-kit/describe';
import { getPreset } from '@/lib/pkmn/format-catalog';
import type { ResolvedRules, RulesetDocument } from '@/lib/ruleset-kit/types';
import { compileDocument } from './compile.server';
import { KIND_OF, displayNameOf } from './editor/picker/display';
import type { RulesetDefinitionDetail } from './library-types';
import { entryName } from './names.server';

export function describeResolved(rules: ResolvedRules, locale: Locale, presetName: string | null): DescribedRuleset {
  return describeRuleset(rules, locale, {
    presetName,
    nameOf: (category, id) => displayNameOf(KIND_OF[category], entryName(category, id), locale),
  });
}

/** The name of the preset a document starts from; null for a blank base. */
function basePresetName(document: RulesetDocument | null): string | null {
  return document !== null && document.base.kind === 'preset' ? (getPreset(document.base.preset)?.name ?? document.base.preset) : null;
}

/** The rules text of an untrusted document (a draft), read from its own compile; null when it does not compile. */
export function describeDocument(input: unknown, locale: Locale): DescribedRuleset | null {
  const { document, resolved } = compileDocument(input).result;
  return resolved === null ? null : describeResolved(resolved, locale, basePresetName(document));
}

/**
 * The rules text a ruleset page shows: the newest published version, else the saved draft (`isDraft`). Both name the
 * base preset of the document actually described.
 */
export function describeDetail(
  detail: Pick<RulesetDefinitionDetail, 'published' | 'draft'>,
  locale: Locale,
): { described: DescribedRuleset | null; isDraft: boolean } {
  if (detail.published !== null) {
    return { described: describeResolved(detail.published.resolved, locale, basePresetName(detail.published.spec)), isDraft: false };
  }
  if (detail.draft !== null) return { described: describeDocument(detail.draft.document, locale), isDraft: true };
  return { described: null, isDraft: false };
}
