/**
 * The state machine of a studio editor (the Format Studio's and the Ruleset Studio's). The document, the dirty baseline,
 * the draft revision the server knows, the selected part of the form and the state of the last save live in one reducer,
 * so every transition is a pure function and is tested without a DOM.
 *
 * Dirty = the signature (canonical JSON) of the document differs from the baseline (the signature of the last saved or
 * loaded document). A save that finishes while the user kept typing therefore leaves the editor dirty.
 *
 * `createEditorReducer` binds what differs between studios: the signature of a document, how a selection is compared,
 * and how a selection that points past the end of its list is moved after a reload.
 */
import type { ApiErrorLike } from '@/i18n/api-errors';

export type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; at: string }
  | { status: 'error'; error: ApiErrorLike }
  | { status: 'conflict'; serverRev: number };

export interface StudioEditorState<TDoc, TSel> {
  doc: TDoc;
  /** The signature of the last saved or loaded document. */
  baseline: string;
  /** The draft revision the server holds as far as this editor knows; the next save sends it. */
  rev: number;
  selection: TSel;
  save: SaveState;
}

export type StudioEditorAction<TDoc, TSel> =
  | { type: 'edit'; next: TDoc }
  | { type: 'select'; selection: TSel }
  | { type: 'save_start' }
  /** `saved` is the document that was sent; an edit made while saving stays dirty. */
  | { type: 'save_ok'; rev: number; saved: TDoc; at: string }
  | { type: 'save_fail'; error: ApiErrorLike }
  | { type: 'save_conflict'; serverRev: number }
  /** Adopt the server's document: clean. */
  | { type: 'reload'; doc: TDoc; rev: number }
  /** After a conflict: keep the local document, adopt the server's revision, stay dirty. */
  | { type: 'keep_mine' };

export interface EditorReducerKit<TDoc, TSel> {
  /** The canonical string of a document: key order never matters. */
  signature: (doc: TDoc) => string;
  sameSelection: (a: TSel, b: TSel) => boolean;
  /** A selection that points past the end of its list (a reloaded document is shorter) moves to the last item. */
  clampSelection: (doc: TDoc, selection: TSel) => TSel;
}

export interface EditorReducer<TDoc, TSel> {
  init: (doc: TDoc, rev: number, selection: TSel) => StudioEditorState<TDoc, TSel>;
  isDirty: (state: StudioEditorState<TDoc, TSel>) => boolean;
  reducer: (state: StudioEditorState<TDoc, TSel>, action: StudioEditorAction<TDoc, TSel>) => StudioEditorState<TDoc, TSel>;
}

export function createEditorReducer<TDoc, TSel>(kit: EditorReducerKit<TDoc, TSel>): EditorReducer<TDoc, TSel> {
  type State = StudioEditorState<TDoc, TSel>;
  type Action = StudioEditorAction<TDoc, TSel>;

  return {
    init: (doc, rev, selection) => ({ doc, baseline: kit.signature(doc), rev, selection, save: { status: 'idle' } }),

    isDirty: (state) => kit.signature(state.doc) !== state.baseline,

    reducer(state: State, action: Action): State {
      switch (action.type) {
        case 'edit': {
          if (action.next === state.doc) return state;
          // A conflict stays until the user resolves it; a "saved" note no longer describes the document.
          const save: SaveState = state.save.status === 'saved' ? { status: 'idle' } : state.save;
          return { ...state, doc: action.next, save };
        }
        case 'select':
          return kit.sameSelection(state.selection, action.selection) ? state : { ...state, selection: action.selection };
        case 'save_start':
          // A save waits for the user's decision on a conflict, and never overlaps another save.
          return state.save.status === 'saving' || state.save.status === 'conflict' ? state : { ...state, save: { status: 'saving' } };
        case 'save_ok':
          return { ...state, baseline: kit.signature(action.saved), rev: action.rev, save: { status: 'saved', at: action.at } };
        case 'save_fail':
          return { ...state, save: { status: 'error', error: action.error } };
        case 'save_conflict':
          return { ...state, save: { status: 'conflict', serverRev: action.serverRev } };
        case 'reload':
          return {
            doc: action.doc,
            baseline: kit.signature(action.doc),
            rev: action.rev,
            selection: kit.clampSelection(action.doc, state.selection),
            save: { status: 'idle' },
          };
        case 'keep_mine':
          return state.save.status === 'conflict' ? { ...state, rev: state.save.serverRev, save: { status: 'idle' } } : state;
        default:
          return state;
      }
    },
  };
}
