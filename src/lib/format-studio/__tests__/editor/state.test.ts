import { describe, expect, it } from 'vitest';
import { PRESETS } from '@/lib/format-kit/client';
import { documentSignature, normalizeDraft, type DraftDocument } from '../../editor/document';
import { addStage, setTheme } from '../../editor/ops';
import { formatEditor, type EditorAction, type EditorState } from '../../editor/state';
import { DEFAULT_SELECTION, type Selection } from '../../editor/targets';

const { isDirty, reducer: editorReducer } = formatEditor;
const initEditorState = (doc: DraftDocument, rev: number, selection: Selection = DEFAULT_SELECTION): EditorState => formatEditor.init(doc, rev, selection);

function preset(id: string): DraftDocument {
  const found = PRESETS.find((entry) => entry.id === id);
  const result = normalizeDraft(structuredClone(found?.definition));
  if (!result.ok) throw new Error('preset does not normalise');
  return result.doc;
}

const AT = '2026-10-24T10:00:00.000Z';

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

describe('initEditorState', () => {
  it('starts clean, idle, on the first stage', () => {
    const doc = preset('cup');
    const state = initEditorState(doc, 4);
    expect(state).toEqual({ doc, baseline: documentSignature(doc), rev: 4, selection: DEFAULT_SELECTION, save: { status: 'idle' } });
    expect(isDirty(state)).toBe(false);
  });

  it('takes a selection', () => {
    expect(initEditorState(preset('cup'), 1, { section: 'edges', index: 0 }).selection).toEqual({ section: 'edges', index: 0 });
  });
});

describe('edit and select', () => {
  it('an edit makes the editor dirty and undoing it makes it clean again', () => {
    const doc = preset('cup');
    const state = run(initEditorState(doc, 1), { type: 'edit', next: setTheme(doc, 'sakura') });
    expect(isDirty(state)).toBe(true);
    expect(isDirty(run(state, { type: 'edit', next: doc }))).toBe(false);
  });

  it('an edit with the same object is a no-op', () => {
    const state = initEditorState(preset('cup'), 1);
    expect(editorReducer(state, { type: 'edit', next: state.doc })).toBe(state);
  });

  it('opening a draft never starts dirty, whatever the key order of the stored JSON', () => {
    const stored = JSON.parse(JSON.stringify(preset('swiss-top-cut'))) as unknown;
    const result = normalizeDraft(stored);
    if (!result.ok) throw new Error('shape');
    expect(isDirty(initEditorState(result.doc, 1))).toBe(false);
  });

  it('select changes the selection and is a no-op for the same one', () => {
    const state = initEditorState(preset('cup'), 1);
    const next = editorReducer(state, { type: 'select', selection: { section: 'rules', index: 2 } });
    expect(next.selection).toEqual({ section: 'rules', index: 2 });
    expect(editorReducer(next, { type: 'select', selection: { section: 'rules', index: 2 } })).toBe(next);
  });

  it('an edit after a save drops the "saved" note', () => {
    const doc = preset('cup');
    const saved = run(initEditorState(doc, 1), { type: 'save_start' }, { type: 'save_ok', rev: 2, saved: doc, at: AT });
    expect(saved.save).toEqual({ status: 'saved', at: AT });
    expect(editorReducer(saved, { type: 'edit', next: setTheme(doc, 'plaza') }).save).toEqual({ status: 'idle' });
  });
});

describe('saving', () => {
  it('save_start marks the save as running and a second start does not stack', () => {
    const state = initEditorState(preset('cup'), 1);
    const saving = editorReducer(state, { type: 'save_start' });
    expect(saving.save).toEqual({ status: 'saving' });
    expect(editorReducer(saving, { type: 'save_start' })).toBe(saving);
  });

  it('save_ok adopts the revision and moves the baseline to what was saved', () => {
    const doc = preset('cup');
    const edited = setTheme(doc, 'sakura');
    const state = run(initEditorState(doc, 1), { type: 'edit', next: edited }, { type: 'save_start' });
    expect(isDirty(state)).toBe(true);
    const done = editorReducer(state, { type: 'save_ok', rev: 2, saved: edited, at: AT });
    expect(done.rev).toBe(2);
    expect(done.baseline).toBe(documentSignature(edited));
    expect(done.save).toEqual({ status: 'saved', at: AT });
    expect(isDirty(done)).toBe(false);
  });

  it('an edit made while saving stays dirty after the save finishes', () => {
    const doc = preset('cup');
    const sent = setTheme(doc, 'sakura');
    const later = setTheme(doc, 'plaza');
    const state = run(
      initEditorState(doc, 1),
      { type: 'edit', next: sent },
      { type: 'save_start' },
      { type: 'edit', next: later },
      { type: 'save_ok', rev: 2, saved: sent, at: AT },
    );
    expect(state.doc).toBe(later);
    expect(state.baseline).toBe(documentSignature(sent));
    expect(isDirty(state)).toBe(true);
    expect(state.rev).toBe(2);
  });

  it('save_fail keeps the document and its dirty state and reports the error', () => {
    const doc = preset('cup');
    const error = { code: 'rate_limited', params: { seconds: 30 } };
    const state = run(initEditorState(doc, 1), { type: 'edit', next: setTheme(doc, 'sakura') }, { type: 'save_start' }, { type: 'save_fail', error });
    expect(state.save).toEqual({ status: 'error', error });
    expect(state.rev).toBe(1);
    expect(isDirty(state)).toBe(true);
  });

  it('a failed save can be started again', () => {
    const state = run(initEditorState(preset('cup'), 1), { type: 'save_start' }, { type: 'save_fail', error: { code: 'network_error' } });
    expect(editorReducer(state, { type: 'save_start' }).save).toEqual({ status: 'saving' });
  });
});

describe('conflict', () => {
  const doc = preset('cup');
  const mine = setTheme(doc, 'sakura');

  function conflicted(): EditorState {
    return run(initEditorState(doc, 1), { type: 'edit', next: mine }, { type: 'save_start' }, { type: 'save_conflict', serverRev: 5 });
  }

  it('save_conflict records the revision the server holds and does not change the document', () => {
    const state = conflicted();
    expect(state.save).toEqual({ status: 'conflict', serverRev: 5 });
    expect(state.doc).toBe(mine);
    expect(state.rev).toBe(1);
  });

  it('keep_mine adopts the server revision, keeps the document and stays dirty', () => {
    const state = editorReducer(conflicted(), { type: 'keep_mine' });
    expect(state.rev).toBe(5);
    expect(state.doc).toBe(mine);
    expect(state.save).toEqual({ status: 'idle' });
    expect(isDirty(state)).toBe(true);
    expect(editorReducer(state, { type: 'save_start' }).save).toEqual({ status: 'saving' });
  });

  it('reload adopts the server document, revision and baseline, and is clean', () => {
    const theirs = setTheme(doc, 'plaza');
    const state = editorReducer(conflicted(), { type: 'reload', doc: theirs, rev: 5 });
    expect(state.doc).toBe(theirs);
    expect(state.rev).toBe(5);
    expect(state.baseline).toBe(documentSignature(theirs));
    expect(state.save).toEqual({ status: 'idle' });
    expect(isDirty(state)).toBe(false);
  });

  it('a conflict survives an edit', () => {
    const state = editorReducer(conflicted(), { type: 'edit', next: setTheme(mine, 'plaza') });
    expect(state.save).toEqual({ status: 'conflict', serverRev: 5 });
  });

  it('a save cannot start while a conflict is unresolved', () => {
    const state = conflicted();
    expect(editorReducer(state, { type: 'save_start' })).toBe(state);
  });

  it('keep_mine outside a conflict does nothing', () => {
    const state = initEditorState(doc, 3);
    expect(editorReducer(state, { type: 'keep_mine' })).toBe(state);
  });
});

describe('reload', () => {
  it('moves a selection that points past the end of the new document to its last item', () => {
    const long = addStage(addStage(preset('cup')).doc).doc;
    expect(long.stages).toHaveLength(4);
    const state = initEditorState(long, 1, { section: 'stage', index: 3 });
    const reloaded = editorReducer(state, { type: 'reload', doc: preset('cup'), rev: 2 });
    expect(reloaded.selection).toEqual({ section: 'stage', index: 1 });
  });

  it('keeps a selection that still exists, and handles a list that is now empty', () => {
    const cup = preset('cup');
    const state = initEditorState(cup, 1, { section: 'stage', index: 1 });
    expect(editorReducer(state, { type: 'reload', doc: cup, rev: 2 }).selection).toEqual({ section: 'stage', index: 1 });
    const edges = initEditorState(cup, 1, { section: 'edges', index: 0 });
    const none = { ...cup, edges: [] };
    expect(editorReducer(edges, { type: 'reload', doc: none, rev: 2 }).selection).toEqual({ section: 'edges', index: 0 });
  });
});
