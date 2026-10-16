# Team Module

## Overview
The Team module enforces visibility/redaction rules for team Pokémon details based on viewer role and match progression.

## File Structure
```
src/lib/team/
└── visibility.ts  # Team visibility and redaction helpers
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
- **Test Files**: No dedicated `src/lib/team/__tests__` file currently
- **Testing Approach**: API route and page integration verification

## Related Modules
- [Auth Module](./auth.md)
- [Supabase Module](./supabase.md)
