# Team Module

## Overview
The Team module enforces visibility/redaction rules for team Pokémon details based on viewer role and match progression.

## File Structure
```
src/lib/team/
├── visibility.ts  # Team visibility and redaction helpers
├── check.server.ts  # The one server-side team check (checkTeam)
├── completed-match-lock.ts  # Teams linked to a completed match are immutable for non-admins
├── item-usage-cache.ts  # Expires the public cached reads built from a team roster
├── page-loaders.ts, page-text.ts  # Library entry as a page renders it and the sets a visitor sees
├── public-team.ts  # Public team shape: the only team fields that may leave the server
├── showdown-set.ts  # Showdown paste text (always English)
└── stat-spread.ts  # Localized stat spread text
```

## Core Functions/Classes

### Visibility Engine
- **File**: `visibility.ts`
- **Purpose**: Evaluate whether full team data should be visible
- **Key Methods**: `canViewTeamPokemon()`, `filterTeamVisibility()`

## Data Flows
- **Input**: Team rows + viewer context
- **Processing**:
  1. Check owner/admin overrides
  2. Check scope-aware completed-match visibility conditions
  3. Redact hidden teams to placeholder Pokémon slots
- **Output**: Visible or redacted team payloads

## Dependencies
- **External Libraries**: None
- **Internal Modules**:
  - [Auth Module](./auth.md)
  - [Supabase Module](./supabase.md)

## API Routes
- `/api/teams`
- `/api/teams/[id]`

## Usage Examples

```typescript
import { filterTeamVisibility } from '@/lib/team/visibility';

const visibleTeams = await filterTeamVisibility(teams, ctx);
```

## Testing
- **Test Files**: `src/lib/team/__tests__/` (8 test files): `check.test.ts` and `parity.test.ts` (the one team check), `completed-match-lock.test.ts`, `page-loaders.test.ts`, `public-team.test.ts`, `showdown-set.test.ts`, `stat-spread.test.ts` and `visibility.test.ts`; `private-team-fields.ts` is the shared leak assertion
- **Testing Approach**: Unit tests of every helper; the team API routes and pages run the leak assertion on their payloads.

## Related Modules
- [Auth Module](./auth.md)
- [Supabase Module](./supabase.md)
