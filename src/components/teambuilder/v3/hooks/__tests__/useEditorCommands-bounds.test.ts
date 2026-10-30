/**
 * The REAL `executeEditorCommand`: an accepted AI command can never leave the editor holding a value the save boundary
 * (`teamPokemonSchema`) answers 400 to.
 */
import { describe, expect, it, vi } from 'vitest';
import { createInitialState, editorReducer } from '../../editor/state';
import type { EditorAction, EditorState } from '../../editor/state';
import { executeEditorCommand } from '../useEditorCommands';
import { teamPokemonSchema } from '@/lib/validation/schemas';
import { makeSet } from '@/test/team-fixtures';
import type { PokemonSet } from '@/types/team';

/** Runs a command against a state with one set in slot 0 and returns the state after the reducer applied it. */
function run(cmd: Parameters<typeof executeEditorCommand>[2], team: (PokemonSet | null)[] = [makeSet('Garchomp'), null, null, null, null, null]) {
  let state: EditorState = { ...createInitialState(), team };
  const dispatch = vi.fn((action: EditorAction) => {
    state = editorReducer(state, action);
  });
  const result = executeEditorCommand(state, dispatch, cmd);
  return { result, state, saved: state.team.filter((s): s is PokemonSet => s !== null) };
}

const accepted = (saved: PokemonSet[]) => teamPokemonSchema.safeParse(saved).success;

describe('executeEditorCommand keeps every accepted value inside the save bounds', () => {
  it('set_evs: decimals, negatives and huge values are truncated and clamped', () => {
    const { result, saved } = run({ kind: 'set_evs', slot: 0, spread: { atk: 252.9, spe: -4, hp: 1e9, def: Number.NaN } });
    expect(result.ok).toBe(true);
    expect(saved[0].evs).toMatchObject({ atk: 252, spe: 0, hp: 252, def: 0 });
    expect(accepted(saved)).toBe(true);
  });

  it('set_ivs: out-of-range and fractional values are bounded', () => {
    const { saved } = run({ kind: 'set_ivs', slot: 0, spread: { hp: 40, atk: -3, spe: 30.5 } });
    expect(saved[0].ivs).toMatchObject({ hp: 31, atk: 0, spe: 30 });
    expect(accepted(saved)).toBe(true);
  });

  it('apply_set: a patch with level, spreads, happiness and extra moves is bounded', () => {
    const { saved } = run({
      kind: 'apply_set',
      slot: 0,
      set: { level: 0, evs: { atk: 300 }, ivs: { spe: 99 }, happiness: -3, moves: ['a', 'b', 'c', 'd', 'e'] } as unknown as Partial<PokemonSet>,
    });
    expect(saved[0]).toMatchObject({ level: 1, happiness: 0 });
    expect(saved[0].evs.atk).toBe(252);
    expect(saved[0].ivs.spe).toBe(31);
    expect(saved[0].moves).toHaveLength(4);
    expect(accepted(saved)).toBe(true);
  });

  it('apply_set: a decimal level is truncated', () => {
    const { saved } = run({ kind: 'apply_set', slot: 0, set: { level: 50.9 } });
    expect(saved[0].level).toBe(50);
  });

  it('propose_team: a proposal missing evs, ivs and moves, with hostile numbers, becomes a savable team', () => {
    const proposal = [
      { species: 'Garchomp', level: 250, evs: { atk: -1, spe: 999 } },
      { species: 'Dragonite', ivs: { hp: 77 } },
    ] as unknown as PokemonSet[];
    const { result, saved } = run({ kind: 'propose_team', team: proposal, mode: 'replace' }, [null, null, null, null, null, null]);
    expect(result.ok).toBe(true);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ level: 100, evs: { hp: 0, atk: 0, spe: 252 }, moves: [] });
    expect(saved[1].ivs).toEqual({ hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 });
    expect(accepted(saved)).toBe(true);
  });

  it('set_move: an over-long move name is capped', () => {
    const { saved } = run({ kind: 'set_move', slot: 0, moveIndex: 2, move: 'x'.repeat(300) });
    expect(saved[0].moves[2]).toHaveLength(100);
    expect(accepted(saved)).toBe(true);
  });

  describe('refuses (ok:false) what bounding cannot repair, instead of reporting success for a set that cannot be saved', () => {
    it.each([
      ['a blank species', { species: '   ', evs: { atk: 1 } }],
      ['a missing species', { evs: { atk: 1 } }],
      ['a shiny that is not a boolean', { species: 'Garchomp', shiny: 'yes' }],
    ])('propose_team with %s', (_label, proposed) => {
      const { result, saved } = run(
        { kind: 'propose_team', team: [proposed as unknown as PokemonSet], mode: 'replace' },
        [null, null, null, null, null, null],
      );
      expect(result.ok).toBe(false);
      expect(result.code).toBe('invalid_set');
      expect(result.error).toMatch(/^The proposed set is not valid and could not be saved: set 1: /);
      expect(saved).toEqual([]); // nothing was applied
    });

    it('propose_team refuses the whole proposal when one of its sets is unsaveable, and applies none', () => {
      const good = makeSet('Dragonite');
      const bad = { ...makeSet('Garchomp'), shiny: 1 } as unknown as PokemonSet;
      const { result, saved } = run({ kind: 'propose_team', team: [good, bad], mode: 'replace' }, [null, null, null, null, null, null]);
      expect(result).toMatchObject({ ok: false, code: 'invalid_set' });
      expect(result.error).toContain('set 2');
      expect(saved).toEqual([]);
    });

    it('apply_set refuses a patch that would leave the slot unsaveable, and leaves the slot as it was', () => {
      const { result, saved } = run({ kind: 'apply_set', slot: 0, set: { species: '' } });
      expect(result).toMatchObject({ ok: false, code: 'invalid_set' });
      expect(saved[0].species).toBe('Garchomp');

      const shiny = run({ kind: 'apply_set', slot: 0, set: { shiny: 'yes' } as unknown as Partial<PokemonSet> });
      expect(shiny.result).toMatchObject({ ok: false, code: 'invalid_set' });
    });

    it('the reason is catalogued in English and German', async () => {
      const { teambuilderMessages } = await import('@/i18n/messages/teambuilder');
      expect(teambuilderMessages.en.commandErrors.invalid_set).toBeTruthy();
      expect(teambuilderMessages.de.commandErrors.invalid_set).not.toBe(teambuilderMessages.en.commandErrors.invalid_set);
    });
  });

  it('a valid command is passed through untouched', () => {
    const { saved } = run({ kind: 'set_evs', slot: 0, spread: { atk: 252, spe: 252, hp: 4 } });
    expect(saved[0].evs).toEqual({ hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 });
  });
});
