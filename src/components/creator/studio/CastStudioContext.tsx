'use client';

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  trackerReducer,
  createInitialState,
  normalizeSoloTrackerState,
  type TrackerDispatchAction,
} from '@/lib/broadcast/tracker-reducer';
import {
  createCastChannel,
  type CastChannelMessage,
  type CastChannelStatus,
} from '@/lib/broadcast/channel';
import { soloPlayerDefaults } from '@/lib/broadcast/solo-defaults';
import type { TrackerState } from '@/types/broadcast';
import type { PokemonSet } from '@/types/team';
import type { GameSummary } from '@/types/match';
import type {
  CastSession,
  CastSessionUpdate,
  CastSessionMode,
  CastSessionPopulateResult,
  CastSessionRealtimeAction,
} from '@/types/cast-session';

// ─── Studio-level state (wraps tracker state + session metadata) ───

export interface CastStudioState {
  sessionId: string;
  sessionName: string;
  mode: CastSessionMode;
  format: string;
  generation: number;
  matchId: string | null;
  tournamentId: string | null;
  seasonId: string | null;
  player1Team: PokemonSet[];
  player2Team: PokemonSet[];
  tracker: TrackerState;
  facing: { player1Slot: number | null; player2Slot: number | null };
  showFacing: boolean;
  dirty: boolean;
  saving: boolean;
  syncStatus: CastChannelStatus;
  lastSavedAt: string | null;
}

interface TrackerParticipant {
  id: string | null;
  name: string | null;
  avatar_url: string | null;
  team: PokemonSet[];
}

function createEmptyPokemonSet(): PokemonSet {
  return {
    name: '',
    species: '',
    gender: '',
    item: '',
    ability: '',
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Hardy',
    level: 100,
    moves: [],
  };
}

function getTeamSpecies(team: PokemonSet[]): string[] {
  return team
    .map((set) => set.species)
    .filter((species): species is string => species.length > 0);
}

function buildTrackerState(
  matchId: string | null,
  player1: TrackerParticipant,
  player2: TrackerParticipant,
  gamesSubmitted: GameSummary[] = [],
): TrackerState {
  return createInitialState(
    matchId ?? '',
    {
      id: player1.id ?? '',
      // Stored sentinel (data, stays English): broadcast consumers render it
      // as before, and CastStudio maps it to the localized 'Player {n}'.
      name: player1.name ?? 'Player 1',
      avatar_url: player1.avatar_url,
      pokemon: getTeamSpecies(player1.team),
    },
    {
      id: player2.id ?? '',
      name: player2.name ?? 'Player 2',
      avatar_url: player2.avatar_url,
      pokemon: getTeamSpecies(player2.team),
    },
    gamesSubmitted,
  );
}

function ensureTeamSlots(team: PokemonSet[], minLength = 6): PokemonSet[] {
  const size = Math.max(team.length, minLength);
  return Array.from({ length: size }, (_, index) => team[index] ?? createEmptyPokemonSet());
}

function normalizeSessionTracker(session: CastSession, tracker: TrackerState): TrackerState {
  if (session.mode !== 'solo') return tracker;

  return normalizeSoloTrackerState(tracker, soloPlayerDefaults(session));
}

function buildCastSessionUpdate(state: CastStudioState): CastSessionUpdate {
  return {
    name: state.sessionName,
    mode: state.mode,
    match_id: state.matchId,
    tournament_id: state.tournamentId,
    season_id: state.seasonId,
    player1_id: state.tracker.current_game.player1.player_id || null,
    player1_name: state.tracker.current_game.player1.player_name || null,
    player1_avatar_url: state.tracker.current_game.player1.avatar_url,
    player2_id: state.tracker.current_game.player2.player_id || null,
    player2_name: state.tracker.current_game.player2.player_name || null,
    player2_avatar_url: state.tracker.current_game.player2.avatar_url,
    player1_team: state.player1Team,
    player2_team: state.player2Team,
    tracker_state: state.tracker as unknown as Record<string, unknown>,
    format: state.format,
    generation: state.generation,
  };
}

type StudioAction =
  | { type: 'tracker'; action: TrackerDispatchAction }
  | { type: 'set_player1_team'; team: PokemonSet[] }
  | { type: 'set_player2_team'; team: PokemonSet[] }
  | { type: 'update_player1_set'; slot: number; set: Partial<PokemonSet> }
  | { type: 'update_player2_set'; slot: number; set: Partial<PokemonSet> }
  | { type: 'set_facing'; player1Slot: number | null; player2Slot: number | null }
  | { type: 'toggle_show_facing' }
  | { type: 'set_session_name'; name: string }
  | { type: 'set_mode'; mode: CastSessionMode }
  | { type: 'set_match'; matchId: string; tournamentId: string | null; seasonId: string | null }
  | { type: 'set_format'; format: string; generation: number }
  | { type: 'new_opponent' }
  | { type: 'mark_saved'; timestamp: string }
  | { type: 'mark_saving' }
  | { type: 'populate_match'; data: CastSessionPopulateResult }
  | { type: 'load_session'; session: CastSession }
  | { type: 'set_sync_status'; status: CastChannelStatus };

function isRealtimeStudioAction(action: StudioAction): action is CastSessionRealtimeAction {
  return [
    'set_session_name',
    'set_mode',
    'set_match',
    'set_format',
    'new_opponent',
    'toggle_show_facing',
    'populate_match',
  ].includes(action.type);
}

function updateTeamSet(team: PokemonSet[], slot: number, update: Partial<PokemonSet>): PokemonSet[] {
  return ensureTeamSlots(team, Math.max(6, slot + 1)).map((set, i) => (
    i === slot ? { ...set, ...update } : set
  ));
}

function studioReducer(state: CastStudioState, action: StudioAction): CastStudioState {
  switch (action.type) {
    case 'tracker':
      return { ...state, tracker: trackerReducer(state.tracker, action.action), dirty: true };

    case 'set_player1_team':
      return { ...state, player1Team: action.team, dirty: true };
    case 'set_player2_team':
      return { ...state, player2Team: action.team, dirty: true };

    case 'update_player1_set':
      return { ...state, player1Team: updateTeamSet(state.player1Team, action.slot, action.set), dirty: true };
    case 'update_player2_set':
      return { ...state, player2Team: updateTeamSet(state.player2Team, action.slot, action.set), dirty: true };

    case 'set_facing':
      return { ...state, facing: { player1Slot: action.player1Slot, player2Slot: action.player2Slot }, dirty: true };
    case 'toggle_show_facing':
      return { ...state, showFacing: !state.showFacing, dirty: true };

    case 'set_session_name':
      return { ...state, sessionName: action.name, dirty: true };
    case 'set_mode':
      return { ...state, mode: action.mode, dirty: true };
    case 'set_match':
      return { ...state, matchId: action.matchId, tournamentId: action.tournamentId, seasonId: action.seasonId, dirty: true };
    case 'set_format':
      return { ...state, format: action.format, generation: action.generation, dirty: true };

    case 'new_opponent':
      return {
        ...state,
        player2Team: ensureTeamSlots([], 6),
        tracker: trackerReducer(state.tracker, { type: 'reset_opponent' }),
        dirty: true,
      };

    case 'mark_saving':
      return { ...state, saving: true };
    case 'mark_saved':
      return { ...state, dirty: false, saving: false, lastSavedAt: action.timestamp };
    case 'set_sync_status':
      return { ...state, syncStatus: action.status };

    case 'populate_match':
      return {
        ...state,
        matchId: action.data.match.id,
        tournamentId: action.data.match.tournament_id,
        seasonId: action.data.match.season_id,
        format: action.data.format ?? state.format,
        generation: action.data.generation ?? state.generation,
        player1Team: action.data.player1_team,
        player2Team: action.data.player2_team,
        tracker: buildTrackerState(
          action.data.match.id,
          {
            id: action.data.player1.id,
            name: action.data.player1.name,
            avatar_url: action.data.player1.avatar_url,
            team: action.data.player1_team,
          },
          {
            id: action.data.player2.id,
            name: action.data.player2.name,
            avatar_url: action.data.player2.avatar_url,
            team: action.data.player2_team,
          },
          action.data.games,
        ),
        dirty: true,
        saving: false,
      };

    case 'load_session': {
      const s = action.session;
      const defaults = s.mode === 'solo' ? soloPlayerDefaults(s) : null;
      const trackerState = s.tracker_state
        ? normalizeSessionTracker(s, s.tracker_state as unknown as TrackerState)
        : buildTrackerState(
            s.match_id,
            {
              id: defaults?.player1.id ?? s.player1_id,
              name: defaults?.player1.name ?? s.player1_name,
              avatar_url: s.player1_avatar_url,
              team: s.player1_team,
            },
            {
              id: defaults?.player2.id ?? s.player2_id,
              name: defaults?.player2.name ?? s.player2_name,
              avatar_url: s.player2_avatar_url,
              team: s.player2_team,
            },
          );
      return {
        ...state,
        sessionId: s.id,
        sessionName: s.name,
        mode: s.mode,
        format: s.format,
        generation: s.generation,
        matchId: s.match_id,
        tournamentId: s.tournament_id,
        seasonId: s.season_id,
        player1Team: s.player1_team,
        player2Team: s.player2_team,
        tracker: trackerState,
        dirty: false,
        saving: false,
        syncStatus: state.syncStatus,
        lastSavedAt: s.updated_at,
      };
    }

    default:
      return state;
  }
}

// ─── Context ───────────────────────────────────────────────────────

interface CastStudioContextValue {
  state: CastStudioState;
  dispatch: (action: StudioAction) => void;
  dispatchTracker: (action: TrackerDispatchAction) => void;
  setFacing: (p1Slot: number | null, p2Slot: number | null) => void;
  setPlayer1Team: (team: PokemonSet[]) => void;
  setPlayer2Team: (team: PokemonSet[]) => void;
  updatePlayer1Set: (slot: number, set: Partial<PokemonSet>) => void;
  updatePlayer2Set: (slot: number, set: Partial<PokemonSet>) => void;
}

const CastStudioCtx = createContext<CastStudioContextValue | null>(null);

export function useCastStudio(): CastStudioContextValue {
  const ctx = useContext(CastStudioCtx);
  if (!ctx) throw new Error('useCastStudio must be used within CastStudioProvider');
  return ctx;
}

// ─── Provider ──────────────────────────────────────────────────────

interface CastStudioProviderProps {
  session: CastSession;
  children: ReactNode;
}

export function CastStudioProvider({ session, children }: CastStudioProviderProps) {
  const defaults = session.mode === 'solo' ? soloPlayerDefaults(session) : null;
  const initialTracker = session.tracker_state
    ? normalizeSessionTracker(session, session.tracker_state as unknown as TrackerState)
    : buildTrackerState(
        session.match_id,
        {
          id: defaults?.player1.id ?? session.player1_id,
          name: defaults?.player1.name ?? session.player1_name,
          avatar_url: session.player1_avatar_url,
          team: session.player1_team,
        },
        {
          id: defaults?.player2.id ?? session.player2_id,
          name: defaults?.player2.name ?? session.player2_name,
          avatar_url: session.player2_avatar_url,
          team: session.player2_team,
        },
      );

  const [state, dispatch] = useReducer(studioReducer, {
    sessionId: session.id,
    sessionName: session.name,
    mode: session.mode,
    format: session.format,
    generation: session.generation,
    matchId: session.match_id,
    tournamentId: session.tournament_id,
    seasonId: session.season_id,
    player1Team: session.player1_team,
    player2Team: session.player2_team,
    tracker: initialTracker,
    facing: { player1Slot: null, player2Slot: null },
    showFacing: false,
    dirty: false,
    saving: false,
    syncStatus: session.realtime_key ? 'connecting' : 'local-only',
    lastSavedAt: session.updated_at,
  });

  // ── Auto-save (debounced 5s) ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    if (!state.dirty) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const current = stateRef.current;
      dispatch({ type: 'mark_saving' });

      try {
        await fetch(`/api/cast-sessions/${current.sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCastSessionUpdate(current)),
        });
        dispatch({ type: 'mark_saved', timestamp: new Date().toISOString() });
      } catch {
        // Save failed — state remains dirty, will retry on next change
      }
    }, 5000);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [state]);

  // ── Save on unload ──
  useEffect(() => {
    const handleUnload = () => {
      if (!stateRef.current.dirty) return;
      const current = stateRef.current;
      void fetch(
        `/api/cast-sessions/${current.sessionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildCastSessionUpdate(current)),
          keepalive: true,
        },
      ).catch(() => {
        // Ignore unload save failures
      });
    };
    window.addEventListener('pagehide', handleUnload);
    return () => window.removeEventListener('pagehide', handleUnload);
  }, []);

  // ── BroadcastChannel for second-screen sync ──
  const channelRef = useRef<ReturnType<typeof createCastChannel> | null>(null);

  useEffect(() => {
    const ch = createCastChannel(session.id, {
      realtimeKey: session.realtime_key,
      onStatusChange: (status) => dispatch({ type: 'set_sync_status', status }),
    });
    channelRef.current = ch;

    ch.onMessage((msg: CastChannelMessage) => {
      switch (msg.type) {
        case 'team_update':
          if (msg.player === 1) dispatch({ type: 'set_player1_team', team: msg.team });
          else dispatch({ type: 'set_player2_team', team: msg.team });
          dispatch({ type: 'tracker', action: { type: 'set_team', player: msg.player, team: msg.team } });
          break;
        case 'set_update':
          if (msg.player === 1) dispatch({ type: 'update_player1_set', slot: msg.slot, set: msg.set });
          else dispatch({ type: 'update_player2_set', slot: msg.slot, set: msg.set });
          if (msg.set.species !== undefined) {
            dispatch({ type: 'tracker', action: { type: 'update_set', player: msg.player, slot: msg.slot, set: msg.set } });
          }
          break;
        case 'facing':
          dispatch({ type: 'set_facing', player1Slot: msg.player1Slot, player2Slot: msg.player2Slot });
          break;
        case 'studio_action':
          dispatch(msg.action);
          break;
        case 'tracker_action':
          dispatch({ type: 'tracker', action: msg.action });
          break;
        case 'request_sync':
          ch.send({ type: 'studio_action', action: { type: 'set_session_name', name: stateRef.current.sessionName } });
          ch.send({ type: 'studio_action', action: { type: 'set_mode', mode: stateRef.current.mode } });
          ch.send({ type: 'studio_action', action: { type: 'set_format', format: stateRef.current.format, generation: stateRef.current.generation } });
          ch.send({
            type: 'studio_action',
            action: {
              type: 'set_match',
              matchId: stateRef.current.matchId ?? '',
              tournamentId: stateRef.current.tournamentId,
              seasonId: stateRef.current.seasonId,
            },
          });
          ch.send({ type: 'tracker_action', action: { type: 'load_session', state: stateRef.current.tracker } });
          ch.send({ type: 'team_update', player: 1, team: stateRef.current.player1Team });
          ch.send({ type: 'team_update', player: 2, team: stateRef.current.player2Team });
          ch.send({
            type: 'facing',
            player1Slot: stateRef.current.facing.player1Slot,
            player2Slot: stateRef.current.facing.player2Slot,
            pokemon1:
              stateRef.current.facing.player1Slot !== null
                ? stateRef.current.player1Team[stateRef.current.facing.player1Slot] ?? null
                : null,
            pokemon2:
              stateRef.current.facing.player2Slot !== null
                ? stateRef.current.player2Team[stateRef.current.facing.player2Slot] ?? null
                : null,
          });
          break;
      }
    });

    return () => ch.close();
  }, [session.id, session.realtime_key]);

  const dispatchStudio = useCallback((action: StudioAction) => {
    dispatch(action);
    if (isRealtimeStudioAction(action)) {
      channelRef.current?.send({ type: 'studio_action', action });
    }
  }, []);

  // ── Convenience dispatchers ──
  const dispatchTracker = useCallback((action: TrackerDispatchAction) => {
    dispatch({ type: 'tracker', action });
    channelRef.current?.send({ type: 'tracker_action', action });
  }, []);

  const setFacing = useCallback((p1Slot: number | null, p2Slot: number | null) => {
    dispatch({ type: 'set_facing', player1Slot: p1Slot, player2Slot: p2Slot });
    channelRef.current?.send({
      type: 'facing',
      player1Slot: p1Slot,
      player2Slot: p2Slot,
      pokemon1: p1Slot !== null ? stateRef.current.player1Team[p1Slot] ?? null : null,
      pokemon2: p2Slot !== null ? stateRef.current.player2Team[p2Slot] ?? null : null,
    });
  }, []);

  const setPlayer1Team = useCallback((team: PokemonSet[]) => {
    dispatch({ type: 'set_player1_team', team });
    dispatch({ type: 'tracker', action: { type: 'set_team', player: 1, team } });
    channelRef.current?.send({ type: 'team_update', player: 1, team });
  }, []);

  const setPlayer2Team = useCallback((team: PokemonSet[]) => {
    dispatch({ type: 'set_player2_team', team });
    dispatch({ type: 'tracker', action: { type: 'set_team', player: 2, team } });
    channelRef.current?.send({ type: 'team_update', player: 2, team });
  }, []);

  const updatePlayer1Set = useCallback((slot: number, set: Partial<PokemonSet>) => {
    dispatch({ type: 'update_player1_set', slot, set });
    if (set.species !== undefined) {
      dispatch({ type: 'tracker', action: { type: 'update_set', player: 1, slot, set } });
    }
    channelRef.current?.send({ type: 'set_update', player: 1, slot, set });
  }, []);

  const updatePlayer2Set = useCallback((slot: number, set: Partial<PokemonSet>) => {
    dispatch({ type: 'update_player2_set', slot, set });
    if (set.species !== undefined) {
      dispatch({ type: 'tracker', action: { type: 'update_set', player: 2, slot, set } });
    }
    channelRef.current?.send({ type: 'set_update', player: 2, slot, set });
  }, []);

  const value: CastStudioContextValue = {
    state,
    dispatch: dispatchStudio,
    dispatchTracker,
    setFacing,
    setPlayer1Team,
    setPlayer2Team,
    updatePlayer1Set,
    updatePlayer2Set,
  };

  return <CastStudioCtx.Provider value={value}>{children}</CastStudioCtx.Provider>;
}
