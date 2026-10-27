/**
 * The ruleset editor's state machine: the studio core's editor reducer bound to the ruleset document and the selected
 * section. Dirty = the canonical JSON of the document differs from the last saved or loaded one.
 */
import { createEditorReducer, type StudioEditorAction, type StudioEditorState } from '@/lib/studio-core/editor-state';
import { documentSignature, type DraftDocument } from './document';
import { DEFAULT_SELECTION, type Selection } from './targets';

export type EditorState = StudioEditorState<DraftDocument, Selection>;
export type EditorAction = StudioEditorAction<DraftDocument, Selection>;

/** The reducer bundle of the ruleset editor: what the shared draft hook (`useDraftEditor`) takes. */
export const rulesetEditor = createEditorReducer<DraftDocument, Selection>({
  signature: documentSignature,
  sameSelection: (a, b) => a.section === b.section,
  // Every section exists in every document, so a reload never leaves the selection pointing at nothing.
  clampSelection: (_doc, selection) => selection,
});

export function initEditorState(doc: DraftDocument, rev: number, selection: Selection = DEFAULT_SELECTION): EditorState {
  return rulesetEditor.init(doc, rev, selection);
}
