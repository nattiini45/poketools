# Broadcast Module

## Overview
The Broadcast module powers live overlay state, draft replay playback, and weekly recap composition.

## File Structure
```
src/lib/broadcast/
├── animations.ts  # Overlay animation presets
├── draft-replay.ts  # Draft replay state/reducer helpers
├── overlay-config.ts  # Overlay configuration helpers
├── polling.ts  # Polling utilities
├── recap-engine.ts  # Weekly recap composition
└── tracker-reducer.ts  # Live battle tracker state transitions
```

## Core Functions/Classes

### Battle Tracker
- **File**: `tracker-reducer.ts`
- **Purpose**: Build/update live tracker state
- **Key Methods**: `createInitialState()`, `trackerReducer()`, `buildGamePayload()`

### Draft Replay Engine
- **File**: `draft-replay.ts`
- **Purpose**: Replay pick timelines deterministically
- **Key Methods**: `createReplayState()`, `advanceToIndex()`, `stepForward()`, `stepBackward()`, `jumpToRound()`

### Recap Engine
- **File**: `recap-engine.ts`
- **Purpose**: Build weekly recap payloads for overlays
- **Key Methods**: `composeWeeklyRecap()`

## Data Flows
- **Input**: Match stats, moments, draft replay events
- **Processing**:
  1. Reduce live events into overlay state
  2. Reconstruct draft replay state per sequence index
  3. Compose recap summaries from completed matches/moments
- **Output**: Overlay-ready state and recap payloads

## Dependencies
- **External Libraries**: None required in `src/lib/broadcast/*`
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Draft Module](./draft.md)
  - [Supabase Module](./supabase.md)
  - [AI Module](./ai.md) - optional recap narrative generation

## API Routes
- `/api/broadcast/moments`
- `/api/broadcast/state/[mid]`
- `/api/broadcast/preview/[mid]`
- `/api/broadcast/recap/[sid]`
- `/api/broadcast/standings/[sid]`
- `/api/broadcast/presets` + `/api/broadcast/presets/[id]`

## Overlay Types (url-builder.ts)
- **Match**: preview, live, results, story, teams, h2h, moments
- **League**: standings, attract, recap, usage_chart
- **Draft**: live, pick, replay
- **Player**: spotlight
- **Wiki** (Phase 9): move, item, ability, pokemon, tera
- **Solo** (Phase 9): ko-stats

## Usage Examples

```typescript
import { createInitialState, trackerReducer } from '@/lib/broadcast/tracker-reducer';

const next = trackerReducer(createInitialState(match), action);
```

## Testing
- **Test Files**: No dedicated broadcast unit test file currently
- **Testing Approach**: Overlay integration + route validation

## Related Modules
- [Match Module](./match.md)
- [Draft Module](./draft.md)
- [Supabase Module](./supabase.md)
- [Cast Studio Module](./cast-studio.md) — extended tracker reducer, cast sessions
- [Wiki Module](./wiki.md) — wiki overlay types
