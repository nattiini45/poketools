# Profile Module

## Overview
The Profile module composes full player profile views by aggregating player, match, rating, streak, signature, and achievement data.

## File Structure
```
src/lib/profile/
├── compose.ts  # Player profile composition logic
└── redact.ts  # The player row a visitor may see: the PublicPlayer profile card
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
  4. The headline's total KOs and unique-Pokémon count are summed from the player's all-time `player_aggregates` rows (one row per Pokémon, read complete under `max_rows` by `getAllTimePlayerAggregates`), so they exclude test-league and test-account games (`games.exclude_all_time`) like every other all-time stat. Best-Pokémon-per-tournament and kill rankings still read `getPlayerBattleStats` (capped at 500 rows).
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
- **Test Files**: `src/lib/profile/__tests__/compose.test.ts` and `redact.test.ts` (the profile card allowlist)
- **Testing Approach**: Unit tests of the composition and redaction; the profile pages and API routes have route and page tests next to them.

## Related Modules
- [Gamification Module](./gamification.md)
- [Rating Module](./rating.md)
- [Supabase Module](./supabase.md)
