# Gamification Module

## Overview
The Gamification module manages achievement unlocking, streak progression, and signature Pokémon updates.

## File Structure
```
src/lib/gamification/
├── achievements.ts  # Criteria evaluation + unlock persistence
├── signatures.ts  # Signature slot recomputation
└── streaks.ts  # Streak updates and recomputation
```

## Core Functions/Classes

### Achievement Engine
- **File**: `achievements.ts`
- **Purpose**: Evaluate criteria and unlock achievements
- **Key Methods**: `checkAchievements()`

### Streak Engine
- **File**: `streaks.ts`
- **Purpose**: Update and recompute player streak records
- **Key Methods**: `updateStreaks()`, `recomputeStreaks()`

### Signature Engine
- **File**: `signatures.ts`
- **Purpose**: Recompute signature slots from aggregate stats
- **Key Methods**: `updateSignatures()`

## Data Flows
- **Input**: Completed match context + battle stats + rating/aggregate state
- **Processing**:
  1. Update rating/streak/signature baselines
  2. Build achievement criteria context
  3. Unlock eligible achievements
- **Output**: Updated gamification state and unlock payloads

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Match Module](./match.md)
  - [Rating Module](./rating.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/achievements`
- `/api/achievements/[playerId]`
- `/api/streaks/[playerId]`
- `/api/streaks/leaderboard`
- `/api/signatures/[playerId]`
- `/api/admin/achievements`
- `/api/admin/achievements/[id]`
- `/api/admin/backfill-gamification`

## Usage Examples

```typescript
import { updateStreaks } from '@/lib/gamification/streaks';

await updateStreaks(playerId, result, stats, matchId);
```

## Testing
- **Test Files**: No dedicated `src/lib/gamification/__tests__` files currently
- **Testing Approach**: Route-level and match-completion integration testing

## Related Modules
- [Match Module](./match.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)
