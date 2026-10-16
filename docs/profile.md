# Profile Module

## Overview
The Profile module composes full player profile views by aggregating player, match, rating, streak, signature, and achievement data.

## File Structure
```
src/lib/profile/
└── compose.ts  # Player profile composition logic
```

## Core Functions/Classes

### Profile Composer
- **File**: `compose.ts`
- **Purpose**: Build complete player profile payloads
- **Key Methods**: `composePlayerProfile()`

## Data Flows
- **Input**: Player ID
- **Processing**:
  1. Fetch player baseline and participation records
  2. Fetch rating/streak/signature/achievement slices
  3. Compute standings-derived profile sections
- **Output**: `PlayerProfile` aggregate object

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Supabase Module](./supabase.md)
  - [Tournament Module](./tournament.md)
  - [Gamification Module](./gamification.md)
  - [Rating Module](./rating.md)

## API Routes
- `/api/players/[id]/profile`

## Usage Examples

```typescript
import { composePlayerProfile } from '@/lib/profile/compose';

const profile = await composePlayerProfile(playerId);
```

## Testing
- **Test Files**: No dedicated `src/lib/profile/__tests__` file currently
- **Testing Approach**: API/profile page integration verification

## Related Modules
- [Gamification Module](./gamification.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)
