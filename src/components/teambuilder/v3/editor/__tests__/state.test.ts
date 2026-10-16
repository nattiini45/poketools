import { describe, it, expect } from 'vitest';
import { editorReducer, createInitialState } from '../state';

const S = () => createInitialState();

describe('editorReducer', () => {
  // ── SET_FORMAT ──────────────────────────────────────────────────
  describe('SET_FORMAT', () => {
    it('sets format and derives generation', () => {
      const next = editorReducer(S(), { type: 'SET_FORMAT', format: 'gen8ou' });
      expect(next.format).toBe('gen8ou');
      expect(next.generation).toBe(8);
    });

    it('marks validation stale (legality differs per format)', () => {
      const next = editorReducer(S(), { type: 'SET_FORMAT', format: 'gen8ou' });
      expect(next.validationStatus).toBe('stale');
    });
  });

  describe('SET_TEAM_NAME', () => {
    it('sets the name and marks dirty', () => {
      const next = editorReducer(S(), { type: 'SET_TEAM_NAME', name: 'Rain Squad' });
      expect(next.teamName).toBe('Rain Squad');
      expect(next.dirty).toBe(true);
    });

    it('is cleared by CLEAR_TEAM', () => {
      const named = editorReducer(S(), { type: 'SET_TEAM_NAME', name: 'Rain Squad' });
      const next = editorReducer(named, { type: 'CLEAR_TEAM' });
      expect(next.teamName).toBe('');
    });
  });

  describe('CLEAR_JUMP_TARGET', () => {
    it('clears the jump target', () => {
      const state = {
        ...S(),
        validation: {
          valid: false,
          issues: [
            { issue_id: 'slot-0-x', pokemon_index: 0, species: 'Gengar', issue: 'Illegal move', severity: 'error' as const },
          ],
          team_issues: [],
        },
      };
      const jumped = editorReducer(state, { type: 'JUMP_TO_ISSUE', issueId: 'slot-0-x' });
      expect(jumped.jumpTarget).toBe('slot-0-x');
      const next = editorReducer(jumped, { type: 'CLEAR_JUMP_TARGET' });
      expect(next.jumpTarget).toBeNull();
    });
  });

  // ── ADD_SLOT ────────────────────────────────────────────────────
  describe('ADD_SLOT', () => {
    it('adds a Pokémon to the first empty slot', () => {
      const next = editorReducer(S(), { type: 'ADD_SLOT', species: 'Charizard' });
      expect(next.team[0]?.species).toBe('Charizard');
      expect(next.activeSlot).toBe(0);
      expect(next.dirty).toBe(true);
    });

    it('does nothing when team is full', () => {
      const full = { ...S(), team: Array.from({ length: 6 }, () => ({ species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] })) };
      const next = editorReducer(full, { type: 'ADD_SLOT', species: 'Mewtwo' });
      expect(next).toBe(full); // identity check — no change
    });
  });

  // ── REMOVE_SLOT ─────────────────────────────────────────────────
  describe('REMOVE_SLOT', () => {
    it('removes a slot and clears activeSlot if it was the one removed', () => {
      const withPokemon = editorReducer(S(), { type: 'ADD_SLOT', species: 'Gengar' });
      const next = editorReducer(withPokemon, { type: 'REMOVE_SLOT', slot: 0 });
      expect(next.team[0]).toBeNull();
      expect(next.activeSlot).toBeNull();
    });
  });

  // ── SET_SLOT ────────────────────────────────────────────────────
  describe('SET_SLOT', () => {
    it('replaces a slot with a given set', () => {
      const set = { species: 'Lapras', name: 'Lappy', gender: 'F', item: 'Leftovers', ability: 'Water Absorb', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: 'Bold', level: 100, moves: ['Ice Beam'] };
      const next = editorReducer(S(), { type: 'SET_SLOT', slot: 2, set });
      expect(next.team[2]?.species).toBe('Lapras');
      expect(next.dirty).toBe(true);
    });
  });

  // ── UPDATE_SLOT ─────────────────────────────────────────────────
  describe('UPDATE_SLOT', () => {
    it('patches individual fields on a slot', () => {
      const withMon = editorReducer(S(), { type: 'ADD_SLOT', species: 'Garchomp' });
      const next = editorReducer(withMon, { type: 'UPDATE_SLOT', slot: 0, patch: { item: 'Choice Scarf', nature: 'Jolly' } });
      expect(next.team[0]?.item).toBe('Choice Scarf');
      expect(next.team[0]?.nature).toBe('Jolly');
      expect(next.team[0]?.species).toBe('Garchomp'); // unchanged
    });

    it('does nothing if slot is empty', () => {
      const next = editorReducer(S(), { type: 'UPDATE_SLOT', slot: 0, patch: { item: 'Berry' } });
      expect(next.team[0]).toBeNull();
    });
  });

  // ── LOAD_TEAM ───────────────────────────────────────────────────
  describe('LOAD_TEAM', () => {
    it('loads a team and pads to 6 slots', () => {
      const pokemon = [
        { species: 'Pikachu', name: '', gender: 'M', item: 'Light Ball', ability: 'Static', evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: 'Jolly', level: 100, moves: ['Thunderbolt'] },
      ];
      const next = editorReducer(S(), { type: 'LOAD_TEAM', pokemon });
      expect(next.team[0]?.species).toBe('Pikachu');
      expect(next.team.length).toBe(6);
      expect(next.team[1]).toBeNull();
      expect(next.dirty).toBe(false);
      expect(next.activeSlot).toBeNull();
    });
  });

  // ── CLEAR_TEAM ──────────────────────────────────────────────────
  describe('CLEAR_TEAM', () => {
    it('resets all slots to null', () => {
      const withMon = editorReducer(S(), { type: 'ADD_SLOT', species: 'Eevee' });
      const next = editorReducer(withMon, { type: 'CLEAR_TEAM' });
      expect(next.team.every((s) => s === null)).toBe(true);
      expect(next.dirty).toBe(true);
      expect(next.validation).toBeNull();
    });
  });

  // ── SELECT_SLOT ─────────────────────────────────────────────────
  describe('SELECT_SLOT', () => {
    it('sets the active slot', () => {
      const next = editorReducer(S(), { type: 'SELECT_SLOT', slot: 3 });
      expect(next.activeSlot).toBe(3);
    });

    it('can deselect by passing null', () => {
      const selected = editorReducer(S(), { type: 'SELECT_SLOT', slot: 2 });
      const next = editorReducer(selected, { type: 'SELECT_SLOT', slot: null });
      expect(next.activeSlot).toBeNull();
    });
  });

  // ── JUMP_TO_ISSUE ───────────────────────────────────────────────
  describe('JUMP_TO_ISSUE', () => {
    it('jumps to the correct slot from an issue_id', () => {
      const state = {
        ...S(),
        validation: {
          valid: false,
          issues: [
            { issue_id: 'slot-2-abc', pokemon_index: 2, species: 'Gengar', issue: 'Banned', severity: 'error' as const },
          ],
          team_issues: [],
        },
      };
      const next = editorReducer(state, { type: 'JUMP_TO_ISSUE', issueId: 'slot-2-abc' });
      expect(next.activeSlot).toBe(2);
      expect(next.jumpTarget).toBe('slot-2-abc');
      expect(next.rightPanelTab).toBe('validation');
    });
  });

  // ── SET_VALIDATION ──────────────────────────────────────────────
  describe('SET_VALIDATION', () => {
    it('stores validation result', () => {
      const result = { valid: true, issues: [], team_issues: [] };
      const next = editorReducer(S(), { type: 'SET_VALIDATION', result });
      expect(next.validation).toEqual(result);
    });

    it('clears validation with null', () => {
      const withVal = { ...S(), validation: { valid: true, issues: [], team_issues: [] } };
      const next = editorReducer(withVal, { type: 'SET_VALIDATION', result: null });
      expect(next.validation).toBeNull();
    });
  });

  // ── SET_META ────────────────────────────────────────────────────
  describe('SET_META', () => {
    it('patches meta fields', () => {
      const next = editorReducer(S(), { type: 'SET_META', patch: { teamId: 'abc-123', locked: true } });
      expect(next.teamId).toBe('abc-123');
      expect(next.locked).toBe(true);
    });
  });

  // ── Panel & browser ────────────────────────────────────────────
  describe('SET_RIGHT_PANEL', () => {
    it('switches right panel tab', () => {
      const next = editorReducer(S(), { type: 'SET_RIGHT_PANEL', tab: 'ai' });
      expect(next.rightPanelTab).toBe('ai');
    });
  });

  describe('SET_SEARCH', () => {
    it('updates search query and optional filters', () => {
      const next = editorReducer(S(), { type: 'SET_SEARCH', query: 'char', typeFilters: ['Fire'] });
      expect(next.searchQuery).toBe('char');
      expect(next.typeFilters).toEqual(['Fire']);
    });
  });

  // ── Workspace view ────────────────────────────────────────────────────
  describe('OPEN_SET_WORKSPACE', () => {
    it('switches to set workspace view', () => {
      const next = editorReducer(S(), { type: 'OPEN_SET_WORKSPACE' });
      expect(next.workspaceView).toBe('set');
    });
  });

  describe('CLOSE_SET_WORKSPACE', () => {
    it('returns to grid view', () => {
      const opened = editorReducer(S(), { type: 'OPEN_SET_WORKSPACE' });
      const next = editorReducer(opened, { type: 'CLOSE_SET_WORKSPACE' });
      expect(next.workspaceView).toBe('grid');
    });
  });

  describe('SWAP_SLOTS', () => {
    it('swaps two team slots', () => {
      const pikachu = { species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] };
      const gengar = { ...pikachu, species: 'Gengar' };
      const state = { ...S(), team: [pikachu, gengar, null, null, null, null] as (typeof pikachu | null)[] };
      const next = editorReducer(state, { type: 'SWAP_SLOTS', slotA: 0, slotB: 1 });
      expect(next.team[0]?.species).toBe('Gengar');
      expect(next.team[1]?.species).toBe('Pikachu');
      expect(next.dirty).toBe(true);
    });
  });

  describe('APPLY_TEAM_PROPOSAL', () => {
    it('replace mode overwrites entire team', () => {
      const mon = { species: 'Mewtwo', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] };
      const next = editorReducer(S(), { type: 'APPLY_TEAM_PROPOSAL', team: [mon], mode: 'replace' });
      expect(next.team[0]?.species).toBe('Mewtwo');
      expect(next.dirty).toBe(true);
    });

    it('fill mode only fills empty slots', () => {
      const pikachu = { species: 'Pikachu', name: '', gender: '', item: '', ability: '', evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }, nature: '', level: 100, moves: [] };
      const mewtwo = { ...pikachu, species: 'Mewtwo' };
      const state = { ...S(), team: [pikachu, null, null, null, null, null] as (typeof pikachu | null)[] };
      const next = editorReducer(state, { type: 'APPLY_TEAM_PROPOSAL', team: [mewtwo], mode: 'fill' });
      expect(next.team[0]?.species).toBe('Pikachu');
      expect(next.team[1]?.species).toBe('Mewtwo');
    });
  });

  describe('validationStatus', () => {
    it('is stale after team mutations', () => {
      const next = editorReducer(S(), { type: 'ADD_SLOT', species: 'Bulbasaur' });
      expect(next.validationStatus).toBe('stale');
    });

    it('can be set explicitly', () => {
      const next = editorReducer(S(), { type: 'SET_VALIDATION_STATUS', status: 'fresh' });
      expect(next.validationStatus).toBe('fresh');
    });
  });

  // ── SET_FIELD_CONDITIONS ──────────────────────────────────────────
  describe('SET_FIELD_CONDITIONS', () => {
    it('stores field conditions', () => {
      const conditions = { weather: 'Rain' as never, terrain: undefined };
      const next = editorReducer(S(), { type: 'SET_FIELD_CONDITIONS', conditions });
      expect(next.fieldConditions).toEqual(conditions);
    });
  });

  // ── SET_SPEED_TARGET ─────────────────────────────────────────────
  describe('SET_SPEED_TARGET', () => {
    const target = { species: 'Garchomp', speed: 333, label: '252+ · base 102' };

    it('sets the speed calc target', () => {
      const next = editorReducer(S(), { type: 'SET_SPEED_TARGET', target });
      expect(next.speedCalcTarget).toEqual(target);
    });

    it('clears the target when null', () => {
      const withTarget = editorReducer(S(), { type: 'SET_SPEED_TARGET', target });
      const next = editorReducer(withTarget, { type: 'SET_SPEED_TARGET', target: null });
      expect(next.speedCalcTarget).toBeNull();
    });
  });

  // ── SET_MOBILE_PANE ──────────────────────────────────────────────
  describe('SET_MOBILE_PANE', () => {
    it('switches the mobile pane', () => {
      const next = editorReducer(S(), { type: 'SET_MOBILE_PANE', pane: 'intel' });
      expect(next.mobilePane).toBe('intel');
    });
  });

  // ── SET_DRAFT_CONTEXT ────────────────────────────────────────────
  describe('SET_DRAFT_CONTEXT', () => {
    it('stores draft context', () => {
      const draft = {
        poolId: 'pool-1',
        budget: 100,
        defaultPointCost: null,
        spent: 25,
        roster: ['Pikachu'],
        entries: [],
        takenPokemon: [],
      };
      const next = editorReducer(S(), { type: 'SET_DRAFT_CONTEXT', draft });
      expect(next.draft).toEqual(draft);
    });

    it('clears draft context when null', () => {
      const withDraft = editorReducer(S(), {
        type: 'SET_DRAFT_CONTEXT',
        draft: { poolId: 'x', budget: 50, defaultPointCost: null, spent: 0, roster: [], entries: [], takenPokemon: [] },
      });
      const next = editorReducer(withDraft, { type: 'SET_DRAFT_CONTEXT', draft: null });
      expect(next.draft).toBeNull();
    });
  });
});
