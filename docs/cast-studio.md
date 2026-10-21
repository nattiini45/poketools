# Cast Studio Module

## Overview
The Cast Studio replaces the old "Live Battle Tracker" with a persistent, session-based broadcast workspace. It supports livecasts, replaycasts, and solo streaming with inline team editing, structured match selection, second-screen calc/speed tools, local BroadcastChannel sync, and scoped Supabase Realtime sync for multi-device use.

## File Structure
```
src/types/cast-session.ts                          # CastSession, CastSessionUpdate, CastSessionPopulateResult
src/lib/supabase/queries/cast-sessions.ts          # CRUD: list, get, create, update, delete
src/lib/broadcast/tracker-reducer.ts               # Extended with set_team, update_set, swap_slots, load_session
src/lib/broadcast/channel.ts                       # BroadcastChannel + Supabase Realtime wrapper
src/lib/supabase/realtime-client.ts                # Browser anon Realtime client, no table writes
src/app/api/cast-sessions/route.ts                 # GET (list), POST (create)
src/app/api/cast-sessions/[id]/route.ts            # GET, PATCH (auto-save), DELETE
src/app/api/cast-sessions/[id]/populate/route.ts   # POST: auto-fill from match data
src/components/creator/studio/
├── CastStudioContext.tsx    # Provider: state, auto-save, BroadcastChannel
├── CastStudio.tsx           # Main workspace component
├── CastToolbar.tsx          # Session name, mode, format, facing toggle, tools link
├── MatchSelector.tsx        # Cascading: season → tournament → round → match
├── SessionManager.tsx       # Session list + create new
├── CastTeamEditor.tsx       # Inline team editor (wraps strip + set editor)
├── CastTeamStrip.tsx        # 6-slot horizontal team strip
├── CastSetEditor.tsx        # Expanded set editor with standalone pickers
├── tools/
│   ├── ToolsLayout.tsx      # Second-screen entry: BroadcastChannel listener
│   ├── FacingPanel.tsx      # Two facing Pokémon side-by-side
│   └── ToolsTabs.tsx        # Speed/damage/field calculator tabs
└── solo/
    ├── SoloLayout.tsx       # Solo streamer layout
    ├── KOTracker.tsx        # Per-Pokémon KO/death tracker
    └── KOStatCard.tsx       # Single Pokémon KO stat card
src/app/creator/studio/page.tsx                    # Session picker page
src/app/creator/studio/[sessionId]/page.tsx        # Active cast session
src/app/creator/studio/[sessionId]/tools/page.tsx  # Second-screen tools
src/app/creator/studio/[sessionId]/solo/page.tsx   # Solo streamer layout
src/app/broadcast/solo/[sessionId]/ko-stats/page.tsx  # Public KO stats overlay
```

## Core Functions/Classes

### CastStudioContext
- **Provider**: `CastStudioProvider` wraps session data into a `useReducer` state machine
- **Auto-save**: 5s debounce → PATCH, `sendBeacon` on unload, `sessionStorage` backup
- **BroadcastChannel**: Real-time sync between main studio and tools tabs
- **Key actions**: `set_player1_team`, `set_player2_team`, `update_player1_set`, `update_player2_set`, `set_facing`, `toggle_show_facing`, `set_match`, `set_format`

### Tracker Reducer Extensions
- `set_team`: Replace all 6 slots from a `PokemonSet[]`
- `update_set`: Update species in a tracker slot when set changes
- `swap_slots`: Reorder slots
- `load_session`: Replace entire tracker state from persisted session

### Broadcast / Realtime Channel
- Local channel name: `cast-studio-${sessionId}`
- Supabase channel name: `cast-studio-${sessionId}-${realtime_key}`
- Messages: `facing`, `team_update`, `set_update`, `studio_action`, `tracker_action`, `tracker_sync`, `request_sync`, `timer_sync`, `lower_third_update`
- Browser Supabase is subscribe/broadcast-only. Session persistence stays on `PATCH /api/cast-sessions/[id]`.
- `CastToolbar` displays Realtime/Local/Syncing state.

## Data Flows
1. **Session creation**: POST `/api/cast-sessions` → new session with defaults
2. **Match selection**: MatchSelector cascade → POST `/api/cast-sessions/[id]/populate` → merge match/team/player data. The League select lists test leagues too, so a cast can be rehearsed on one: it reads the public `GET /api/seasons` (`STUDIO_SEASONS_URL`), which lists test leagues for every viewer, after the real leagues (tests: `src/app/api/seasons/__tests__/route.test.ts`, `src/components/creator/studio/__tests__/MatchSelector.seasons.test.ts`). The round's matches come from `GET /api/tournaments/[tid]/rounds/[rid]`; the result is kept with the round it answers (`roundMatchesKey`, `matchOptionsFor`), so switching rounds empties the Match select until the new round's matches arrive, a late response for another round is dropped, and a failed load shows an error with a Retry instead of the previous round's matches (tests: `src/components/creator/studio/__tests__/MatchSelector.round-matches.test.tsx`)
3. **Team editing**: CastSetEditor → `updatePlayer1Set(slot, partialSet)` → CastStudioContext → BroadcastChannel/Supabase broadcast → auto-save through API
4. **Second screen**: Main tab sends `facing` message → Tools tab receives locally or over Realtime → loads into calc/speed tools
5. **Game submission**: TrackerControls → `submit_game` → POST `/api/manual-result`. The game's marked moments go in the same request (at most 100 per game, `turn_number` ≤ 1000, note ≤ 500 characters: `src/lib/broadcast/moment-limits.ts`; the tracker disables marking at the cap). The route binds every moment to the recorded match, game and caller. If the game is recorded but its moments cannot be saved, the route still answers 200 (a retry would record the game twice), logs the error, and returns `moments_saved: 0` plus `warning: { code: 'manual_result_moments_not_saved', params: { count } }`; the tracker shows that warning (`readManualResultResponse`, `src/lib/broadcast/manual-result-response.ts`)

## Dependencies
- [Broadcast Module](./broadcast.md) — tracker reducer, overlay config, OverlayShell
- [PKMN Module](./pkmn.md) — species/move/item/ability search, sprites, speed/damage calc
- [Supabase Module](./supabase.md) — cast_sessions table CRUD
- [Auth Module](./auth.md) — `requireCreator()` gate
- [Team Module](./team.md) — `PokemonSet` type, `getPlayerTeamForTournament()`

## Related Modules
- [Broadcast Module](./broadcast.md) — overlays, tracker components
- [Wiki Module](./wiki.md) — wiki overlays accessible from Cast Studio
- [Creator Hub Module](./creator-hub.md) — parent routing
