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
├── phase-public-team.ts  # Public native phase team projection
├── shared-team.ts  # Resolves a share token in the active store (resolveSharedTeam)
├── library-listing.ts  # Library page merged from both stores (listLibraryPage)
├── phase-services.ts  # Dormant native phase team operations
├── phase-visibility.ts  # Native phase team visibility and redaction
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
- `/api/players/[id]/team-comparison` — live registered viewer, shared league membership, species-only comparison; see spec §7. The shared UI is `src/components/team-comparison/TeamComparison.tsx`, with UI SDK dialog and league selector.

The comparison reads EPB trackers or non-voided draft picks through league-tagged 30-second caches. Shared memberships use the seasons tag. Registered team reads stay live and viewer-scoped: only the newest league/stage row is considered, and its visibility is checked before parsing its sets. Ordinary cold EPB loads cost four reads including the live player guard (one membership read and two roster reads); an undrafted registered league costs at most eight (two pick reads, two stage reads and two newest-team reads). History reads page with a hard bound rather than silently truncate. Opening a draft or player page adds no comparison reads; the dialog loads on demand, aborts stale requests, and refreshes when reopened.

**Closed tournaments and leagues.** In a completed or archived tournament, or a tournament whose league is completed or archived, `POST /api/teams` and `PATCH /api/teams/[id]` answer a player 403 and `DELETE /api/teams/[id]` does too, except that a player may still delete their OWN team that is linked to no match (`match_id` is empty). A team linked to a match stays, and a site admin's write is a correction that the gate never asks about. The code names the real reason (`teamWritesClosed`, `team-writes-closed-response.ts`): `team_submission_closed` (the tournament is completed), `team_submission_tournament_archived`, or `team_submission_league_closed` (the league is completed or archived); the texts are in the `errors/teams` catalog, EN and DE.

## Usage Examples

```typescript
import { filterTeamVisibility } from '@/lib/team/visibility';

const visibleTeams = await filterTeamVisibility(teams, ctx);
```

## Testing
- **Test Files**: `src/lib/team/__tests__/` (17 test files): `check.test.ts` and `parity.test.ts` (the one team check), `kit-team-gate.test.ts` (the advisory verdict), `match-round.test.ts`, `completed-match-lock.test.ts`, `page-loaders.test.ts`, `public-team.test.ts`, `showdown-set.test.ts`, `stat-spread.test.ts`, `visibility.test.ts`, `team-roster-state.test.ts` (the roster machine, its read-minimal verdict and the SQL parity) and `team-share-state.test.ts`; `private-team-fields.ts` is the shared leak assertion Native coverage: `phase-services.test.ts`, `phase-visibility.test.ts`, `page-loaders-native.test.ts` (loaders dispatching to the phase store), `library-listing.test.ts` (the merged library page) and the opt-in disposable-stack `phase-teams.local.test.ts`.
- **Testing Approach**: Unit tests of every helper; the team API routes and pages run the leak assertion on their payloads.

## Dormant native phase teams

`src/types/phase-team.ts` and `src/lib/supabase/queries/phase-teams.ts` own native `phase_teams` and `phase_match_prep_teams` storage. A phase team always has a non-null `phase_id`; it has no `tournament_id`. `createPhaseTeamServices()` in `src/lib/team/phase-services.ts` is an explicitly constructed server-side capability, not a default dispatcher. Existing routes and legacy reads are unchanged. Callers supply an actor obtained from the live auth guards and validate the request and the competition's team rules before calling it. Reads return full server-side rosters; public callers apply `phase-visibility.ts` and `phase-public-team.ts` before returning them.

Roster writes use `phase_team_roster_write`, locking the league and phase before checking closure, linked-match completion and the manual lock. The service reuses the existing pure roster machine; SQL rechecks mutable facts in the transaction. Creation requires native enrollment for non-admins, refuses a duplicate planned team, and refuses a completed phase even for site admins. Owners cannot edit closed phase/league teams, but may delete an unplayed planned row. Match participants may still save prep for an uncompleted match in a closed phase/league. A site admin can correct completed-match rosters and delete locked teams, but cannot edit a manually locked roster. A locked registered roster is skipped during match prep while the prep form is saved. Prep and registered-roster synchronization otherwise commit together. All native writes remain behind the existing phase-storage activation fence, including no-op release requests.

Share links and library publication preserve the existing owner/admin authorization and compare-and-set guards. These metadata writes do not change a roster and remain available when its roster is locked. The explicit native token resolver checks both stores, rejects ambiguous capabilities and returns a discriminated resource; it is not connected to existing share routes. Public phase payloads allowlist every field and omit share capabilities. Forking a phase team's published or token-authorized roster creates a personal `teams` row with `forked_from_phase_team_id`, never a phase enrollment or tournament submission. `listPhaseTeamsForPinImpact` uses native match joins and excludes manually locked and completed-match rosters, with the existing bounded `{ teams, truncated }` contract.

`phase_teams_release_matches(uuid[])` supplies the P3 release ports. The service's `clearTeamsMatchPointer(matchId)` returns the released count for child cleanup; `releaseTeams(matchId)` and `releaseTeamsFromMatches(matchIds)` return void for match-service effects. All call the same atomic query/RPC. It follows the legacy release decision, not a blanket move: clear the match pointer, retain the row as the phase's planned team if there is no other planned row, otherwise transfer it into personal/library `teams` storage. Multiple releases see earlier retained planned rows. A transfer preserves the UUID, Pokémon, owner, league/draft references, outgoing fork source, library metadata and share-token identity. Inbound forks in both stores are redirected to the transferred `teams` identity before the phase row is removed. Pointer release, transfers and fork repairs are one transaction, so a failure cannot strand duplicate planned rows. Later match cleanup/deletion remains a separate P3 operation and can still refuse after release succeeds.

Global share-token uniqueness uses transaction locks on both stores, their local unique constraints, and deferred cross-store checks. Only a same-ID transfer may temporarily hold a token in both stores, and commit requires the old copy to be gone. The migration classifies its INSERT triggers in the league-trash guard inventory. The opt-in `phase-teams.local.test.ts` suite covers both race orders (insert/update, commit/rollback and retry), deferred transfers, release rollback, library/share/fork preservation, closure/corrections, dormant fences and collision-safe trash restore. Run it only on the disposable CI database or an explicitly opted-in local stack; ordinary focused tests use mocks and make no database requests.

## Related Modules
- [Auth Module](./auth.md)
- [Supabase Module](./supabase.md)
