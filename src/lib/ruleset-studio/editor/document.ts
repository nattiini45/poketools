/**
 * The working document of the ruleset editor. The document IS a `RulesetDocument`: the form edits the same structure the
 * server stores, so there is no second shape to convert. This module decides whether a stored draft can be shown in the
 * form, gives the editor its dirty signature and builds a blank replacement for a draft it cannot show.
 *
 * Pure and client-safe.
 */
import { validateRulesetDocument, type StructureIssue } from '@/lib/ruleset-kit/validate';
import type { RulesetDocument } from '@/lib/ruleset-kit/types';
import { canonicalizeJson } from '@/lib/studio-core/json';
import type { LText, LTextValue, Locale } from '@/lib/studio-core/ltext';
import { newRulesetDocument } from '@/lib/ruleset-studio/document';

export type DraftDocument = RulesetDocument;

export type NormalizeResult = { ok: true; doc: DraftDocument } | { ok: false; issues: StructureIssue[] };

/**
 * A stored draft as the editor's document, or the structural reasons the form cannot show it (a draft written through
 * the API by hand). The validator returns a normalized copy that shares nothing with the input.
 */
export function normalizeDraft(raw: unknown): NormalizeResult {
  const parsed = validateRulesetDocument(raw);
  return parsed.ok ? { ok: true, doc: parsed.document } : { ok: false, issues: parsed.issues };
}

/** The canonical JSON of a document: key order never matters, so two equal documents have one signature. */
export function documentSignature(doc: DraftDocument): string {
  return canonicalizeJson(doc);
}

/** A blank document for an unreadable draft the author chose to replace. */
export function blankDocument(name: string, locale: Locale): DraftDocument {
  return newRulesetDocument(name, locale);
}

/**
 * Sets one language of a bilingual text, keeping the text valid: an emptied language other than the base is dropped, the
 * base language becomes the other one when its own text is emptied and the other has text, and an edited language is
 * marked as written by a person. `undefined` in means no text yet; `undefined` out means no text left.
 */
export function editLText(text: LText | undefined, locale: Locale, value: string, authorBase: Locale): LText | undefined {
  const entry: LTextValue = { v: value, s: 'human' };
  if (text === undefined) return value === '' ? undefined : { base: locale, [locale]: entry };
  const base: Locale = text.base === 'en' || text.base === 'de' ? text.base : authorBase;
  const current: LText = { ...text, base };
  if (value !== '') return { ...current, [locale]: entry };
  const without = (source: LText): LText => {
    const { [locale]: _dropped, ...rest } = source;
    return rest as LText;
  };
  if (locale !== base) return without(current);
  const other: Locale = locale === 'en' ? 'de' : 'en';
  if ((current[other]?.v ?? '') !== '') return { ...without(current), base: other };
  return { ...current, [locale]: entry };
}
