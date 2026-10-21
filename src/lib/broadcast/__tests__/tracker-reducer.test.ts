import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  createEmptyPlayerState,
  trackerReducer,
  buildGamePayload,
  normalizeSoloTrackerState,
} from '../tracker-reducer';
import type { TrackerState, TrackerAction } from '@/types/broadcast';
import type { GameSummary } from '@/types/match';

// ── Helpers ──────────────────────────────────────────────────────────

function baseState(): TrackerState {
  return createInitialState(
    'match-1',
    { id: 'p1', name: 'Alice', avatar_url: null, pokemon: ['Pikachu', 'Charizard', 'Bulbasaur'] },
    { id: 'p2', name: 'Bob', avatar_url: null, pokemon: ['Gengar', 'Dragonite', 'Mewtwo'] },
  );
}

function dispatch(state: TrackerState, action: TrackerAction): TrackerState {
  return trackerReducer(state, action);
}

// ── createEmptyPlayerState ───────────────────────────────────────────

describe('createEmptyPlayerState', () => {
  it('creates 6 empty slots', () => {
    const ps = createEmptyPlayerState('p1', 'Alice', null);
    expect(ps.slots).toHaveLength(6);
    expect(ps.slots.every((s) => s.pokemon_name === null)).toBe(true);
  });

  it('maps pokemon names to slots when provided', () => {
    const ps = createEmptyPlayerState('p1', 'Alice', null, ['Pikachu', 'Eevee']);
    expect(ps.slots[0].pokemon_name).toBe('Pikachu');
    expect(ps.slots[1].pokemon_name).toBe('Eevee');
    expect(ps.slots[2].pokemon_name).toBeNull();
  });

  it('initializes slot flags to defaults', () => {
    const ps = createEmptyPlayerState('p1', 'Alice', null);
    const slot = ps.slots[0];
    expect(slot.was_brought).toBe(false);
    expect(slot.was_lead).toBe(false);
    expect(slot.was_koed).toBe(false);
    expect(slot.kos_dealt).toBe(0);
    expect(slot.moves_used).toEqual([]);
    expect(slot.turns_active).toBe(0);
  });
});

// ── createInitialState ───────────────────────────────────────────────

describe('createInitialState', () => {
  it('sets match_id', () => {
    const state = baseState();
    expect(state.match_id).toBe('match-1');
  });

  it('starts at game_number 1 with no submitted games', () => {
    const state = baseState();
    expect(state.current_game.game_number).toBe(1);
    expect(state.games_submitted).toEqual([]);
  });

  it('continues game_number from submitted games', () => {
    const submitted: GameSummary[] = [
      { game_number: 1, winner_id: 'p1' } as GameSummary,
      { game_number: 2, winner_id: 'p2' } as GameSummary,
    ];
    const state = createInitialState(
      'match-1',
      { id: 'p1', name: 'Alice', avatar_url: null },
      { id: 'p2', name: 'Bob', avatar_url: null },
      submitted,
    );
    expect(state.current_game.game_number).toBe(3);
  });

  it('has empty history', () => {
    const state = baseState();
    expect(state.history).toEqual([]);
  });

  it('sets player pokemon names on slots', () => {
    const state = baseState();
    expect(state.current_game.player1.slots[0].pokemon_name).toBe('Pikachu');
    expect(state.current_game.player2.slots[0].pokemon_name).toBe('Gengar');
  });
});

// ── applyAction: mark_brought / unmark_brought ───────────────────────

describe('mark_brought / unmark_brought', () => {
  it('marks a slot as brought', () => {
    const state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_brought).toBe(true);
  });

  it('unmarking brought also clears lead', () => {
    let state = dispatch(baseState(), { type: 'mark_lead', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_lead).toBe(true);
    state = dispatch(state, { type: 'unmark_brought', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_brought).toBe(false);
    expect(state.current_game.player1.slots[0].was_lead).toBe(false);
  });
});

// ── applyAction: mark_lead / unmark_lead ─────────────────────────────

describe('mark_lead / unmark_lead', () => {
  it('marking lead auto-marks as brought', () => {
    const state = dispatch(baseState(), { type: 'mark_lead', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_lead).toBe(true);
    expect(state.current_game.player1.slots[0].was_brought).toBe(true);
  });

  it('unmarking lead does not clear brought', () => {
    let state = dispatch(baseState(), { type: 'mark_lead', player: 1, slot: 0 });
    state = dispatch(state, { type: 'unmark_lead', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_lead).toBe(false);
    expect(state.current_game.player1.slots[0].was_brought).toBe(true);
  });
});

// ── applyAction: mark_ko / unmark_ko ─────────────────────────────────

describe('mark_ko / unmark_ko', () => {
  it('marking KO auto-marks as brought', () => {
    const state = dispatch(baseState(), { type: 'mark_ko', player: 2, slot: 1 });
    expect(state.current_game.player2.slots[1].was_koed).toBe(true);
    expect(state.current_game.player2.slots[1].was_brought).toBe(true);
  });

  it('unmarking KO does not clear brought', () => {
    let state = dispatch(baseState(), { type: 'mark_ko', player: 2, slot: 1 });
    state = dispatch(state, { type: 'unmark_ko', player: 2, slot: 1 });
    expect(state.current_game.player2.slots[1].was_koed).toBe(false);
    expect(state.current_game.player2.slots[1].was_brought).toBe(true);
  });
});

// ── applyAction: kos_dealt ───────────────────────────────────────────

describe('increment_ko_dealt / decrement_ko_dealt', () => {
  it('increments KO dealt count and auto-marks brought', () => {
    const state = dispatch(baseState(), { type: 'increment_ko_dealt', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].kos_dealt).toBe(1);
    expect(state.current_game.player1.slots[0].was_brought).toBe(true);
  });

  it('decrements KO dealt count, floor at 0', () => {
    const state = dispatch(baseState(), { type: 'decrement_ko_dealt', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].kos_dealt).toBe(0);
  });

  it('stacks increments', () => {
    let state = baseState();
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].kos_dealt).toBe(3);
  });
});

// ── applyAction: moves ───────────────────────────────────────────────

describe('log_move / remove_move', () => {
  it('adds a move to the slot', () => {
    const state = dispatch(baseState(), { type: 'log_move', player: 1, slot: 0, move: 'Thunderbolt' });
    expect(state.current_game.player1.slots[0].moves_used).toContain('Thunderbolt');
  });

  it('does not duplicate moves', () => {
    let state = dispatch(baseState(), { type: 'log_move', player: 1, slot: 0, move: 'Thunderbolt' });
    state = dispatch(state, { type: 'log_move', player: 1, slot: 0, move: 'Thunderbolt' });
    expect(state.current_game.player1.slots[0].moves_used).toEqual(['Thunderbolt']);
  });

  it('removes a move from the slot', () => {
    let state = dispatch(baseState(), { type: 'log_move', player: 1, slot: 0, move: 'Thunderbolt' });
    state = dispatch(state, { type: 'log_move', player: 1, slot: 0, move: 'Iron Tail' });
    state = dispatch(state, { type: 'remove_move', player: 1, slot: 0, move: 'Thunderbolt' });
    expect(state.current_game.player1.slots[0].moves_used).toEqual(['Iron Tail']);
  });
});

// ── applyAction: pokemon identity ────────────────────────────────────

describe('set_pokemon / clear_pokemon', () => {
  it('sets pokemon name on a slot', () => {
    const state = dispatch(baseState(), { type: 'set_pokemon', player: 1, slot: 5, pokemon: 'Snorlax' });
    expect(state.current_game.player1.slots[5].pokemon_name).toBe('Snorlax');
  });

  it('clear_pokemon resets the slot to empty', () => {
    let state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });
    state = dispatch(state, { type: 'clear_pokemon', player: 1, slot: 0, pokemon: 'Pikachu' });
    const slot = state.current_game.player1.slots[0];
    expect(slot.pokemon_name).toBeNull();
    expect(slot.was_brought).toBe(false);
    expect(slot.kos_dealt).toBe(0);
  });
});

// ── applyAction: turn counter ────────────────────────────────────────

describe('increment_turn / decrement_turn', () => {
  it('increments turn counter', () => {
    const state = dispatch(baseState(), { type: 'increment_turn' });
    expect(state.current_game.turn).toBe(1);
  });

  it('decrements turn counter, floor at 0', () => {
    const state = dispatch(baseState(), { type: 'decrement_turn' });
    expect(state.current_game.turn).toBe(0);
  });
});

// ── trackerReducer: undo ─────────────────────────────────────────────

describe('undo', () => {
  it('reverts the last invertible action', () => {
    let state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    expect(state.current_game.player1.slots[0].was_brought).toBe(true);
    state = trackerReducer(state, { type: 'undo' });
    expect(state.current_game.player1.slots[0].was_brought).toBe(false);
  });

  it('removes the action from history after undo', () => {
    let state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    expect(state.history).toHaveLength(1);
    state = trackerReducer(state, { type: 'undo' });
    expect(state.history).toHaveLength(0);
  });

  it('does nothing when history is empty', () => {
    const state = baseState();
    const undone = trackerReducer(state, { type: 'undo' });
    expect(undone).toBe(state);
  });
});

// ── trackerReducer: submit_game ──────────────────────────────────────

describe('submit_game', () => {
  it('moves current game to games_submitted and resets', () => {
    let state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    const game: GameSummary = { game_number: 1, winner_id: 'p1' } as GameSummary;
    state = trackerReducer(state, { type: 'submit_game', game });
    expect(state.games_submitted).toHaveLength(1);
    expect(state.current_game.game_number).toBe(2);
    expect(state.current_game.turn).toBe(0);
    expect(state.history).toEqual([]);
  });

  it('preserves pokemon names across game reset', () => {
    const game: GameSummary = { game_number: 1, winner_id: 'p1' } as GameSummary;
    const state = trackerReducer(baseState(), { type: 'submit_game', game });
    // Pokemon names should be carried over from original state
    expect(state.current_game.player1.slots[0].pokemon_name).toBe('Pikachu');
    expect(state.current_game.player2.slots[0].pokemon_name).toBe('Gengar');
  });
});

// ── trackerReducer: reset_game ───────────────────────────────────────

describe('reset_game', () => {
  it('resets current game state but preserves pokemon names', () => {
    let state = dispatch(baseState(), { type: 'mark_brought', player: 1, slot: 0 });
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });
    state = trackerReducer(state, { type: 'reset_game' });
    expect(state.current_game.player1.slots[0].was_brought).toBe(false);
    expect(state.current_game.player1.slots[0].kos_dealt).toBe(0);
    expect(state.current_game.player1.slots[0].pokemon_name).toBe('Pikachu');
    expect(state.history).toEqual([]);
  });
});

// ── trackerReducer: load_session ─────────────────────────────────────

describe('load_session', () => {
  it('replaces entire state', () => {
    const newState = baseState();
    newState.match_id = 'loaded-match';
    const result = trackerReducer(baseState(), { type: 'load_session', state: newState });
    expect(result.match_id).toBe('loaded-match');
  });
});

describe('solo tracker helpers', () => {
  it('normalizes blank solo participant identity fields', () => {
    const state = createInitialState(
      '',
      { id: '', name: '', avatar_url: null, pokemon: ['Pikachu'] },
      { id: '', name: '', avatar_url: null, pokemon: ['Gengar'] },
    );

    const normalized = normalizeSoloTrackerState(state, {
      player1: { id: 'owner-1', name: 'Streamer', avatar_url: 'https://example.com/me.png' },
      player2: { id: 'solo-opponent', name: 'Opponent', avatar_url: null },
    });

    expect(normalized.current_game.player1.player_id).toBe('owner-1');
    expect(normalized.current_game.player1.player_name).toBe('Streamer');
    expect(normalized.current_game.player2.player_id).toBe('solo-opponent');
    expect(normalized.current_game.player2.player_name).toBe('Opponent');
  });
});

describe('submit_solo_game', () => {
  it('uses distinct fallback ids so losses are not recorded as wins', () => {
    const state = createInitialState(
      '',
      { id: '', name: 'Streamer', avatar_url: null, pokemon: ['Pikachu'] },
      { id: '', name: 'Opponent', avatar_url: null, pokemon: ['Gengar'] },
    );

    const lostGame = trackerReducer(state, { type: 'submit_solo_game', won: false });

    expect(lostGame.games_submitted).toHaveLength(1);
    expect(lostGame.games_submitted[0].winner_id).toBe('solo-opponent');
    expect(lostGame.current_game.player1.player_id).toBe('solo-player-1');
    expect(lostGame.current_game.player2.player_id).toBe('solo-opponent');
  });
});

describe('reset_opponent', () => {
  it('resets player2 to the canonical solo opponent id', () => {
    const state = createInitialState(
      '',
      { id: 'owner-1', name: 'Streamer', avatar_url: null, pokemon: ['Pikachu'] },
      { id: 'custom-opponent', name: 'Rival', avatar_url: null, pokemon: ['Gengar'] },
    );

    const reset = trackerReducer(state, { type: 'reset_opponent' });

    expect(reset.current_game.player2.player_id).toBe('solo-opponent');
    expect(reset.current_game.player2.player_name).toBe('Opponent');
    expect(reset.current_game.player2.slots.every((slot) => slot.pokemon_name === null)).toBe(true);
  });
});

// ── buildGamePayload ─────────────────────────────────────────────────

describe('buildGamePayload', () => {
  it('builds payload with pokemon stats per player', () => {
    let state = baseState();
    state = dispatch(state, { type: 'mark_brought', player: 1, slot: 0 });
    state = dispatch(state, { type: 'mark_lead', player: 1, slot: 0 });
    state = dispatch(state, { type: 'increment_ko_dealt', player: 1, slot: 0 });

    const payload = buildGamePayload(state, 'p1');
    expect(payload.match_id).toBe('match-1');
    expect(payload.winner_id).toBe('p1');
    expect(payload.pokemon_stats).toHaveLength(2);

    const p1Stats = payload.pokemon_stats[0];
    expect(p1Stats.player_id).toBe('p1');
    // Only non-null pokemon_name slots are included
    expect(p1Stats.pokemon.length).toBe(3);

    const pikachu = p1Stats.pokemon.find((p) => p.pokemon_name === 'Pikachu');
    expect(pikachu?.was_brought).toBe(true);
    expect(pikachu?.was_lead).toBe(true);
    expect(pikachu?.kos_dealt).toBe(1);
  });

  it('excludes slots with null pokemon_name', () => {
    const state = createInitialState(
      'match-1',
      { id: 'p1', name: 'Alice', avatar_url: null },
      { id: 'p2', name: 'Bob', avatar_url: null },
    );
    const payload = buildGamePayload(state, 'p1');
    // No pokemon set → all slots have null pokemon_name → empty arrays
    expect(payload.pokemon_stats[0].pokemon).toHaveLength(0);
  });
});
