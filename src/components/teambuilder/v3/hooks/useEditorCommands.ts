'use client';

import { useCallback } from 'react';
import type React from 'react';
import type { EditorState, EditorAction } from '../editor/state';
import type {
  EditorCommandApi,
  EditorCommand,
  EditorCommandErrorCode,
  CommandResult,
  EditorSnapshot,
} from '../ai/commands';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';

/** A refused command: the code for the UI, plus its English text for agents and logs. */
function fail(code: EditorCommandErrorCode): CommandResult {
  return { ok: false, code, error: teambuilderMessages.en.commandErrors[code] };
}

/**
 * Validates one command against `state` (bounds, lock) and dispatches it.
 * Pure apart from `dispatch`; `useEditorCommands` wraps it for components.
 */
export function executeEditorCommand(
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
  cmd: EditorCommand,
): CommandResult {
  if (state.locked) return fail('locked');

  switch (cmd.kind) {
    case 'apply_set': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      const existing = state.team[cmd.slot];
      if (!existing) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: cmd.set });
      return { ok: true };
    }

    case 'set_species': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      const existing = state.team[cmd.slot];
      if (existing) {
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { species: cmd.species, ability: '' } });
      } else {
        dispatch({ type: 'ADD_SLOT', species: cmd.species });
      }
      return { ok: true };
    }

    case 'set_move': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      if (cmd.moveIndex < 0 || cmd.moveIndex > 3) return fail('invalid_move_index');
      const existing = state.team[cmd.slot];
      if (!existing) return fail('slot_empty');
      const moves = [...(existing.moves ?? [])];
      while (moves.length < 4) moves.push('');
      moves[cmd.moveIndex] = cmd.move;
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { moves } });
      return { ok: true };
    }

    case 'set_item': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      if (!state.team[cmd.slot]) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { item: cmd.item } });
      return { ok: true };
    }

    case 'set_ability': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      if (!state.team[cmd.slot]) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { ability: cmd.ability } });
      return { ok: true };
    }

    case 'set_nature': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      if (!state.team[cmd.slot]) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { nature: cmd.nature } });
      return { ok: true };
    }

    case 'set_tera': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      if (!state.team[cmd.slot]) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { tera_type: cmd.tera } });
      return { ok: true };
    }

    case 'set_evs': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      const existing = state.team[cmd.slot];
      if (!existing) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { evs: { ...existing.evs, ...cmd.spread } } });
      return { ok: true };
    }

    case 'set_ivs': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      const existing = state.team[cmd.slot];
      if (!existing) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { ivs: { ...existing.ivs, ...cmd.spread } } });
      return { ok: true };
    }

    case 'remove_slot': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      dispatch({ type: 'REMOVE_SLOT', slot: cmd.slot });
      return { ok: true };
    }

    case 'propose_team': {
      if (cmd.team.length === 0) return fail('empty_proposal');
      dispatch({ type: 'APPLY_TEAM_PROPOSAL', team: cmd.team, mode: cmd.mode });
      return { ok: true };
    }

    case 'select_slot': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      dispatch({ type: 'SELECT_SLOT', slot: cmd.slot });
      return { ok: true };
    }

    case 'open_intel': {
      dispatch({ type: 'SET_INTEL_TAB', tab: cmd.tab });
      dispatch({ type: 'SET_RIGHT_PANEL', tab: 'intel' });
      return { ok: true };
    }

    case 'set_field': {
      dispatch({ type: 'SET_FIELD_CONDITIONS', conditions: cmd.field });
      return { ok: true };
    }

    case 'highlight_issue': {
      dispatch({ type: 'JUMP_TO_ISSUE', issueId: cmd.issueId });
      return { ok: true };
    }

    default: {
      const _exhaustive: never = cmd;
      return fail('unknown_command');
    }
  }
}

/**
 * Creates an EditorCommandApi from the current state + dispatch.
 * Validates bounds and lock before dispatching any mutation.
 *
 * This is the typed seam the future agent chat plugs into
 * (see docs/poketools-spec.md Phase 5 + AI Assistant PRD).
 */
export function useEditorCommands(
  state: EditorState,
  dispatch: React.Dispatch<EditorAction>,
): EditorCommandApi {
  const execute = useCallback(
    (cmd: EditorCommand): CommandResult => executeEditorCommand(state, dispatch, cmd),
    [state, dispatch],
  );

  const executeBatch = useCallback(
    (cmds: EditorCommand[]): CommandResult[] => cmds.map(execute),
    [execute],
  );

  const snapshot = useCallback(
    (): EditorSnapshot => ({
      team: state.team,
      format: state.format,
      generation: state.generation,
      rulesetId: state.rulesetId,
      activeSlot: state.activeSlot,
      validation: state.validation,
      draft: state.draft,
    }),
    [state],
  );

  return { execute, executeBatch, snapshot };
}
