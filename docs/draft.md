# Draft Module

## Overview
The Draft module handles draft pool lifecycle, pick validation/order, and evolution-league progression checks. Deleting a league freezes its running queue drafts and moves them to the league trash; a restore brings them back **paused** with every deadline shifted by the time spent in the trash ([Season, League recycle bin](./season.md#league-recycle-bin), [Draft Room](./draft-room.md)).

## File Structure
```
src/lib/draft/
├── engine.ts  # Draft order/state/validation helpers
└── evolution-engine.ts  # Evolution progression + evo-league helpers
```

## Core Functions/Classes

### Draft Engine
- **File**: `engine.ts`
- **Purpose**: Compute and validate draft state transitions
- **Key Methods**: `computeDraftState()`, `validatePick()`, `generateSnakeOrder()`, `isDraftComplete()`

### Evolution Engine
- **File**: `evolution-engine.ts`
- **Purpose**: Track and validate evolution-league state
- **Key Methods**: `checkEvolutions()`, `checkPlayerEvolutions()`, `validateEvoLeaguePick()`, `isEvoLeague()`

## Data Flows
- **Input**: Draft pool, existing picks, participant list, season evolution rules
- **Processing**:
  1. Compute current picker/order/rosters
  2. Validate pick legality (turn, duplicates, budget, tiers)
  3. Persist pick and emit downstream events
  4. Recompute evolution progression where applicable
- **Output**: Updated draft picks/state and optional evolution events

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [PKMN Module](./pkmn.md)
  - [Tournament Module](./tournament.md)
  - [Discord Module](./discord.md)
  - [Social Module](./social.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/drafts`
- `/api/drafts/[id]`
- `/api/drafts/[id]/picks`
- `/api/drafts/[id]/state`
- `/api/drafts/[id]/undo`
- `/api/drafts/[id]/replay-events`
- `/api/draft-pool-entries`
- `/api/draft-pool-entries/[id]`
- `/api/draft-pool-templates`
- `/api/draft-pool-templates/[id]`
- `/api/draft-tier-limits`
- `/api/evolutions`
- `/api/evolutions/[id]`
- `/api/evolutions/trackers`

## Usage Examples

```typescript
import { computeDraftState, validatePick } from '@/lib/draft/engine';

const state = computeDraftState(pool, picks, participantIds, rounds);
const error = validatePick(state, input, true);
```

## Testing
- **Test Files**: No dedicated `src/lib/draft/__tests__` files currently
- **Testing Approach**: API route and end-to-end draft flow testing

## Related Modules
- [PKMN Module](./pkmn.md)
- [Tournament Module](./tournament.md)
- [Supabase Module](./supabase.md)
