# Teambuilder Broadcast

### Overview

How broadcast (OBS overlay) surfaces show a team. The overlays are the **legacy `src/components/broadcast/` components** — the migration to a v3 `BroadcastTeam` family under `v3/broadcast/` is **not started** (`src/components/AGENTS.md`, "Teambuilder (v3)"). There is no `BroadcastTeam`, `TeamCardBroadcastPrimitive`, or `variants/` directory; the earlier design note that described them was superseded. A reader needing the shared per-Pokémon card should look at `src/components/teambuilder/v3/primitives/TeamCardPrimitive.tsx`, composed by `TeamDisplay` and `TeamsEditor` (the legacy broadcast components render their own card markup).

### File Structure

```
src/components/broadcast/
├── overlays/
│   ├── TeamComparison.tsx    side-by-side 6v6 registered teams (items, abilities, moves)
│   ├── SoloTeamPreview.tsx   solo cast session's teams, polled live
│   └── …                   (MatchPreview, MatchStory, etc. — see docs/broadcast.md)
├── shared/
│   └── OverlayTeamStrip.tsx  one team's sprite row, embedded by other overlays
└── tracker/
    └── TrackerTeamColumn.tsx the battle tracker's per-player team column (live KO/lead state)
```

### Core Functions/Classes

- **`TeamComparison`** (`overlays/TeamComparison.tsx`) — side-by-side 6v6 overlay. Fetches `GET /api/broadcast/preview/[mid]` once, derives each side's `EnrichedPokemonState[]`, and renders `OverlayPokemonSprite` + `OverlayPlayerBadge` cards inside an `AnimatedReveal`. Route: `src/app/(broadcast)/broadcast/match/[mid]/teams/page.tsx`.
- **`SoloTeamPreview`** (`overlays/SoloTeamPreview.tsx`) — solo streamer's team preview; polls the cast session through `useSoloBroadcastPoll(sessionId)` (`src/lib/broadcast/use-solo-broadcast.ts`). Route: `src/app/(broadcast)/broadcast/solo/[sessionId]/team-preview/page.tsx`.
- **`OverlayTeamStrip`** (`shared/OverlayTeamStrip.tsx`) — presentational sprite row for one team; embedded by `overlays/MatchPreview.tsx`, `overlays/MatchStory.tsx` and `shared/OverlayMatchCard.tsx`.
- **`TrackerTeamColumn`** (`tracker/TrackerTeamColumn.tsx`) — one side of the live battle tracker (`tracker/BattleTracker.tsx`): the roster column whose KO / lead / MVP state comes from the tracker's `tracker_state` and re-renders on each broadcast tick.

### Data Flows

**Match team comparison**:
1. `/broadcast/match/[mid]/teams` mounts `TeamComparison` with the overlay `config`.
2. The component fetches `/api/broadcast/preview/[mid]` once and keeps `MatchPreviewData` in state.
3. It derives `player1_team` / `player2_team` and renders both sides.

**Solo team preview**:
1. `/broadcast/solo/[sessionId]/team-preview` mounts `SoloTeamPreview`.
2. `useSoloBroadcastPoll` repolls the cast session (default 5 s) so roster changes reach OBS.

**Tracker strip**:
1. The battle tracker owns `tracker_state`; `TrackerTeamColumn` derives brought/alive/KO'd/MVP per Pokémon and re-renders per tick.

### Dependencies

- **Internal**: `src/lib/broadcast/use-solo-broadcast.ts` (polling), `src/types/broadcast.ts` (`EnrichedPokemonState`), the `shared/` overlay primitives (`OverlayShell`, `OverlayPokemonSprite`, `OverlayPlayerBadge`, `OverlayMatchCard`, `AnimatedReveal`), `src/i18n/messages/broadcast-overlays` and the engine-name localisers of `src/lib/pkmn/i18n`.
- **Planned (not built)**: a `v3/broadcast/` directory under `src/components/teambuilder/` — the single `BroadcastTeam` component with four variants. `src/components/AGENTS.md` records this as a not-yet-migrated state; do not code against it.

### API Routes

- `GET /api/broadcast/preview/[mid]` — public overlay read; returns the match preview with both teams as `EnrichedPokemonState[]`.
- Solo session data is polled through `useSoloBroadcastPoll`, not a dedicated team route.

### Testing

- `src/components/broadcast/overlays/__tests__/`, `shared/__tests__/` and `tracker/__tests__/` cover the overlays' i18n, the draft overlays, and the tracker session; see [Broadcast](./broadcast.md) for the wider module's tests.

### Related Modules

- [Broadcast](./broadcast.md) — overlay config, the tracker reducer, the recap engine and the `(broadcast)` route group.
- [Teambuilder Editor](./teambuilder-editor.md) — the v3 editor; `TeamCardPrimitive` is the shared card a future `v3/broadcast/` family would build on.
