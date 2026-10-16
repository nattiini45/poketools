# Rating Module

## Overview
The Rating module implements Glicko-2 updates and rating rollback logic for match-result workflows, plus a presentation-layer tier classifier that maps numeric ratings to the Pokéball badge tiers shown across the app (`RatingBadge`, `OverlayRatingBadge`).

## File Structure
```
src/lib/rating/
├── glicko2.ts          # Core Glicko-2 formulas
├── glicko2-preview.ts  # Read-only preview of next-game rating deltas
├── tiers.ts            # Pokéball tier classifier + tier metadata
├── updateRatings.ts    # Match-driven rating updates + rollback
└── __tests__/
    ├── glicko2.test.ts
    ├── glicko2-preview.test.ts
    ├── tiers.test.ts
    └── updateRatings.test.ts
```

## Core Functions/Classes

### Glicko-2 Core
- **File**: `glicko2.ts`
- **Purpose**: Deterministic Glicko-2 math helpers
- **Key Methods**: `glicko2Update()`, `expectedScore()`, `inflateRD()`

### Rating Updater
- **File**: `updateRatings.ts`
- **Purpose**: Apply and rollback persisted rating changes
- **Key Methods**: `updateRatings()`, `rollbackRatingsForMatch()`

### Rating Tier Classifier
- **File**: `tiers.ts`
- **Purpose**: Map a Glicko-2 (rating, rd) pair to one of four Pokéball tiers and look up the matching badge metadata (Tailwind classes, overlay hex, Showdown item id).
- **Key Exports**: `getRatingTier(rating, rd)`, `RATING_TIER_META`, `RatingTier`
- **Rules**: see Spec §11.5. Summary: Poké `< 1400` or `rd > 100` (provisional); Great `1400–1599`; Ultra `1600–1899` (or `rating ≥ 1900` with `rd > 50`); Master `rating ≥ 1900` AND `rd ≤ 50`. `rd === 0 | null | undefined` is the "RD unknown" sentinel — provisional and Master gates are both skipped (caps at Ultra).

## Data Flows
- **Input**: Winner/loser IDs + match ID (for `updateRatings`); `(rating, rd)` pair (for `getRatingTier`)
- **Processing**:
  1. Load current rating rows
  2. Apply RD inflation and Glicko-2 updates
  3. Persist rating + history records
  4. UI surfaces classify each rating into a Pokéball tier via `getRatingTier` and render via `RatingBadge` / `OverlayRatingBadge`
- **Output**: Updated ratings and deltas; tier badge UI

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Supabase Module](./supabase.md)
  - [Match Module](./match.md)
  - [PKMN Module](./pkmn.md) — `src/lib/pkmn/ball-sprites.ts` is consumed by the `PokeballIcon` used in the tier badges

## API Routes
- `/api/ratings`
- `/api/ratings/[playerId]`
- `/api/ratings/[playerId]/history`

## Usage Examples

```typescript
import { updateRatings } from '@/lib/rating/updateRatings';
import { getRatingTier, RATING_TIER_META } from '@/lib/rating/tiers';

const result = await updateRatings(winnerId, loserId, false, matchId);

const tier = getRatingTier(player.rating, player.rd);
const meta = RATING_TIER_META[tier]; // { label, ballItemId, bg, text, border, overlayColor }
```

## Testing
- **Test Files**:
  - `src/lib/rating/__tests__/glicko2.test.ts` — pure Glicko-2 math (`glicko2Update`, `expectedScore`, `inflateRD`)
  - `src/lib/rating/__tests__/glicko2-preview.test.ts` — preview / next-game deltas
  - `src/lib/rating/__tests__/tiers.test.ts` — threshold bands, provisional rule, Master Ball gate, RD-unknown sentinel
  - `src/lib/rating/__tests__/updateRatings.test.ts` — persistence and rollback paths
- **Testing Approach**: Pure unit tests for math + classifier; integration testing through match confirmation/reset paths for persistence.

## Related Modules
- [Match Module](./match.md)
- [Supabase Module](./supabase.md)
- [Gamification Module](./gamification.md) — `RatingBadge` lives under `src/components/gamification/`
- [PKMN Module](./pkmn.md)
