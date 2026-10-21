# Teambuilder Broadcast Module

### Overview

Unified broadcast overlay component family for team display in OBS overlays. Consolidates three previously separate components (`TeamComparison`, `SoloTeamPreview`, `OverlayTeamStrip`) into a single `BroadcastTeam` component with four variants. All variants consume the same `EnrichedPokemonState[]` data shape and use a shared `TeamCardBroadcastPrimitive` for per-Pokémon rendering.

### File Structure

- **Main Entry Point**: `src/components/teambuilder/v3/broadcast/BroadcastTeam.tsx`
- **Variants**: `src/components/teambuilder/v3/broadcast/variants/`

```
src/components/teambuilder/v3/broadcast/
├── BroadcastTeam.tsx                    Root component with variant router
├── TeamCardBroadcastPrimitive.tsx       Overlay-styled per-Pokémon card
└── variants/
    ├── ComparisonVariant.tsx            Side-by-side 6v6 (replaces TeamComparison)
    ├── StripVariant.tsx                 Horizontal sprite row (replaces OverlayTeamStrip)
    ├── TrackerVariant.tsx               Live KO/lead/MVP state (new)
    └── PreviewVariant.tsx               Solo streamer preview (replaces SoloTeamPreview)
```

### Core Functions/Classes

- **`BroadcastTeam`**: Single component, four variants via `variant` prop. Props: `variant`, `source` (`'match'` | `'solo'`), `matchId?`, `sessionId?`, `pokemon?`, `config?`.
- **`TeamCardBroadcastPrimitive`**: Overlay-styled per-Pokémon card. Two size modes: `compact` (sprite-only row) and `full` (sprite + name + ability + item + moves). Composes on top of the public `TeamCardPrimitive` with broadcast CSS variables applied.
- **`ComparisonVariant`**: Side-by-side 6v6 overlay. Fetches `/api/broadcast/preview/[mid]`. Animated reveal. Replaces `src/components/broadcast/overlays/TeamComparison.tsx`.
- **`StripVariant`**: Horizontal sprite row with aura glow (gold=MVP, green=alive, red=KO'd) and dim for benched. Replaces `src/components/broadcast/shared/OverlayTeamStrip.tsx`.
- **`TrackerVariant`**: Same as Strip but reads live `tracker_state` and re-renders on each broadcast tick with up-to-date KO/lead/MVP states.
- **`PreviewVariant`**: Solo streamer team preview. Uses `useSoloBroadcastPoll(sessionId)`. Replaces `src/components/broadcast/overlays/SoloTeamPreview.tsx`.

### Data Flows

**Match variant (comparison)**:
1. `BroadcastTeam` fetches `/api/broadcast/preview/[mid]` once.
2. Derives `player1_team` / `player2_team` from `EnrichedPokemonState[]`.
3. Renders `ComparisonVariant` with `TeamCardBroadcastPrimitive` for each card.

**Solo variant (preview)**:
1. `BroadcastTeam` calls `useSoloBroadcastPoll(sessionId)`.
2. Renders `PreviewVariant` with compact `TeamCardBroadcastPrimitive`.

**Tracker variant (strip)**:
1. Receives `tracker_state` from the live battle tracker.
2. Derives brought/alive/KO'd/MVP states per Pokémon.
3. Re-renders `StripVariant` on each broadcast tick.

### Dependencies

- **External**: `motion` (animations)
- **Internal**: `src/lib/match/aggregation.ts` (`EnrichedPokemonState`), `src/components/broadcast/shared/OverlayShell.tsx`, `src/hooks/useSoloBroadcastPoll.ts`, `TeamCardPrimitive` from `v3/display/`

### API Routes

- `GET /api/broadcast/preview/[mid]` — public, returns match preview data with `player1_team` / `player2_team` as `EnrichedPokemonState[]`.
- Solo data polled via `useSoloBroadcastPoll`.

### Testing

- **BroadcastTeam variants**: `src/components/teambuilder/v3/broadcast/__tests__/BroadcastTeam.test.tsx` — comparison renders side-by-side, strip renders horizontal row, tracker re-renders on `frame_index` change, preview uses `useSoloBroadcastPoll`.

### Related Modules

- Teambuilder Editor Module - `TeamCardPrimitive` is the shared base
- Broadcast Module (`src/lib/broadcast/`) - tracker reducer, overlay config, recap engine
- Match Module - `MatchHighlightCard` also uses `TeamCardPrimitive`

### Notes

- The three replaced components (`TeamComparison.tsx`, `SoloTeamPreview.tsx`, `OverlayTeamStrip.tsx`) were deleted. A re-export `BroadcastTeamStrip` is provided for call sites that imported `OverlayTeamStrip` directly — allows a one-line import path swap.
- Broadcast CSS variables (color, typography) are injected by `OverlayShell.tsx` and inherited by `TeamCardBroadcastPrimitive` via `data-broadcast-skin`.
