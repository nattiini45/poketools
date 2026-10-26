import { describe, expect, it } from 'vitest';
import { createEditorReducer, type StudioEditorAction, type StudioEditorState } from '../editor-state';

// A toy studio: the document is a list of names, the selection an index into it.
type Doc = { names: string[] };
type Sel = { index: number };

const editor = createEditorReducer<Doc, Sel>({
  signature: (doc) => JSON.stringify([...doc.names]),
  sameSelection: (a, b) => a.index === b.index,
  clampSelection: (doc, selection) => ({ index: Math.max(0, Math.min(selection.index, doc.names.length - 1)) }),
});

const doc = (...names: string[]): Doc => ({ names });
const start = (names: string[] = ['a', 'b', 'c']) => editor.init(doc(...names), 3, { index: 0 });
const run = (state: StudioEditorState<Doc, Sel>, ...actions: StudioEditorAction<Doc, Sel>[]) => actions.reduce(editor.reducer, state);

describe('createEditorReducer', () => {
  it('starts clean at the revision the server holds', () => {
    const state = start();
    expect(state).toMatchObject({ rev: 3, save: { status: 'idle' }, selection: { index: 0 } });
    expect(editor.isDirty(state)).toBe(false);
  });

  it('an edit makes it dirty and putting the old content back makes it clean again', () => {
    const edited = run(start(), { type: 'edit', next: doc('a', 'x', 'c') });
    expect(editor.isDirty(edited)).toBe(true);
    expect(editor.isDirty(run(edited, { type: 'edit', next: doc('a', 'b', 'c') }))).toBe(false);
  });

  it('editing with the same document object is no change', () => {
    const state = start();
    expect(run(state, { type: 'edit', next: state.doc })).toBe(state);
  });

  it('a save moves the baseline to what was sent, so an edit made while saving stays dirty', () => {
    const sent = doc('a', 'x', 'c');
    let state = run(start(), { type: 'edit', next: sent }, { type: 'save_start' });
    expect(state.save).toEqual({ status: 'saving' });
    state = run(state, { type: 'edit', next: doc('a', 'x', 'y') }, { type: 'save_ok', rev: 4, saved: sent, at: 'now' });
    expect(state.rev).toBe(4);
    expect(state.save).toEqual({ status: 'saved', at: 'now' });
    expect(editor.isDirty(state)).toBe(true);
  });

  it('a "saved" note disappears with the next edit, a conflict stays', () => {
    const saved = run(start(), { type: 'save_ok', rev: 4, saved: start().doc, at: 'now' });
    expect(run(saved, { type: 'edit', next: doc('z') }).save).toEqual({ status: 'idle' });
    const conflict = run(start(), { type: 'save_conflict', serverRev: 9 });
    expect(run(conflict, { type: 'edit', next: doc('z') }).save).toEqual({ status: 'conflict', serverRev: 9 });
  });

  it('never starts a second save and waits for the decision on a conflict', () => {
    const saving = run(start(), { type: 'save_start' });
    expect(run(saving, { type: 'save_start' })).toBe(saving);
    const conflict = run(start(), { type: 'save_conflict', serverRev: 9 });
    expect(run(conflict, { type: 'save_start' })).toBe(conflict);
  });

  it('a failed save keeps the document dirty and shows the error', () => {
    const failed = run(start(), { type: 'edit', next: doc('q') }, { type: 'save_start' }, { type: 'save_fail', error: { code: 'network_error' } });
    expect(failed.save).toEqual({ status: 'error', error: { code: 'network_error' } });
    expect(editor.isDirty(failed)).toBe(true);
  });

  it('keep mine adopts the server revision and stays dirty; outside a conflict it does nothing', () => {
    const mine = run(start(), { type: 'edit', next: doc('q') }, { type: 'save_conflict', serverRev: 9 }, { type: 'keep_mine' });
    expect(mine).toMatchObject({ rev: 9, save: { status: 'idle' } });
    expect(editor.isDirty(mine)).toBe(true);
    const idle = start();
    expect(run(idle, { type: 'keep_mine' })).toBe(idle);
  });

  it('a reload adopts the server document, is clean, and clamps a selection past the end', () => {
    const picked = run(start(), { type: 'select', selection: { index: 2 } });
    const reloaded = run(picked, { type: 'reload', doc: doc('only'), rev: 12 });
    expect(reloaded).toMatchObject({ rev: 12, selection: { index: 0 }, save: { status: 'idle' } });
    expect(editor.isDirty(reloaded)).toBe(false);
  });

  it('selecting what is selected already returns the same state', () => {
    const state = start();
    expect(run(state, { type: 'select', selection: { index: 0 } })).toBe(state);
    expect(run(state, { type: 'select', selection: { index: 1 } }).selection).toEqual({ index: 1 });
  });
});
