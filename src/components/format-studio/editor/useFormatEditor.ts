'use client';

import { useCallback, useMemo } from 'react';
import { useDraftEditor, type DraftEditorModel } from '@/components/studio-shell/useDraftEditor';
import type { CompileResult } from '@/lib/format-kit/client';
import { classifyApiError, loadFormatDetail, saveDraftRequest } from '@/lib/format-studio/editor/api';
import { normalizeDraft, type DraftDocument } from '@/lib/format-studio/editor/document';
import { compileDraft, issueCounts, toIssueRows, type IssueRow } from '@/lib/format-studio/editor/preview';
import { formatEditor } from '@/lib/format-studio/editor/state';
import { DEFAULT_SELECTION, type Selection } from '@/lib/format-studio/editor/targets';
import type { FetchLike } from '@/lib/studio-core/request';

export type { ReloadOutcome, SaveOutcome } from '@/components/studio-shell/useDraftEditor';

interface UseFormatEditorArgs {
  definitionId: string;
  initialDoc: DraftDocument;
  initialRev: number;
  /** Ids of the rulesets that exist, so a stage naming a missing one is flagged. */
  rulesetIds: ReadonlySet<string>;
  /** For tests: a stand-in for `fetch`. */
  fetchImpl?: FetchLike;
}

export interface FormatEditorModel extends DraftEditorModel<DraftDocument, Selection, CompileResult> {
  rows: IssueRow[];
  counts: { errors: number; warnings: number; notes: number };
}

/**
 * The format editor's state and its two requests: the shared draft hook (`studio-shell/useDraftEditor`: reducer,
 * deferred compile, save and reload flows) with the format document, `compileDraft` and the format routes, plus the
 * issue rows and counts the toolbar and the Issues tab read. Nothing here renders.
 */
export function useFormatEditor({ definitionId, initialDoc, initialRev, rulesetIds, fetchImpl }: UseFormatEditorArgs): FormatEditorModel {
  const compile = useCallback((doc: DraftDocument) => compileDraft(doc, rulesetIds), [rulesetIds]);
  const saveRequest = useCallback((rev: number, doc: DraftDocument) => saveDraftRequest(definitionId, rev, doc, fetchImpl), [definitionId, fetchImpl]);
  const loadDraft = useCallback(async () => {
    const outcome = await loadFormatDetail(definitionId, fetchImpl);
    return outcome.ok ? { ok: true as const, data: outcome.data.draft } : outcome;
  }, [definitionId, fetchImpl]);

  const model = useDraftEditor({
    editor: formatEditor,
    initialDoc,
    initialRev,
    initialSelection: DEFAULT_SELECTION,
    compile,
    saveRequest,
    loadDraft,
    normalize: normalizeDraft,
    classify: classifyApiError,
  });

  const rows = useMemo(() => toIssueRows(model.result.diagnostics), [model.result]);
  const counts = useMemo(() => issueCounts(model.result.diagnostics), [model.result]);
  return { ...model, rows, counts };
}
