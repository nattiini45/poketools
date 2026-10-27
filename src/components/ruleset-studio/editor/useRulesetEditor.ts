'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDraftEditor, type DraftEditorModel } from '@/components/studio-shell/useDraftEditor';
import { useDataLocale, useT } from '@/i18n/client';
import { rulesetStudioSummaryMessages } from '@/i18n/messages/ruleset-studio/summary';
import { clauseName } from '@/lib/pkmn/clauses';
import { getPreset } from '@/lib/pkmn/format-catalog';
import type { PresetList, PresetRules } from '@/lib/pkmn/preset-rules';
import type { CompileResult } from '@/lib/ruleset-kit/compile';
import { resetCategory, setClause, setMode } from '@/lib/ruleset-kit/ops';
import { RULESET_CATEGORIES, type RulesetBase, type RulesetCategory } from '@/lib/ruleset-kit/types';
import { classifyApiError, loadRulesetDetail, saveDraftRequest } from '@/lib/ruleset-studio/editor/api';
import { fetchEntryIndex, fetchPresetRules, indexUrl, peekPresetRules, type CatalogQuery } from '@/lib/ruleset-studio/editor/catalog-client';
import { normalizeDraft, type DraftDocument } from '@/lib/ruleset-studio/editor/document';
import { applyBulk, describeResult, type BulkAction } from '@/lib/ruleset-studio/editor/picker/bulk';
import type { EntryIndex } from '@/lib/ruleset-studio/editor/picker/entry-index';
import {
  EMPTY_HISTORY,
  canRedo,
  canUndo,
  recordDiff,
  redo,
  undo,
  type History,
  type HistoryEntry,
  type HistoryTarget,
} from '@/lib/ruleset-studio/editor/picker/history';
import { compileDraft, issueCounts, toIssueRows, type IssueRow } from '@/lib/ruleset-studio/editor/preview';
import { rulesetEditor } from '@/lib/ruleset-studio/editor/state';
import { DEFAULT_SELECTION, type Selection } from '@/lib/ruleset-studio/editor/targets';
import { MAX_IDS_PER_LIST } from '@/lib/ruleset-kit/limits';
import { KIND_OF, displayNameOf } from '@/lib/ruleset-studio/editor/picker/display';

export type { ReloadOutcome, SaveOutcome } from '@/components/studio-shell/useDraftEditor';

interface UseRulesetEditorArgs {
  definitionId: string;
  initialDoc: DraftDocument;
  initialRev: number;
  /** The resolved rules of the draft's base preset, read on the server, so the first paint needs no request. */
  initialPreset: PresetRules | null;
}

/** What the editor knows about the document's generation, universe and game type, without waiting for any request. */
export interface Frame {
  gen: number;
  scope: 'standard' | 'national';
  doubles: boolean;
  /** A Champions preset the catalog rows extend for. */
  rosterPreset: string | null;
}

export function frameOf(base: RulesetBase): Frame {
  if (base.kind === 'blank') return { gen: base.gen, scope: base.universe, doubles: base.doubles, rosterPreset: null };
  const preset = getPreset(base.preset);
  if (preset === undefined) return { gen: 9, scope: 'standard', doubles: false, rosterPreset: null };
  return { gen: preset.gen, scope: preset.universe, doubles: preset.gameType === 'doubles', rosterPreset: preset.mod === 'champions' ? preset.id : null };
}

export type PresetStatus = 'none' | 'loading' | 'ready' | 'error';

export interface RulesetEditorModel extends DraftEditorModel<DraftDocument, Selection, CompileResult> {
  rows: IssueRow[];
  counts: { errors: number; warnings: number; notes: number };
  /** Compiles any document with the editor's current preset and catalogs (the publish dialog compiles the live document, not the deferred one). */
  compileNow: (doc: DraftDocument) => CompileResult;
  frame: Frame;
  /** The resolved base preset (null for a blank base or while it loads). */
  preset: PresetRules | null;
  presetStatus: PresetStatus;
  retryPreset: () => void;
  /** Loads (or reads from the cache) the rules of any catalog preset; the preset browser and the rebase dialog use it. */
  loadPreset: (id: string) => Promise<PresetRules | null>;
  /** The preset's list for a category, null for a blank base. */
  baseList: (category: RulesetCategory) => PresetList | null;
  /** English-name lookups of the categories whose catalog has loaded. */
  indexes: Partial<Record<RulesetCategory, EntryIndex>>;
  /** The display name of an entry in the reader's data language (the id when the catalog is not loaded). */
  nameOf: (category: RulesetCategory, id: string) => string;
  /** Applies a list action to ids of a category, records it for undo and announces it. */
  act: (category: RulesetCategory, action: BulkAction, ids: readonly string[]) => void;
  setListMode: (category: RulesetCategory, mode: 'block' | 'allow', seed?: readonly string[]) => void;
  resetList: (category: RulesetCategory) => void;
  setClauseOn: (id: string, on: boolean) => void;
  /** Replaces the whole document by an edit that does not belong to one list (a rebase, the tour bans, a fix). History is cleared. */
  replaceDocument: (next: DraftDocument) => void;
  history: History;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  /** The last list edit in words, for the polite live region. */
  announcement: string;
}

/** What the live region says, as data: the sentence is built during render, so a language switch re-words it. */
type Announcement =
  | { type: 'change'; action: HistoryEntry['action']; count: number; category: RulesetCategory; firstId: string | null; capped: boolean }
  | { type: 'mode'; mode: 'block' | 'allow' }
  | { type: 'clause'; id: string; on: boolean }
  | { type: 'undone' | 'redone'; entry: HistoryEntry };

function catalogQueryOf(category: RulesetCategory, frame: Frame): CatalogQuery {
  return { kind: KIND_OF[category], gen: frame.gen, scope: frame.scope, preset: frame.rosterPreset };
}

/** The ids the loaded catalogs know per category for a frame (categories whose catalog has not loaded are left out). */
function knownOf(catalogs: Readonly<Record<string, EntryIndex>>, frame: Frame): Partial<Record<RulesetCategory, ReadonlySet<string>>> {
  const out: Partial<Record<RulesetCategory, ReadonlySet<string>>> = {};
  for (const category of RULESET_CATEGORIES) {
    const index = catalogs[indexUrl(catalogQueryOf(category, frame))];
    if (index !== undefined) out[category] = index.ids;
  }
  return out;
}

/**
 * The ruleset editor's state: the shared draft hook (`useDraftEditor`: reducer, deferred compile, save and reload flows)
 * with the ruleset document, the compile of the kit and the library routes, plus what only this editor has: the resolved base
 * preset (fetched once, seeded by the server), the entry catalogs of the categories in use (names for the summary and the
 * `known` ids of the compile), the undo history of list edits and the announcements of the live region. Nothing here renders.
 */
export function useRulesetEditor({ definitionId, initialDoc, initialRev, initialPreset }: UseRulesetEditorArgs): RulesetEditorModel {
  const t = useT(rulesetStudioSummaryMessages);
  const dataLocale = useDataLocale();
  const [spoken, setSpoken] = useState<Announcement | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);

  // ── The base preset ─────────────────────────────────────────────────────────
  const [presets, setPresets] = useState<Record<string, PresetRules>>(() => (initialPreset === null ? {} : { [initialPreset.id]: initialPreset }));
  const [failedPreset, setFailedPreset] = useState<string | null>(null);
  const [presetAttempt, setPresetAttempt] = useState(0);

  // ── The entry catalogs ──────────────────────────────────────────────────────
  const [catalogs, setCatalogs] = useState<Record<string, EntryIndex>>({});

  // The compile reads the base preset and the catalogs from the two maps above, never from the document it is not
  // given: the draft hook compiles a deferred document, and the frame is taken from that very document.
  const compile = useCallback(
    (document: DraftDocument) => {
      const id = document.base.kind === 'preset' ? document.base.preset : null;
      const resolved = id === null ? null : (presets[id] ?? null);
      return compileDraft(document, { preset: resolved, presetPending: id !== null && resolved === null, known: knownOf(catalogs, frameOf(document.base)) });
    },
    [presets, catalogs],
  );
  const saveRequest = useCallback((rev: number, doc: DraftDocument) => saveDraftRequest(definitionId, rev, doc), [definitionId]);
  const loadDraft = useCallback(async () => {
    const outcome = await loadRulesetDetail(definitionId);
    return outcome.ok ? { ok: true as const, data: outcome.data.draft } : outcome;
  }, [definitionId]);

  const model = useDraftEditor({
    editor: rulesetEditor,
    initialDoc,
    initialRev,
    initialSelection: DEFAULT_SELECTION,
    compile,
    saveRequest,
    loadDraft,
    normalize: normalizeDraft,
    classify: classifyApiError,
  });

  const doc = model.state.doc;
  const frame = useMemo(() => frameOf(doc.base), [doc.base]);
  const basePresetId = doc.base.kind === 'preset' ? doc.base.preset : null;
  const preset = basePresetId === null ? null : (presets[basePresetId] ?? null);

  useEffect(() => {
    if (basePresetId === null || presets[basePresetId] !== undefined) return;
    const controller = new AbortController();
    void fetchPresetRules(basePresetId, { signal: controller.signal }).then((outcome) => {
      if (controller.signal.aborted) return;
      if (outcome.ok) setPresets((current) => ({ ...current, [outcome.data.id]: outcome.data }));
      else setFailedPreset(basePresetId);
    });
    return () => controller.abort();
  }, [basePresetId, presets, presetAttempt]);

  const retryPreset = useCallback(() => {
    setFailedPreset(null);
    setPresetAttempt((n) => n + 1);
  }, []);

  const loadPreset = useCallback(
    async (id: string): Promise<PresetRules | null> => {
      const cached = peekPresetRules(id);
      const outcome = cached !== undefined ? { ok: true as const, data: cached } : await fetchPresetRules(id);
      if (!outcome.ok) return null;
      setPresets((current) => (current[id] !== undefined ? current : { ...current, [id]: outcome.data }));
      return outcome.data;
    },
    [],
  );

  // Load the catalog of every list in use and of the open section.
  const section = model.state.selection.section;
  const neededKey = RULESET_CATEGORIES.filter((category) => {
    const rules = doc[category];
    return category === section || rules.ban.length + rules.unban.length + (rules.allow?.length ?? 0) > 0;
  }).join(',');
  useEffect(() => {
    if (neededKey === '') return;
    const controller = new AbortController();
    for (const category of neededKey.split(',') as RulesetCategory[]) {
      const query = catalogQueryOf(category, frame);
      const key = indexUrl(query);
      void fetchEntryIndex(query, { signal: controller.signal }).then((outcome) => {
        if (controller.signal.aborted || !outcome.ok) return;
        setCatalogs((current) => (current[key] === undefined ? { ...current, [key]: outcome.data } : current));
      });
    }
    return () => controller.abort();
  }, [neededKey, frame]);

  const indexes = useMemo(() => {
    const out: Partial<Record<RulesetCategory, EntryIndex>> = {};
    for (const category of RULESET_CATEGORIES) {
      const index = catalogs[indexUrl(catalogQueryOf(category, frame))];
      if (index !== undefined) out[category] = index;
    }
    return out;
  }, [catalogs, frame]);

  const nameOf = useCallback(
    (category: RulesetCategory, id: string): string => {
      const entry = indexes[category]?.byId.get(id);
      return entry === undefined ? id : displayNameOf(KIND_OF[category], entry.name, dataLocale);
    },
    [indexes, dataLocale],
  );

  const baseList = useCallback((category: RulesetCategory): PresetList | null => preset?.[category] ?? null, [preset]);

  // ── List edits, history and announcements ──────────────────────────────────

  const describe = useCallback(
    (entry: Pick<HistoryEntry, 'action' | 'count' | 'firstId' | 'target'>): string => {
      const name = entry.firstId === null || entry.target === 'clauses' ? '' : nameOf(entry.target, entry.firstId);
      switch (entry.action) {
        case 'ban': return t('what.ban', { count: entry.count, name });
        case 'unban': return t('what.unban', { count: entry.count, name });
        case 'reset': return t('what.reset', { count: entry.count, name });
        case 'mode': return t('what.mode');
        default: return t('what.clause');
      }
    },
    [nameOf, t],
  );

  const announcement = useMemo(() => {
    if (spoken === null) return '';
    switch (spoken.type) {
      case 'change': {
        const name = spoken.firstId === null ? '' : nameOf(spoken.category, spoken.firstId);
        const parts: string[] = [];
        if (spoken.count === 0) parts.push(t('announce.nothing'));
        else if (spoken.action === 'ban') parts.push(t('announce.banned', { count: spoken.count, name }));
        else if (spoken.action === 'unban') parts.push(t('announce.unbanned', { count: spoken.count, name }));
        else parts.push(t('announce.reset', { count: spoken.count, name }));
        if (spoken.capped) parts.push(t('announce.capped', { max: MAX_IDS_PER_LIST }));
        return parts.join(' ');
      }
      case 'mode': return t(spoken.mode === 'allow' ? 'announce.modeAllow' : 'announce.modeBlock');
      case 'clause': return t(spoken.on ? 'announce.clauseOn' : 'announce.clauseOff', { name: clauseName(spoken.id) });
      case 'undone': return t('undone', { what: describe(spoken.entry) });
      case 'redone': return t('redone', { what: describe(spoken.entry) });
    }
  }, [spoken, describe, nameOf, t]);

  const record = useCallback((before: DraftDocument, after: DraftDocument, target: HistoryTarget, meta: Pick<HistoryEntry, 'count' | 'firstId' | 'action'>) => {
    setHistory((current) => recordDiff(current, before, after, target, meta));
  }, []);

  const act = useCallback<RulesetEditorModel['act']>(
    (category, action, ids) => {
      const before = model.latest().doc;
      const result = applyBulk(before, category, action, ids, baseList(category));
      const meta = describeResult(action, result);
      setSpoken({ type: 'change', category, capped: result.capped, ...meta });
      if (result.doc === before) return;
      model.edit(result.doc);
      record(before, result.doc, category, meta);
    },
    [baseList, model, record],
  );

  const setListMode = useCallback<RulesetEditorModel['setListMode']>(
    (category, mode, seed) => {
      const before = model.latest().doc;
      const next = setMode(before, category, mode, seed ?? []);
      if (next === before) return;
      model.edit(next);
      record(before, next, category, { count: 0, firstId: null, action: 'mode' });
      setSpoken({ type: 'mode', mode });
    },
    [model, record],
  );

  const resetList = useCallback<RulesetEditorModel['resetList']>(
    (category) => {
      const before = model.latest().doc;
      const result = resetCategory(before, category, baseList(category));
      const meta = describeResult('reset', result);
      setSpoken({ type: 'change', category, capped: false, ...meta });
      if (result.doc === before) return;
      model.edit(result.doc);
      record(before, result.doc, category, meta);
    },
    [baseList, model, record],
  );

  const setClauseOn = useCallback<RulesetEditorModel['setClauseOn']>(
    (id, on) => {
      const before = model.latest().doc;
      const next = setClause(before, id, on, preset?.clauses ?? []);
      if (next === before) return;
      model.edit(next);
      record(before, next, 'clauses', { count: 1, firstId: id, action: 'clause' });
      setSpoken({ type: 'clause', id, on });
    },
    [model, preset, record],
  );

  const replaceDocument = useCallback(
    (next: DraftDocument) => {
      model.edit(next);
      setHistory(EMPTY_HISTORY);
    },
    [model],
  );

  const undoEdit = useCallback(() => {
    const step = undo(history, model.latest().doc);
    if (step === null) return;
    setHistory(step.history);
    model.edit(step.doc);
    setSpoken({ type: 'undone', entry: step.entry });
  }, [history, model]);

  const redoEdit = useCallback(() => {
    const step = redo(history, model.latest().doc);
    if (step === null) return;
    setHistory(step.history);
    model.edit(step.doc);
    setSpoken({ type: 'redone', entry: step.entry });
  }, [history, model]);

  const rows = useMemo(() => toIssueRows(model.result.diagnostics), [model.result]);
  const counts = useMemo(() => issueCounts(model.result.diagnostics), [model.result]);

  return {
    ...model,
    rows,
    counts,
    compileNow: compile,
    frame,
    preset,
    presetStatus: basePresetId === null ? 'none' : preset !== null ? 'ready' : failedPreset === basePresetId ? 'error' : 'loading',
    retryPreset,
    loadPreset,
    baseList,
    indexes,
    nameOf,
    act,
    setListMode,
    resetList,
    setClauseOn,
    replaceDocument,
    history,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    undo: undoEdit,
    redo: redoEdit,
    announcement,
  };
}
