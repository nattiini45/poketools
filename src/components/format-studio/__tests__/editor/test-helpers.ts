/**
 * Helpers for the editor component tests (static markup, no DOM): the generic ones (`@/test/markup`) and the fixtures
 * of the format editor.
 */
import { PRESETS, type FormatDefinition } from '@/lib/format-kit/client';
import { normalizeDraft, type DraftDocument } from '@/lib/format-studio/editor/document';
import { compileDraft } from '@/lib/format-studio/editor/preview';

export { esc, expectLabelledControls, expectNoLeftovers, expectUniqueIds, stripMarkup } from '@/test/markup';

/** A kit preset as the editor holds it: normalised, and a copy the test may change. */
export function presetDoc(id: 'classic-league' | 'cup' | 'swiss-top-cut' = 'classic-league'): DraftDocument {
  const preset = PRESETS.find((p) => p.id === id);
  if (preset === undefined) throw new Error(`no preset ${id}`);
  const result = normalizeDraft(structuredClone(preset.definition) as FormatDefinition);
  if (!result.ok) throw new Error('preset does not normalise');
  return result.doc;
}

/** The compile the editor shows for a document. */
export const compiled = (doc: DraftDocument, rulesetIds?: ReadonlySet<string>) => compileDraft(doc, rulesetIds);

/** The English and German text of a stage name, for assertions. */
export function stageNameOf(doc: DraftDocument, index: number, locale: 'en' | 'de'): string {
  const name = doc.stages[index].name;
  return name[locale]?.v ?? name[name.base]?.v ?? '';
}
