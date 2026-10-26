/**
 * The format editor's state machine: the studio core's editor reducer (`@/lib/studio-core/editor-state`) bound to the
 * format document and its selection. The document, the dirty baseline, the draft revision the server knows, the
 * selected part of the form and the state of the last save live in one reducer, so every transition is a pure function
 * and is tested without a DOM.
 *
 * Dirty = the canonical JSON of the document differs from the baseline (the canonical JSON of the last saved or
 * loaded document). A save that finishes while the user kept typing therefore leaves the editor dirty.
 */
import {
  createEditorReducer,
  type SaveState,
  type StudioEditorAction,
  type StudioEditorState,
} from '@/lib/studio-core/editor-state';
import { documentSignature, type DraftDocument } from './document';
import type { Selection } from './targets';

export type { SaveState };
export type EditorState = StudioEditorState<DraftDocument, Selection>;
export type EditorAction = StudioEditorAction<DraftDocument, Selection>;

function itemCount(doc: DraftDocument, selection: Selection): number {
  switch (selection.section) {
    case 'stage':
      return doc.stages.length;
    case 'edges':
      return doc.edges.length;
    case 'rules':
      return doc.rules.length;
    case 'text':
      return doc.text.sections.length;
    default:
      return 1;
  }
}

/** The reducer bundle of the format editor: what the shared draft hook (`useDraftEditor`) takes. */
export const formatEditor = createEditorReducer<DraftDocument, Selection>({
  signature: documentSignature,
  sameSelection: (a, b) => a.section === b.section && a.index === b.index,
  // A selection that points past the end of its list (a reloaded document is shorter) moves to the last item.
  clampSelection: (doc, selection) => {
    const count = itemCount(doc, selection);
    const index = Math.max(0, Math.min(selection.index, count - 1));
    return index === selection.index ? selection : { ...selection, index };
  },
});
