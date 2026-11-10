# Team Module

## Overview
The Team module enforces visibility/redaction rules for team Pokémon details based on viewer role and match progression.

## File Structure
```
src/lib/team/
├── visibility.ts  # Team visibility and redaction helpers
├── check.server.ts  # The one server-side team check (checkTeam)
├── editor-save-state.ts  # Teambuilder save machine (teambuilder.save): no overlapping saves
├── completed-match-lock.ts  # Teams linked to a completed match are immutable for non-admins
├── item-usage-cache.ts  # Expires the public cached reads built from a team roster
├── kit-team-gate.ts  # Advisory verdict of a kit league's team rules (adviseKitTeam, kitTeamVerdict); never refuses a team
├── match-round.ts  # The round a match-bound team is judged at (the match's round, never the phase's current one)
├── page-loaders.ts, page-text.ts  # Library entry as a page renders it and the sets a visitor sees
├── public-team.ts  # Public team shape: the only team fields that may leave the server
├── showdown-set.ts  # Showdown paste text (always English)
├── team-roster-state.ts  # State machine team.roster: the roster write locks and the write verdict (docs/state-machines.md)
├── team-share-state.ts  # State machines team.share and team.library: share link and library publication
└── stat-spread.ts  # Localized stat spread text
```

## Core Functions/Classes

### Visibility Engine
- **File**: `visibility.ts`
- **Purpose**: Evaluate whether full team data should be visible
- **Key Methods**: `canViewTeamPokemon()`, `filterTeamVisibility()`

### Kit league team rules (advisory)
- **File**: `kit-team-gate.ts` (the name is kept from the old hard gate)
- **Behaviour (chosen for this release)**: in a custom-format league on the kit engine the stage's team rules are **advisory plus audited**. `POST /api/teams`, `PATCH /api/teams/[id]` and `POST /api/match-prep` never refuse a team for them (the old 400 `team_check_failed` is gone); the success body carries the typed field `team_check`: absent when the league has no kit rules or the team meets them, `{ status: 'unmet', verdict }` with the full `TeamValidationResult` (the client words it from the issue codes, no English prose rides in the envelope), or `{ status: 'unavailable' }` when the verdict could not be computed (logged with the original error through `adviseKitTeam`, which never throws, and never reported as "meets the rules"). `POST /api/validate-team` is unchanged except for the optional `match_id` and a 240 per minute rate limit; the teambuilder shows the same issues live.
- **Round**: a match-bound team (`PATCH /api/teams/[id]` of a team linked to a match, `POST /api/match-prep`) is judged at its match's round; without a match the check uses the lowest of the latest generated round and the calendar round when the stage has a calendar.
- **Audit**: after every completed match the engine audits the played teams against the stage's constraints and opens a `team_audit` review check for an admin when a side broke them, differs from the replay or could not be audited ([Format Kit](./format-kit.md#format-engine-and-runtime), Team rules, for the key, the reasons and the limits).

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

**Closed tournaments and leagues.** In a completed or archived tournament, or a tournament whose league is completed or archived, `POST /api/teams` and `PATCH /api/teams/[id]` answer a player 403 and `DELETE /api/teams/[id]` does too, except that a player may still delete their OWN team that is linked to no match (`match_id` is empty). A team linked to a match stays, and a site admin's write is a correction that the gate never asks about. The code names the real reason (`teamWritesClosed`, `team-writes-closed-response.ts`): `team_submission_closed` (the tournament is completed), `team_submission_tournament_archived`, or `team_submission_league_closed` (the league is completed or archived); the texts are in the `errors/teams` catalog, EN and DE.

## Usage Examples

```typescript
import { filterTeamVisibility } from '@/lib/team/visibility';

const visibleTeams = await filterTeamVisibility(teams, ctx);
```

## Testing
- **Test Files**: `src/lib/team/__tests__/` (12 test files): `check.test.ts` and `parity.test.ts` (the one team check), `kit-team-gate.test.ts` (the advisory verdict), `match-round.test.ts`, `completed-match-lock.test.ts`, `page-loaders.test.ts`, `public-team.test.ts`, `showdown-set.test.ts`, `stat-spread.test.ts`, `visibility.test.ts`, `team-roster-state.test.ts` (the roster machine, its read-minimal verdict and the SQL parity) and `team-share-state.test.ts`; `private-team-fields.ts` is the shared leak assertion
- **Testing Approach**: Unit tests of every helper; the team API routes and pages run the leak assertion on their payloads.

## Related Modules
- [Auth Module](./auth.md)
- [Supabase Module](./supabase.md)
