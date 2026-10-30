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
import { boundSet, type SetLike } from '@/lib/pkmn/set-bounds';
import type { PokemonSet } from '@/types/team';
import { formatZodErrors, pokemonSetSchema } from '@/lib/validation/schemas';

/** A refused command: the code for the UI, plus its English text for agents and logs. */
function fail(code: EditorCommandErrorCode): CommandResult {
  return { ok: false, code, error: teambuilderMessages.en.commandErrors[code] };
}

/** A refused set: the catalogued reason, plus what the save boundary objects to (English, for agents and logs). */
function failInvalidSet(detail: string): CommandResult {
  const base = fail('invalid_set');
  return { ...base, error: `${base.error}: ${detail}` };
}

/**
 * The reason the save boundary (`pokemonSetSchema`, the one `POST /api/teams` and `PATCH /api/teams/[id]` use) would
 * refuse `set`, or null when it would accept it. Bounding and filling cannot repair everything (a blank species, a
 * `shiny` that is not a boolean), and a command must not report success for a set that can never be saved.
 */
function boundaryRefusal(set: unknown): string | null {
  const parsed = pokemonSetSchema.safeParse(set);
  return parsed.success ? null : formatZodErrors(parsed.error);
}

/**
 * A proposed set as the editor stores it: every member the save boundary requires is there (`evs`, `ivs`, `moves` and
 * the strings), and every number is a whole number inside its bounds. An accepted proposal can therefore never make
 * the save answer 400.
 */
function completeSet(raw: PokemonSet): PokemonSet {
  const set: SetLike = boundSet(raw);
  return {
    name: '',
    gender: '',
    item: '',
    ability: '',
    nature: '',
    level: 100,
    moves: [],
    ...set,
    species: set.species ?? '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...set.evs },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...set.ivs },
  };
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
      const patch = boundSet(cmd.set);
      // The slot AFTER the patch is what gets saved: refuse a patch that would leave it unsaveable.
      const refusal = boundaryRefusal({ ...existing, ...patch });
      if (refusal) return failInvalidSet(refusal);
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch });
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
      moves[cmd.moveIndex] = boundSet({ moves: [cmd.move] }).moves?.[0] ?? '';
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
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { evs: { ...existing.evs, ...boundSet({ evs: cmd.spread }).evs } } });
      return { ok: true };
    }

    case 'set_ivs': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      const existing = state.team[cmd.slot];
      if (!existing) return fail('slot_empty');
      dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { ivs: { ...existing.ivs, ...boundSet({ ivs: cmd.spread }).ivs } } });
      return { ok: true };
    }

    case 'remove_slot': {
      if (cmd.slot < 0 || cmd.slot > 5) return fail('invalid_slot');
      dispatch({ type: 'REMOVE_SLOT', slot: cmd.slot });
      return { ok: true };
    }

    case 'propose_team': {
      if (cmd.team.length === 0) return fail('empty_proposal');
      const team = cmd.team.map(completeSet);
      for (const [index, set] of team.entries()) {
        const refusal = boundaryRefusal(set);
        if (refusal) return failInvalidSet(`set ${index + 1}: ${refusal}`);
      }
      dispatch({ type: 'APPLY_TEAM_PROPOSAL', team, mode: cmd.mode });
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
