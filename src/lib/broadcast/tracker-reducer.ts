import type {
  TrackerState,
  TrackerAction,
  TrackerSlot,
  TrackerPlayerState,
} from '@/types/broadcast';
import type { GameSummary } from '@/types/match';
import type { PokemonSet } from '@/types/team';
import { SOLO_PLAYER2_DEFAULT_NAME } from './solo-defaults';

const SOLO_PLAYER_ID_FALLBACK = 'solo-player-1';
const SOLO_OPPONENT_ID = 'solo-opponent';

// ─── Helpers ──────────────────────────────────────────────────────────

function emptySlot(): TrackerSlot {
  return {
    pokemon_name: null,
    was_brought: false,
    was_lead: false,
    was_koed: false,
    kos_dealt: 0,
    moves_used: [],
    turns_active: 0,
  };
}

export function createEmptyPlayerState(
  playerId: string,
  playerName: string,
  avatarUrl: string | null,
  pokemonNames?: string[]
): TrackerPlayerState {
  const slots: TrackerSlot[] = Array.from({ length: 6 }, (_, i) => ({
    ...emptySlot(),
    pokemon_name: pokemonNames?.[i] ?? null,
  }));
  return { player_id: playerId, player_name: playerName, avatar_url: avatarUrl, slots };
}

export function createInitialState(
  matchId: string,
  player1: { id: string; name: string; avatar_url: string | null; pokemon?: string[] },
  player2: { id: string; name: string; avatar_url: string | null; pokemon?: string[] },
  gamesSubmitted: GameSummary[] = []
): TrackerState {
  return {
    match_id: matchId,
    games_submitted: gamesSubmitted,
    current_game: {
      game_number: gamesSubmitted.length + 1,
      turn: 0,
      player1: createEmptyPlayerState(player1.id, player1.name, player1.avatar_url, player1.pokemon),
      player2: createEmptyPlayerState(player2.id, player2.name, player2.avatar_url, player2.pokemon),
      moments: [],
    },
    history: [],
  };
}

export function normalizeSoloTrackerState(
  state: TrackerState,
  defaults: {
    player1: { id: string; name: string; avatar_url: string | null };
    player2: { id: string; name: string; avatar_url: string | null };
  },
): TrackerState {
  return {
    ...state,
    current_game: {
      ...state.current_game,
      player1: {
        ...state.current_game.player1,
        player_id: state.current_game.player1.player_id || defaults.player1.id,
        player_name: state.current_game.player1.player_name || defaults.player1.name,
        avatar_url: state.current_game.player1.avatar_url ?? defaults.player1.avatar_url,
      },
      player2: {
        ...state.current_game.player2,
        player_id: state.current_game.player2.player_id || defaults.player2.id,
        player_name: state.current_game.player2.player_name || defaults.player2.name,
        avatar_url: state.current_game.player2.avatar_url ?? defaults.player2.avatar_url,
      },
    },
  };
}

// ─── Slot updater ─────────────────────────────────────────────────────

function updateSlot(
  state: TrackerState,
  player: 1 | 2,
  slotIndex: number,
  updater: (slot: TrackerSlot) => TrackerSlot
): TrackerState {
  const key = player === 1 ? 'player1' : 'player2';
  const playerState = state.current_game[key];
  const newSlots = playerState.slots.map((s, i) =>
    i === slotIndex ? updater(s) : s
  );
  return {
    ...state,
    current_game: {
      ...state.current_game,
      [key]: { ...playerState, slots: newSlots },
    },
  };
}

function getPlayerPokemonNames(player: TrackerPlayerState): string[] {
  return player.slots
    .map((slot) => slot.pokemon_name)
    .filter((pokemonName): pokemonName is string => pokemonName !== null);
}

// ─── Pure reducer (no history) ────────────────────────────────────────

function applyAction(state: TrackerState, action: TrackerAction): TrackerState {
  switch (action.type) {
    // ── Brought ──
    case 'mark_brought':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_brought: true,
      }));
    case 'unmark_brought':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_brought: false,
        was_lead: false, // can't be lead if not brought
      }));

    // ── Lead ──
    case 'mark_lead':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_lead: true,
        was_brought: true, // auto-mark as brought
      }));
    case 'unmark_lead':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_lead: false,
      }));

    // ── KO ──
    case 'mark_ko':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_koed: true,
        was_brought: true, // can't be KO'd if not brought
      }));
    case 'unmark_ko':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        was_koed: false,
      }));

    // ── KO dealt ──
    case 'increment_ko_dealt':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        kos_dealt: s.kos_dealt + 1,
        was_brought: true,
      }));
    case 'decrement_ko_dealt':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        kos_dealt: Math.max(0, s.kos_dealt - 1),
      }));

    // ── Moves ──
    case 'log_move':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        moves_used: s.moves_used.includes(action.move)
          ? s.moves_used
          : [...s.moves_used, action.move],
      }));
    case 'remove_move':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        moves_used: s.moves_used.filter((m) => m !== action.move),
      }));

    // ── Pokémon identity ──
    case 'set_pokemon':
      return updateSlot(state, action.player, action.slot, (s) => ({
        ...s,
        pokemon_name: action.pokemon,
      }));
    case 'clear_pokemon':
      return updateSlot(state, action.player, action.slot, () => emptySlot());

    // ── Turn counter ──
    case 'increment_turn':
      return {
        ...state,
        current_game: {
          ...state.current_game,
          turn: state.current_game.turn + 1,
        },
      };
    case 'decrement_turn':
      return {
        ...state,
        current_game: {
          ...state.current_game,
          turn: Math.max(0, state.current_game.turn - 1),
        },
      };

    // ── Moments ──
    case 'mark_moment':
      return {
        ...state,
        current_game: {
          ...state.current_game,
          moments: [...state.current_game.moments, action.moment],
        },
      };

    // ── Cast Studio: Team management ──
    case 'set_team': {
      const teamKey = action.player === 1 ? 'player1' : 'player2';
      const ps = state.current_game[teamKey];
      const newSlots: TrackerSlot[] = Array.from({ length: 6 }, (_, i) => {
        const set: PokemonSet | undefined = action.team[i];
        return set
          ? { ...emptySlot(), pokemon_name: set.species }
          : emptySlot();
      });
      return {
        ...state,
        current_game: {
          ...state.current_game,
          [teamKey]: { ...ps, slots: newSlots },
        },
      };
    }

    case 'update_set':
      // Updates the pokemon_name if species changed
      if (action.set.species !== undefined) {
        return updateSlot(state, action.player, action.slot, (s) => ({
          ...s,
          pokemon_name: action.set.species ?? s.pokemon_name,
        }));
      }
      return state;

    case 'swap_slots': {
      const swapKey = action.player === 1 ? 'player1' : 'player2';
      const swapPlayer = state.current_game[swapKey];
      const newSwapSlots = [...swapPlayer.slots];
      const temp = newSwapSlots[action.from];
      newSwapSlots[action.from] = newSwapSlots[action.to];
      newSwapSlots[action.to] = temp;
      return {
        ...state,
        current_game: {
          ...state.current_game,
          [swapKey]: { ...swapPlayer, slots: newSwapSlots },
        },
      };
    }

    case 'set_facing':
      // Facing state is stored on the state root (not in current_game)
      // Handled by CastStudioContext, not the core reducer
      return state;

    default:
      return state;
  }
}

// ─── Inverse action map (for undo) ───────────────────────────────────

function inverseAction(action: TrackerAction): TrackerAction | null {
  switch (action.type) {
    case 'mark_brought':
      return { type: 'unmark_brought', player: action.player, slot: action.slot };
    case 'unmark_brought':
      return { type: 'mark_brought', player: action.player, slot: action.slot };
    case 'mark_lead':
      return { type: 'unmark_lead', player: action.player, slot: action.slot };
    case 'unmark_lead':
      return { type: 'mark_lead', player: action.player, slot: action.slot };
    case 'mark_ko':
      return { type: 'unmark_ko', player: action.player, slot: action.slot };
    case 'unmark_ko':
      return { type: 'mark_ko', player: action.player, slot: action.slot };
    case 'increment_ko_dealt':
      return { type: 'decrement_ko_dealt', player: action.player, slot: action.slot };
    case 'decrement_ko_dealt':
      return { type: 'increment_ko_dealt', player: action.player, slot: action.slot };
    case 'increment_turn':
      return { type: 'decrement_turn' };
    case 'decrement_turn':
      return { type: 'increment_turn' };
    // Non-invertible actions (moves, pokemon, moments) — undo via snapshot
    default:
      return null;
  }
}

// ─── Dispatch wrapper: action + push to history ──────────────────────

export type TrackerDispatchAction =
  | TrackerAction
  | { type: 'undo' }
  | { type: 'submit_game'; game: GameSummary }
  | { type: 'submit_solo_game'; won: boolean }
  | { type: 'reset_game' }
  | { type: 'reset_opponent' }
  // Cast Studio: load full session state (e.g., from API on page load)
  | { type: 'load_session'; state: TrackerState };

export function trackerReducer(
  state: TrackerState,
  dispatchAction: TrackerDispatchAction
): TrackerState {
  // ── Load Session: replace entire state from persisted session ──
  if (dispatchAction.type === 'load_session') {
    return dispatchAction.state;
  }

  // ── Undo ──
  if (dispatchAction.type === 'undo') {
    const lastAction = state.history[state.history.length - 1];
    if (!lastAction) return state;

    const inverse = inverseAction(lastAction);
    if (inverse) {
      const newState = applyAction(state, inverse);
      return { ...newState, history: state.history.slice(0, -1) };
    }
    // For non-invertible actions, we can't undo cleanly — skip
    return state;
  }

  // ── Submit Game: freeze current game, advance to next ──
  if (dispatchAction.type === 'submit_game') {
    return {
      ...state,
      games_submitted: [...state.games_submitted, dispatchAction.game],
      current_game: {
        game_number: state.games_submitted.length + 2,
        turn: 0,
        player1: createEmptyPlayerState(
          state.current_game.player1.player_id,
          state.current_game.player1.player_name,
          state.current_game.player1.avatar_url,
          getPlayerPokemonNames(state.current_game.player1),
        ),
        player2: createEmptyPlayerState(
          state.current_game.player2.player_id,
          state.current_game.player2.player_name,
          state.current_game.player2.avatar_url,
          getPlayerPokemonNames(state.current_game.player2),
        ),
        moments: [],
      },
      history: [],
    };
  }

  // ── Submit Solo Game: simplified submission without match_id ──
  if (dispatchAction.type === 'submit_solo_game') {
    const p1Id = state.current_game.player1.player_id || SOLO_PLAYER_ID_FALLBACK;
    const p2Id = state.current_game.player2.player_id || SOLO_OPPONENT_ID;
    const game: GameSummary = {
      id: crypto.randomUUID(),
      game_number: state.current_game.game_number,
      winner_id: dispatchAction.won ? p1Id : p2Id,
      replay_url: '',
      source: 'manual',
      stats_locked: false,
    };
    return {
      ...state,
      games_submitted: [...state.games_submitted, game],
      current_game: {
        game_number: state.games_submitted.length + 2,
        turn: 0,
        player1: createEmptyPlayerState(
          p1Id,
          state.current_game.player1.player_name,
          state.current_game.player1.avatar_url,
          getPlayerPokemonNames(state.current_game.player1),
        ),
        player2: createEmptyPlayerState(
          p2Id,
          state.current_game.player2.player_name,
          state.current_game.player2.avatar_url,
          getPlayerPokemonNames(state.current_game.player2),
        ),
        moments: [],
      },
      history: [],
    };
  }

  // ── Reset Opponent: clear player2 for a new opponent (solo mode) ──
  if (dispatchAction.type === 'reset_opponent') {
    return {
      ...state,
      current_game: {
        ...state.current_game,
        turn: 0,
        player2: createEmptyPlayerState(SOLO_OPPONENT_ID, SOLO_PLAYER2_DEFAULT_NAME, null),
        moments: [],
      },
      history: [],
    };
  }

  // ── Reset Game: clear current game state ──
  if (dispatchAction.type === 'reset_game') {
    return {
      ...state,
      current_game: {
        ...state.current_game,
        turn: 0,
        player1: createEmptyPlayerState(
          state.current_game.player1.player_id,
          state.current_game.player1.player_name,
          state.current_game.player1.avatar_url,
          getPlayerPokemonNames(state.current_game.player1),
        ),
        player2: createEmptyPlayerState(
          state.current_game.player2.player_id,
          state.current_game.player2.player_name,
          state.current_game.player2.avatar_url,
          getPlayerPokemonNames(state.current_game.player2),
        ),
        moments: [],
      },
      history: [],
    };
  }

  // ── Normal action: apply + push to undo stack ──
  const newState = applyAction(state, dispatchAction);
  return {
    ...newState,
    history: [...state.history, dispatchAction],
  };
}

// ─── Build submission payload ─────────────────────────────────────────

export function buildGamePayload(state: TrackerState, winnerId: string) {
  const { player1, player2 } = state.current_game;

  const pokemonStats = [player1, player2].map((p) => ({
    player_id: p.player_id,
    pokemon: p.slots
      .filter((s) => s.pokemon_name !== null)
      .map((s) => ({
        pokemon_name: s.pokemon_name!,
        was_brought: s.was_brought,
        was_lead: s.was_lead,
        was_koed: s.was_koed,
        kos_dealt: s.kos_dealt,
        moves_used: s.moves_used,
        turns_active: s.turns_active,
      })),
  }));

  return {
    match_id: state.match_id,
    winner_id: winnerId,
    pokemon_stats: pokemonStats,
    moments: state.current_game.moments,
  };
}
