/**
 * The editor's state machine. The document, the dirty baseline, the draft revision the server knows, the selected
 * part of the form and the state of the last save live in one reducer, so every transition is a pure function and
 * is tested without a DOM.
 *
 * Dirty = the canonical JSON of the document differs from the baseline (the canonical JSON of the last saved or
 * loaded document). A save that finishes while the user kept typing therefore leaves the editor dirty.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';
import { documentSignature, type DraftDocument } from './document';
import { DEFAULT_SELECTION, type Selection } from './targets';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  | { status: 'error'; error: ApiErrorLike }
  | { status: 'conflict'; serverRev: number };

export interface EditorState {
  doc: DraftDocument;
  /** `documentSignature` of the last saved or loaded document. */
  baseline: string;
  /** The draft revision the server holds as far as this editor knows; the next save sends it. */
  rev: number;
  selection: Selection;
  save: SaveState;
}

export type EditorAction =
  | { type: 'edit'; next: DraftDocument }
  | { type: 'select'; selection: Selection }
  | { type: 'save_start' }
  /** `saved` is the document that was sent; an edit made while saving stays dirty. */
  | { type: 'save_ok'; rev: number; saved: DraftDocument; at: string }
  | { type: 'save_fail'; error: ApiErrorLike }
  | { type: 'save_conflict'; serverRev: number }
  /** Adopt the server's document: clean. */
  | { type: 'reload'; doc: DraftDocument; rev: number }
  /** After a conflict: keep the local document, adopt the server's revision, stay dirty. */
  | { type: 'keep_mine' };

export function initEditorState(doc: DraftDocument, rev: number, selection: Selection = DEFAULT_SELECTION): EditorState {
  return { doc, baseline: documentSignature(doc), rev, selection, save: { status: 'idle' } };
}

export function isDirty(state: EditorState): boolean {
  return documentSignature(state.doc) !== state.baseline;
}

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

/** A selection that points past the end of its list (a reloaded document is shorter) moves to the last item. */
function clampSelection(doc: DraftDocument, selection: Selection): Selection {
  const count = itemCount(doc, selection);
  const index = Math.max(0, Math.min(selection.index, count - 1));
  return index === selection.index ? selection : { ...selection, index };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit': {
      if (action.next === state.doc) return state;
      // A conflict stays until the user resolves it; a "saved" note no longer describes the document.
      const save: SaveState = state.save.status === 'saved' ? { status: 'idle' } : state.save;
      return { ...state, doc: action.next, save };
    }
    case 'select': {
      const same = state.selection.section === action.selection.section && state.selection.index === action.selection.index;
      return same ? state : { ...state, selection: action.selection };
    }
    case 'save_start':
      // A save waits for the user's decision on a conflict, and never overlaps another save.
      return state.save.status === 'saving' || state.save.status === 'conflict' ? state : { ...state, save: { status: 'saving' } };
    case 'save_ok':
      return {
        ...state,
        baseline: documentSignature(action.saved),
        rev: action.rev,
        save: { status: 'saved', at: action.at },
      };
    case 'save_fail':
      return { ...state, save: { status: 'error', error: action.error } };
    case 'save_conflict':
      return { ...state, save: { status: 'conflict', serverRev: action.serverRev } };
    case 'reload':
      return {
        doc: action.doc,
        baseline: documentSignature(action.doc),
        rev: action.rev,
        selection: clampSelection(action.doc, state.selection),
        save: { status: 'idle' },
      };
    case 'keep_mine':
      return state.save.status === 'conflict' ? { ...state, rev: state.save.serverRev, save: { status: 'idle' } } : state;
    default:
      return state;
  }
}
