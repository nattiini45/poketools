import type {
  DraftReplayEvent,
  DraftReplayPickData,
} from '@/types/broadcast';

// ─── Replay State ─────────────────────────────────────────────────────

export interface DraftReplayState {
  draft_pool_id: string;
  events: DraftReplayEvent[];
  /** Current event index (0-based). -1 = not started. */
  currentIndex: number;
  /** Playback speed multiplier. */
  speed: number;
  /** Whether replay is currently playing. */
  playing: boolean;
  /** Reconstructed rosters: player_id → pokemon_name[] */
  rosters: Record<string, string[]>;
  /** Reconstructed budgets: player_id → remaining budget (null if not budget draft) */
  budgets: Record<string, number> | null;
  /** player_id → player_name lookup */
  playerNames: Record<string, string>;
}

// ─── Initialize ───────────────────────────────────────────────────────

export function createReplayState(
  draftPoolId: string,
  events: DraftReplayEvent[],
  initialBudget?: number,
  playerIds?: string[]
): DraftReplayState {
  const budgets = initialBudget != null && playerIds
    ? Object.fromEntries(playerIds.map((id) => [id, initialBudget]))
    : null;

  // Build player name lookup from pick events
  const playerNames: Record<string, string> = {};
  for (const event of events) {
    if (event.event_type === 'pick') {
      const data = event.event_data as DraftReplayPickData;
      playerNames[data.player_id] = data.player_name;
    }
  }

  return {
    draft_pool_id: draftPoolId,
    events: events.sort((a, b) => a.sequence_number - b.sequence_number),
    currentIndex: -1,
    speed: 1,
    playing: false,
    rosters: {},
    budgets,
    playerNames,
  };
}

// ─── Advance to specific index (rebuild state) ───────────────────────

export function advanceToIndex(
  state: DraftReplayState,
  targetIndex: number
): DraftReplayState {
  // Rebuild from scratch up to targetIndex
  const rosters: Record<string, string[]> = {};
  const budgets: Record<string, number> | null = state.budgets
    ? { ...Object.fromEntries(Object.keys(state.budgets).map((k) => [k, state.budgets![k]])) }
    : null;

  // Re-initialize budgets from original values if going backwards
  if (state.budgets) {
    // Find first pick event to get initial budget hint
    const firstPick = state.events.find((e) => e.event_type === 'pick');
    if (firstPick) {
      const data = firstPick.event_data as DraftReplayPickData;
      const initialBudget = (data.remaining_budget ?? 0) + (data.points_spent ?? 0);
      for (const key of Object.keys(budgets!)) {
        budgets![key] = initialBudget;
      }
    }
  }

  for (let i = 0; i <= targetIndex && i < state.events.length; i++) {
    const event = state.events[i];
    if (event.event_type === 'pick') {
      const data = event.event_data as DraftReplayPickData;
      if (!rosters[data.player_id]) rosters[data.player_id] = [];
      rosters[data.player_id].push(data.pokemon_name);
      if (budgets && data.remaining_budget != null) {
        budgets[data.player_id] = data.remaining_budget;
      }
    }
  }

  return {
    ...state,
    currentIndex: Math.min(targetIndex, state.events.length - 1),
    rosters,
    budgets,
  };
}

// ─── Step forward/backward ────────────────────────────────────────────

export function stepForward(state: DraftReplayState): DraftReplayState {
  if (state.currentIndex >= state.events.length - 1) {
    return { ...state, playing: false };
  }
  return advanceToIndex(state, state.currentIndex + 1);
}

export function stepBackward(state: DraftReplayState): DraftReplayState {
  if (state.currentIndex <= 0) {
    return advanceToIndex(state, -1);
  }
  return advanceToIndex(state, state.currentIndex - 1);
}

// ─── Jump to round ───────────────────────────────────────────────────

export function jumpToRound(state: DraftReplayState, round: number): DraftReplayState {
  // Find the first event of the target round
  const targetIndex = state.events.findIndex((e) => {
    if (e.event_type === 'pick') {
      return (e.event_data as DraftReplayPickData).round >= round;
    }
    return false;
  });

  if (targetIndex === -1) return state;
  return advanceToIndex(state, targetIndex);
}

// ─── Get current event ───────────────────────────────────────────────

export function getCurrentEvent(state: DraftReplayState): DraftReplayEvent | null {
  if (state.currentIndex < 0 || state.currentIndex >= state.events.length) {
    return null;
  }
  return state.events[state.currentIndex];
}

// ─── Get effective display duration ──────────────────────────────────

export function getDisplayDuration(state: DraftReplayState): number {
  const event = getCurrentEvent(state);
  if (!event) return 0;
  return Math.round(event.display_duration_ms / state.speed);
}

// ─── Get total rounds in the replay ──────────────────────────────────

export function getTotalRounds(state: DraftReplayState): number {
  let maxRound = 0;
  for (const event of state.events) {
    if (event.event_type === 'pick') {
      const data = event.event_data as DraftReplayPickData;
      if (data.round > maxRound) maxRound = data.round;
    }
  }
  return maxRound;
}
