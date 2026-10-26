'use client';

import { useCallback, useDeferredValue, useMemo, useReducer, useRef } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { EditorReducer, StudioEditorAction, StudioEditorState } from '@/lib/studio-core/editor-state';
import type { ApiOutcome, ClassifiedError } from '@/lib/studio-core/request';

export type SaveOutcome = 'saved' | 'clean' | 'busy' | 'conflict' | 'failed';
export type ReloadOutcome = { ok: true } | { ok: false; reason: 'request'; error: ApiErrorLike } | { ok: false; reason: 'unreadable' };

/** What a save answers with. */
export interface SavedDraft {
  draft_rev: number;
  updated_at: string;
}

/** A draft the server holds, as the reload reads it (`null`: the viewer may not read the draft). */
export interface StoredDraft {
  document: unknown;
  draft_rev: number;
}

export interface DraftEditorConfig<TDoc, TSel, TResult> {
  /** The reducer of the studio (`createEditorReducer`), created once at module level. */
  editor: EditorReducer<TDoc, TSel>;
  initialDoc: TDoc;
  initialRev: number;
  initialSelection: TSel;
  /** Compiles the deferred document; must be stable between renders unless its inputs change (`useCallback`). */
  compile: (doc: TDoc) => TResult;
  /** The studio's draft save route: compare-and-set on the revision. */
  saveRequest: (rev: number, doc: TDoc) => Promise<ApiOutcome<SavedDraft>>;
  /** Fetches the draft the server holds. */
  loadDraft: () => Promise<ApiOutcome<StoredDraft | null>>;
  /** Turns a stored document into the editor's document, or says the form cannot show it. */
  normalize: (raw: unknown) => { ok: true; doc: TDoc } | { ok: false };
  /** The studio's `classifyApiError`. */
  classify: (error: ApiErrorLike, status?: number) => ClassifiedError;
}

export interface DraftEditorModel<TDoc, TSel, TResult> {
  state: StudioEditorState<TDoc, TSel>;
  /** The latest state, readable from async flows without a stale closure. */
  latest: () => StudioEditorState<TDoc, TSel>;
  dirty: boolean;
  edit: (next: TDoc) => void;
  select: (selection: TSel) => void;
  /** The deferred document the previews follow, and its compile. */
  previewDoc: TDoc;
  result: TResult;
  /**
   * Saves the draft. Without options it does nothing for a clean document and reopens the decision for a
   * conflict. `rev` and `force` are for "Keep mine": save at the server's revision even though nothing else changed.
   */
  save: (options?: { rev?: number; force?: boolean }) => Promise<SaveOutcome>;
  keepMine: () => void;
  /**
   * Records a conflict found by a request other than the save (a publish at a stale revision): the status becomes
   * `conflict` at the server's revision, `serverRev` when the response named it, else the one already known.
   */
  markConflict: (serverRev?: number) => void;
  reload: () => Promise<ReloadOutcome>;
}

/**
 * The state of a studio editor and its two requests. The reducer owns the document, the dirty baseline, the revision and
 * the save status; this hook adds the compile of the deferred document (typing never waits for it) and the save and
 * reload flows around the studio's request functions. Nothing here renders. The Format Studio's `useFormatEditor` and
 * the Ruleset Studio's editor hook are this hook with their own document, compile and requests.
 */
export function useDraftEditor<TDoc, TSel, TResult>(config: DraftEditorConfig<TDoc, TSel, TResult>): DraftEditorModel<TDoc, TSel, TResult> {
  const { editor, initialDoc, initialRev, initialSelection, compile, saveRequest, loadDraft, normalize, classify } = config;
  type State = StudioEditorState<TDoc, TSel>;
  type Action = StudioEditorAction<TDoc, TSel>;

  const [state, rawDispatch] = useReducer(editor.reducer, undefined, () => editor.init(initialDoc, initialRev, initialSelection));
  // The reducer is pure, so a mirror that applies each action as it is dispatched is always the state React will
  // render next. Async flows (save, then publish) read it right after an `await`, before React has rendered.
  const stateRef = useRef<State>(state);
  const dispatch = useCallback(
    (action: Action) => {
      stateRef.current = editor.reducer(stateRef.current, action);
      rawDispatch(action);
    },
    [editor],
  );

  const dirty = useMemo(() => editor.isDirty(state), [editor, state]);

  const deferredDoc = useDeferredValue(state.doc);
  const result = useMemo(() => compile(deferredDoc), [compile, deferredDoc]);

  const edit = useCallback((next: TDoc) => dispatch({ type: 'edit', next }), [dispatch]);
  const select = useCallback((selection: TSel) => dispatch({ type: 'select', selection }), [dispatch]);
  const latest = useCallback(() => stateRef.current, []);

  const save = useCallback<DraftEditorModel<TDoc, TSel, TResult>['save']>(
    async (options) => {
      const current = stateRef.current;
      if (current.save.status === 'saving') return 'busy';
      if (current.save.status === 'conflict' && options?.rev === undefined) return 'conflict';
      if (!editor.isDirty(current) && options?.force !== true) return 'clean';

      const sent = current.doc;
      dispatch({ type: 'save_start' });
      const outcome = await saveRequest(options?.rev ?? current.rev, sent);
      if (outcome.ok) {
        dispatch({ type: 'save_ok', rev: outcome.data.draft_rev, saved: sent, at: outcome.data.updated_at });
        return 'saved';
      }
      const classified = classify(outcome.error, outcome.status);
      if (classified.kind === 'stale_revision') {
        dispatch({ type: 'save_conflict', serverRev: classified.staleRev ?? current.rev });
        return 'conflict';
      }
      dispatch({ type: 'save_fail', error: outcome.error });
      return 'failed';
    },
    [classify, dispatch, editor, saveRequest],
  );

  const keepMine = useCallback(() => dispatch({ type: 'keep_mine' }), [dispatch]);

  const markConflict = useCallback<DraftEditorModel<TDoc, TSel, TResult>['markConflict']>(
    (serverRev) => {
      const current = stateRef.current;
      const known = current.save.status === 'conflict' ? current.save.serverRev : current.rev;
      dispatch({ type: 'save_conflict', serverRev: serverRev ?? known });
    },
    [dispatch],
  );

  const reload = useCallback<DraftEditorModel<TDoc, TSel, TResult>['reload']>(async () => {
    const outcome = await loadDraft();
    if (!outcome.ok) return { ok: false, reason: 'request', error: outcome.error };
    const draft = outcome.data;
    const normalised = draft === null ? null : normalize(draft.document);
    if (draft === null || normalised === null || !normalised.ok) return { ok: false, reason: 'unreadable' };
    dispatch({ type: 'reload', doc: normalised.doc, rev: draft.draft_rev });
    return { ok: true };
  }, [dispatch, loadDraft, normalize]);

  return { state, latest, dirty, edit, select, previewDoc: deferredDoc, result, save, keepMine, markConflict, reload };
}
