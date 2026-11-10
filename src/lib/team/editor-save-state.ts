import { defineMachine } from '@/lib/state-machine/machine';

/**
 * The save state of the teambuilder editor (`TeamsEditor`, docs/teambuilder-editor.md). `editorReducer` applies a
 * `SET_SAVE_STATUS` / `MARK_SAVED` only when this machine allows it, and `useTeamSave` starts a save only from a
 * state that may move to `saving`. Whether the editor holds unsaved edits is the separate `dirty` flag.
 *
 * `warned` and `unchecked` are saved too: the league's team rules are not met, or could not be checked (the server
 * saves the team anyway).
 */
export const TEAM_SAVE_STATES = ['idle', 'saving', 'saved', 'warned', 'unchecked', 'error'] as const;
export type TeamSaveStatus = (typeof TEAM_SAVE_STATES)[number];
export type TeamSaveActor = 'player' | 'server';

const SAVE = 'src/components/teambuilder/v3/hooks/useTeamSave.ts';
const REDUCER = 'src/components/teambuilder/v3/editor/state.ts';

export const teamSaveMachine = defineMachine({
  id: 'teambuilder.save',
  title: 'Teambuilder save',
  storage: 'client: EditorState.saveStatus in TeamsEditor',
  summary:
    'One save of the team (POST /api/teams, PATCH /api/teams/[id], or POST /api/match-prep in plan mode). A save never overlaps another one. An edit made while a save is in flight keeps the team dirty after the save lands.',
  states: TEAM_SAVE_STATES,
  initial: ['idle'],
  terminal: [],
  actors: ['player', 'server'],
  transitions: [
    { event: 'save', from: ['idle', 'saved', 'warned', 'unchecked', 'error'], to: 'saving', actors: ['player'], writers: [SAVE, REDUCER], note: 'The Save button; disabled while saving.' },
    { event: 'saved', from: ['saving'], to: 'saved', actors: ['server'], writers: [SAVE, REDUCER], note: 'MARK_SAVED: clean unless the team was edited during the save.' },
    { event: 'fail', from: ['saving'], to: 'error', actors: ['server'], writers: [SAVE, REDUCER], note: 'One generic label; a 409 for a completed match also locks the editor.' },
    { event: 'warn', from: ['saved'], to: 'warned', actors: ['server'], writers: [SAVE, REDUCER], note: 'Saved; the league rules are not met (the verdict goes to the validation panel).' },
    { event: 'uncheck', from: ['saved'], to: 'unchecked', actors: ['server'], writers: [SAVE, REDUCER], note: 'Saved; the league rules could not be checked.' },
  ],
  doc: 'docs/teambuilder-editor.md',
});
