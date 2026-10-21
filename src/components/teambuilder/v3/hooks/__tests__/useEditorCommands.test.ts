/**
 * Tests for useEditorCommands logic.
 *
 * We test the execute() function in isolation by constructing the state
 * and capturing dispatched actions via a mock dispatch.
 */
import { describe, it, expect, vi } from 'vitest';
import { editorReducer, createInitialState } from '../../editor/state';
import type { EditorAction } from '../../editor/state';
import type { EditorCommand } from '../../ai/commands';
import { executeEditorCommand } from '../useEditorCommands';
import { teambuilderMessages } from '@/i18n/messages/teambuilder';
import { createTranslator } from '@/i18n/core';

// Helper: execute a command against a state and return the dispatched action
function makeExecutor(stateOverrides?: Partial<ReturnType<typeof createInitialState>>) {
  const state = { ...createInitialState(), ...stateOverrides };
  const dispatched: EditorAction[] = [];
  const dispatch = vi.fn((action: EditorAction) => dispatched.push(action));

  // Mirror the execute() logic from useEditorCommands without the hook wrapper
  function execute(cmd: EditorCommand): { ok: boolean; error?: string } {
    if (state.locked) return { ok: false, error: 'Team is locked' };

    switch (cmd.kind) {
      case 'apply_set': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        const existing = state.team[cmd.slot];
        if (!existing) return { ok: false, error: 'Slot is empty' };
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: cmd.set });
        return { ok: true };
      }
      case 'set_species': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        const existing = state.team[cmd.slot];
        if (existing) {
          dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { species: cmd.species, ability: '' } });
        } else {
          dispatch({ type: 'ADD_SLOT', species: cmd.species });
        }
        return { ok: true };
      }
      case 'set_move': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        if (cmd.moveIndex < 0 || cmd.moveIndex > 3) return { ok: false, error: 'Invalid move index' };
        const existing = state.team[cmd.slot];
        if (!existing) return { ok: false, error: 'Slot is empty' };
        const moves = [...(existing.moves ?? [])];
        while (moves.length < 4) moves.push('');
        moves[cmd.moveIndex] = cmd.move;
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { moves } });
        return { ok: true };
      }
      case 'set_item':
      case 'set_ability':
      case 'set_nature': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        if (!state.team[cmd.slot]) return { ok: false, error: 'Slot is empty' };
        const patch =
          cmd.kind === 'set_item'
            ? { item: cmd.item }
            : cmd.kind === 'set_ability'
              ? { ability: cmd.ability }
              : { nature: cmd.nature };
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch });
        return { ok: true };
      }
      case 'set_tera': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        if (!state.team[cmd.slot]) return { ok: false, error: 'Slot is empty' };
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { tera_type: cmd.tera } });
        return { ok: true };
      }
      case 'set_evs': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        const existing = state.team[cmd.slot];
        if (!existing) return { ok: false, error: 'Slot is empty' };
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { evs: { ...existing.evs, ...cmd.spread } } });
        return { ok: true };
      }
      case 'set_ivs': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        const existing = state.team[cmd.slot];
        if (!existing) return { ok: false, error: 'Slot is empty' };
        dispatch({ type: 'UPDATE_SLOT', slot: cmd.slot, patch: { ivs: { ...existing.ivs, ...cmd.spread } } });
        return { ok: true };
      }
      case 'remove_slot': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
        dispatch({ type: 'REMOVE_SLOT', slot: cmd.slot });
        return { ok: true };
      }
      case 'propose_team': {
        if (cmd.team.length === 0) return { ok: false, error: 'Team proposal is empty' };
        dispatch({ type: 'APPLY_TEAM_PROPOSAL', team: cmd.team, mode: cmd.mode });
        return { ok: true };
      }
      case 'select_slot': {
        if (cmd.slot < 0 || cmd.slot > 5) return { ok: false, error: 'Invalid slot' };
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
        return { ok: false, error: 'Unknown command' };
      }
    }
  }

  return { state, dispatch, dispatched, execute };
}

const PIKACHU = {
  species: 'Pikachu', name: '', gender: '', item: '', ability: '',
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  nature: '', level: 100, moves: [],
};

describe('EditorCommand execute', () => {
  it('returns error when team is locked', () => {
    const { execute } = makeExecutor({ locked: true });
    const res = execute({ kind: 'select_slot', slot: 0 });
    expect(res).toEqual({ ok: false, error: 'Team is locked' });
  });

  describe('apply_set', () => {
    it('rejects invalid slot', () => {
      const { execute } = makeExecutor();
      expect(execute({ kind: 'apply_set', slot: 7, set: {} })).toEqual({
        ok: false, error: 'Invalid slot',
      });
    });

    it('rejects empty slot', () => {
      const { execute } = makeExecutor();
      expect(execute({ kind: 'apply_set', slot: 0, set: { item: 'Leftovers' } })).toEqual({
        ok: false, error: 'Slot is empty',
      });
    });

    it('dispatches UPDATE_SLOT', () => {
      const team = [PIKACHU, ...Array(5).fill(null)] as typeof PIKACHU[];
      const { execute, dispatched } = makeExecutor({ team });
      const res = execute({ kind: 'apply_set', slot: 0, set: { item: 'Light Ball' } });
      expect(res.ok).toBe(true);
      expect(dispatched[0]).toMatchObject({ type: 'UPDATE_SLOT', slot: 0, patch: { item: 'Light Ball' } });
    });
  });

  describe('set_species', () => {
    it('dispatches ADD_SLOT for empty slot', () => {
      const { execute, dispatched } = makeExecutor();
      const res = execute({ kind: 'set_species', slot: 0, species: 'Charizard' });
      expect(res.ok).toBe(true);
      expect(dispatched[0]).toMatchObject({ type: 'ADD_SLOT', species: 'Charizard' });
    });

    it('dispatches UPDATE_SLOT for occupied slot', () => {
      const team = [PIKACHU, ...Array(5).fill(null)] as typeof PIKACHU[];
      const { execute, dispatched } = makeExecutor({ team });
      const res = execute({ kind: 'set_species', slot: 0, species: 'Raichu' });
      expect(res.ok).toBe(true);
      expect(dispatched[0]).toMatchObject({
        type: 'UPDATE_SLOT', slot: 0, patch: { species: 'Raichu', ability: '' },
      });
    });
  });

  describe('set_move', () => {
    it('rejects invalid move index', () => {
      const team = [PIKACHU, ...Array(5).fill(null)] as typeof PIKACHU[];
      const { execute } = makeExecutor({ team });
      expect(execute({ kind: 'set_move', slot: 0, moveIndex: 5 as never, move: 'Thunderbolt' })).toEqual({
        ok: false, error: 'Invalid move index',
      });
    });

    it('dispatches UPDATE_SLOT with correct move at index', () => {
      const team = [{ ...PIKACHU, moves: ['Thunderbolt', '', '', ''] }, ...Array(5).fill(null)] as typeof PIKACHU[];
      const { execute, dispatched } = makeExecutor({ team });
      execute({ kind: 'set_move', slot: 0, moveIndex: 1, move: 'Iron Tail' });
      expect((dispatched[0] as { patch: { moves: string[] } }).patch.moves[1]).toBe('Iron Tail');
      expect((dispatched[0] as { patch: { moves: string[] } }).patch.moves[0]).toBe('Thunderbolt');
    });
  });

  describe('propose_team', () => {
    it('rejects empty team', () => {
      const { execute } = makeExecutor();
      expect(execute({ kind: 'propose_team', team: [], mode: 'replace' })).toEqual({
        ok: false, error: 'Team proposal is empty',
      });
    });

    it('dispatches APPLY_TEAM_PROPOSAL replace', () => {
      const { execute, dispatched } = makeExecutor();
      const res = execute({ kind: 'propose_team', team: [PIKACHU], mode: 'replace' });
      expect(res.ok).toBe(true);
      expect(dispatched[0]).toMatchObject({
        type: 'APPLY_TEAM_PROPOSAL', mode: 'replace', team: [PIKACHU],
      });
    });

    it('dispatches APPLY_TEAM_PROPOSAL fill', () => {
      const { execute, dispatched } = makeExecutor();
      execute({ kind: 'propose_team', team: [PIKACHU], mode: 'fill' });
      expect(dispatched[0]).toMatchObject({ type: 'APPLY_TEAM_PROPOSAL', mode: 'fill' });
    });
  });

  describe('open_intel', () => {
    it('dispatches SET_INTEL_TAB and SET_RIGHT_PANEL', () => {
      const { execute, dispatched } = makeExecutor();
      execute({ kind: 'open_intel', tab: 'calc' });
      expect(dispatched[0]).toMatchObject({ type: 'SET_INTEL_TAB', tab: 'calc' });
      expect(dispatched[1]).toMatchObject({ type: 'SET_RIGHT_PANEL', tab: 'intel' });
    });
  });

  describe('select_slot', () => {
    it('rejects out-of-bounds slot', () => {
      const { execute } = makeExecutor();
      expect(execute({ kind: 'select_slot', slot: 10 })).toEqual({
        ok: false, error: 'Invalid slot',
      });
    });

    it('dispatches SELECT_SLOT', () => {
      const { execute, dispatched } = makeExecutor();
      execute({ kind: 'select_slot', slot: 3 });
      expect(dispatched[0]).toMatchObject({ type: 'SELECT_SLOT', slot: 3 });
    });
  });

  describe('snapshot', () => {
    it('returns expected shape', () => {
      const team = [PIKACHU, ...Array(5).fill(null)] as typeof PIKACHU[];
      const state = createInitialState({ format: 'gen9ou', teamId: 'tid-1' });
      const stateWithTeam = editorReducer(state, { type: 'LOAD_TEAM', pokemon: [PIKACHU] });

      // Simulate snapshot()
      const snap = {
        team: stateWithTeam.team,
        format: stateWithTeam.format,
        generation: stateWithTeam.generation,
        rulesetId: stateWithTeam.rulesetId,
        activeSlot: stateWithTeam.activeSlot,
        validation: stateWithTeam.validation,
        draft: stateWithTeam.draft,
      };
      expect(snap.team[0]?.species).toBe('Pikachu');
      expect(snap.format).toBe('gen9ou');
      expect(snap.draft).toBeNull();
      void team; // used above for type inference
    });
  });
});

// ── The real executor: refusals carry a code (rendered by the UI) and the English text ──
describe('executeEditorCommand', () => {
  function run(cmd: EditorCommand, stateOverrides?: Partial<ReturnType<typeof createInitialState>>) {
    const state = { ...editorReducer(createInitialState(), { type: 'LOAD_TEAM', pokemon: [PIKACHU] }), ...stateOverrides };
    const dispatched: EditorAction[] = [];
    const result = executeEditorCommand(state, (a) => dispatched.push(a), cmd);
    return { result, dispatched };
  }

  it('refuses a locked team with code "locked" and its English text', () => {
    const { result, dispatched } = run({ kind: 'set_item', slot: 0, item: 'Light Ball' }, { locked: true });
    expect(result).toEqual({ ok: false, code: 'locked', error: 'Team is locked' });
    expect(dispatched).toHaveLength(0);
  });

  it('refuses an out-of-range slot with code "invalid_slot"', () => {
    const { result } = run({ kind: 'select_slot', slot: 6 });
    expect(result).toEqual({ ok: false, code: 'invalid_slot', error: 'Invalid slot' });
  });

  it('refuses an empty slot with code "slot_empty"', () => {
    const { result } = run({ kind: 'set_nature', slot: 3, nature: 'Timid' });
    expect(result).toEqual({ ok: false, code: 'slot_empty', error: 'Slot is empty' });
  });

  it('refuses a bad move index and an empty proposal', () => {
    expect(run({ kind: 'set_move', slot: 0, moveIndex: 4 as 0, move: 'Thunderbolt' }).result.code).toBe(
      'invalid_move_index',
    );
    expect(run({ kind: 'propose_team', team: [], mode: 'fill' }).result).toEqual({
      ok: false,
      code: 'empty_proposal',
      error: 'Team proposal is empty',
    });
  });

  it('applies a valid command without a code', () => {
    const { result, dispatched } = run({ kind: 'set_item', slot: 0, item: 'Light Ball' });
    expect(result).toEqual({ ok: true });
    expect(dispatched[0]).toMatchObject({ type: 'UPDATE_SLOT', slot: 0, patch: { item: 'Light Ball' } });
  });

  it('has a German message for every refusal code', () => {
    const de = createTranslator(teambuilderMessages, 'de');
    expect(de('commandErrors.locked')).toBe('Das Team ist gesperrt');
    expect(de('commandErrors.slot_empty')).toBe('Der Slot ist leer');
    for (const code of Object.keys(teambuilderMessages.en.commandErrors)) {
      expect(de.dynamic(`commandErrors.${code}`)).not.toBe(
        teambuilderMessages.en.commandErrors[code as keyof typeof teambuilderMessages.en.commandErrors],
      );
    }
  });
});
