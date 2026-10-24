'use client';

import { useCallback, useDeferredValue, useMemo, useReducer, useRef } from 'react';
import type { ApiErrorLike } from '@/i18n/api-errors';
import type { CompileResult } from '@/lib/format-kit/client';
import { documentSignature, normalizeDraft, type DraftDocument } from '@/lib/format-studio/editor/document';
import { classifyApiError, loadFormatDetail, saveDraftRequest, type FetchLike } from '@/lib/format-studio/editor/api';
import { compileDraft, issueCounts, toIssueRows, type IssueRow } from '@/lib/format-studio/editor/preview';
import { editorReducer, initEditorState, type EditorAction, type EditorState } from '@/lib/format-studio/editor/state';
import type { Selection } from '@/lib/format-studio/editor/targets';

export type SaveOutcome = 'saved' | 'clean' | 'busy' | 'conflict' | 'failed';
export type ReloadOutcome = { ok: true } | { ok: false; reason: 'request'; error: ApiErrorLike } | { ok: false; reason: 'unreadable' };

interface UseFormatEditorArgs {
  definitionId: string;
  initialDoc: DraftDocument;
  initialRev: number;
  /** Ids of the rulesets that exist, so a stage naming a missing one is flagged. */
  rulesetIds: ReadonlySet<string>;
  /** For tests: a stand-in for `fetch`. */
  fetchImpl?: FetchLike;
}

export interface FormatEditorModel {
  state: EditorState;
  /** The latest state, readable from async flows without a stale closure. */
  latest: () => EditorState;
  dirty: boolean;
  edit: (next: DraftDocument) => void;
  select: (selection: Selection) => void;
  /** The deferred document the previews follow, and its compile. */
  previewDoc: DraftDocument;
  result: CompileResult;
  rows: IssueRow[];
  counts: { errors: number; warnings: number; notes: number };
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
 * The editor's state and its two requests. The reducer (`editorReducer`) owns the document, the dirty baseline,
 * the revision and the save status; this hook adds the compile of the deferred document and the save and reload
 * flows around the request layer. Nothing here renders.
 */
export function useFormatEditor({ definitionId, initialDoc, initialRev, rulesetIds, fetchImpl }: UseFormatEditorArgs): FormatEditorModel {
  const [state, rawDispatch] = useReducer(editorReducer, undefined, () => initEditorState(initialDoc, initialRev));
  // The reducer is pure, so a mirror that applies each action as it is dispatched is always the state React will
  // render next. Async flows (save, then publish) read it right after an `await`, before React has rendered.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: EditorAction) => {
    stateRef.current = editorReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

  const dirty = useMemo(() => documentSignature(state.doc) !== state.baseline, [state.doc, state.baseline]);

  const deferredDoc = useDeferredValue(state.doc);
  const result = useMemo(() => compileDraft(deferredDoc, rulesetIds), [deferredDoc, rulesetIds]);
  const rows = useMemo(() => toIssueRows(result.diagnostics), [result]);
  const counts = useMemo(() => issueCounts(result.diagnostics), [result]);

  const edit = useCallback((next: DraftDocument) => dispatch({ type: 'edit', next }), [dispatch]);
  const select = useCallback((selection: Selection) => dispatch({ type: 'select', selection }), [dispatch]);
  const latest = useCallback(() => stateRef.current, []);

  const save = useCallback<FormatEditorModel['save']>(
    async (options) => {
      const current = stateRef.current;
      if (current.save.status === 'saving') return 'busy';
      if (current.save.status === 'conflict' && options?.rev === undefined) return 'conflict';
      const isDirtyNow = documentSignature(current.doc) !== current.baseline;
      if (!isDirtyNow && options?.force !== true) return 'clean';

      const sent = current.doc;
      dispatch({ type: 'save_start' });
      const outcome = await saveDraftRequest(definitionId, options?.rev ?? current.rev, sent, fetchImpl);
      if (outcome.ok) {
        dispatch({ type: 'save_ok', rev: outcome.data.draft_rev, saved: sent, at: outcome.data.updated_at });
        return 'saved';
      }
      const classified = classifyApiError(outcome.error, outcome.status);
      if (classified.kind === 'stale_revision') {
        dispatch({ type: 'save_conflict', serverRev: classified.staleRev ?? current.rev });
        return 'conflict';
      }
      dispatch({ type: 'save_fail', error: outcome.error });
      return 'failed';
    },
    [definitionId, dispatch, fetchImpl],
  );

  const keepMine = useCallback(() => dispatch({ type: 'keep_mine' }), [dispatch]);

  const markConflict = useCallback<FormatEditorModel['markConflict']>(
    (serverRev) => {
      const current = stateRef.current;
      const known = current.save.status === 'conflict' ? current.save.serverRev : current.rev;
      dispatch({ type: 'save_conflict', serverRev: serverRev ?? known });
    },
    [dispatch],
  );

  const reload = useCallback<FormatEditorModel['reload']>(async () => {
    const outcome = await loadFormatDetail(definitionId, fetchImpl);
    if (!outcome.ok) return { ok: false, reason: 'request', error: outcome.error };
    const draft = outcome.data.draft;
    const normalised = draft === null ? null : normalizeDraft(draft.document);
    if (draft === null || normalised === null || !normalised.ok) return { ok: false, reason: 'unreadable' };
    dispatch({ type: 'reload', doc: normalised.doc, rev: draft.draft_rev });
    return { ok: true };
  }, [definitionId, dispatch, fetchImpl]);

  return { state, latest, dirty, edit, select, previewDoc: deferredDoc, result, rows, counts, save, keepMine, markConflict, reload };
}
