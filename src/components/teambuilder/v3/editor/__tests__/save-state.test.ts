import { describe, expect, it } from 'vitest';
import { createInitialState, editorReducer, type EditorAction, type EditorState } from '../state';

const run = (state: EditorState, actions: EditorAction[]) => actions.reduce(editorReducer, state);
const edited = () => editorReducer(createInitialState(), { type: 'ADD_SLOT', species: 'Garchomp' });

/** The save sequences useTeamSave dispatches today, run through the reducer. */
describe('teambuilder save state', () => {
  it('saving → saved clears dirty', () => {
    const next = run(edited(), [{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'MARK_SAVED' }]);
    expect(next).toMatchObject({ saveStatus: 'saved', dirty: false });
  });

  it('saved → warned / unchecked when the league rules are not met or not checked', () => {
    const saved: EditorAction[] = [{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'MARK_SAVED' }];
    expect(run(edited(), [...saved, { type: 'SET_SAVE_STATUS', status: 'warned' }])).toMatchObject({ saveStatus: 'warned', dirty: false });
    expect(run(edited(), [...saved, { type: 'SET_SAVE_STATUS', status: 'unchecked' }])).toMatchObject({ saveStatus: 'unchecked', dirty: false });
  });

  it('saving → error keeps the edits dirty', () => {
    const next = run(edited(), [{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'SET_SAVE_STATUS', status: 'error' }]);
    expect(next).toMatchObject({ saveStatus: 'error', dirty: true });
  });

  it('a new save starts from every settled state', () => {
    for (const status of ['saved', 'warned', 'unchecked', 'error'] as const) {
      const settled = { ...edited(), saveStatus: status };
      expect(editorReducer(settled, { type: 'SET_SAVE_STATUS', status: 'saving' }).saveStatus).toBe('saving');
    }
  });

  it('refuses the moves no save performs (teamSaveMachine)', () => {
    const idle = edited();
    expect(editorReducer(idle, { type: 'MARK_SAVED' })).toBe(idle);
    expect(editorReducer(idle, { type: 'SET_SAVE_STATUS', status: 'warned' })).toBe(idle);
    const saving = editorReducer(idle, { type: 'SET_SAVE_STATUS', status: 'saving' });
    expect(editorReducer(saving, { type: 'SET_SAVE_STATUS', status: 'saving' })).toBe(saving);
    expect(editorReducer(saving, { type: 'SET_SAVE_STATUS', status: 'idle' })).toBe(saving);
  });

  it('an edit made while the save is in flight stays dirty after the save lands', () => {
    const saving = editorReducer(edited(), { type: 'SET_SAVE_STATUS', status: 'saving' });
    const typed = editorReducer(saving, { type: 'SET_TEAM_NAME', name: 'Sand' });
    expect(editorReducer(typed, { type: 'MARK_SAVED' })).toMatchObject({ saveStatus: 'saved', dirty: true, teamName: 'Sand' });
    const added = editorReducer(saving, { type: 'ADD_SLOT', species: 'Tyranitar' });
    expect(editorReducer(added, { type: 'MARK_SAVED' })).toMatchObject({ saveStatus: 'saved', dirty: true });
    const selected = editorReducer(saving, { type: 'SELECT_SLOT', slot: 0 });
    expect(editorReducer(selected, { type: 'MARK_SAVED' })).toMatchObject({ saveStatus: 'saved', dirty: false });
  });

  it('an edit after a save leaves the save status and marks the team dirty', () => {
    const saved = run(edited(), [{ type: 'SET_SAVE_STATUS', status: 'saving' }, { type: 'MARK_SAVED' }]);
    const next = editorReducer(saved, { type: 'SET_TEAM_NAME', name: 'Sand' });
    expect(next).toMatchObject({ saveStatus: 'saved', dirty: true });
  });
});
