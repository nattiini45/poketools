# Validation Module

> Centralized Zod request-body schemas and derived TypeScript input types for PokéTools API routes.

## Overview
The Validation module is the repository's Zod-based input-validation layer. `schemas.ts` defines every request-body/query schema, `index.ts` is the public barrel that re-exports them under one import path (`@/lib/validation`). Schemas are derived from the domain types in `src/types/` and the database enums in `src/types/database.ts`.

> **Not to be confused with** `src/lib/pkmn/validation.ts`, which validates Pokémon *set* legality and team constraints (e.g. `validateDraftOwnership()`, `TeamValidationContext`). That module checks gameplay rules; this module validates API payloads.

## File Structure
```
src/lib/validation/
├── index.ts    # Public barrel: re-exports schemas, inferred types, formatZodErrors
└── schemas.ts  # All Zod schemas, FIELD_LIMITS, uuid helper, types (the largest file of the module)
```

## Core Functions/Classes

### `schemas.ts` — the schema source
- **`FIELD_LIMITS`** — canonical length buckets reused across schemas (`NAME: 100`, `TITLE: 200`, `DESCRIPTION: 500`, `MEDIUM_TEXT: 2000`, `LONG_TEXT: 5000`, `URL: 2000`, `LABEL: 50`) so magic literals don't drift from DB column sizes.
- **`uuid`** — private `z.string().uuid()` helper reused by every entity schema.
- **Database enums** — Zod enums mirroring `Constants.public.Enums`, plus the two text columns with a CHECK that the same block holds. Every exported schema of the `Database Enums` block of `schemas.ts` has a row here (`scripts/__tests__/public-docs.test.mjs` fails when one is missing):

| Schema | Column | Accepted values | Migration |
|--------|--------|-----------------|-----------|
| `bracketTypeSchema` | `tournaments.bracket_type` (enum) | `single_elim`, `double_elim`, `round_robin`, `swiss` | `20260608100000_baseline_professional_schema.sql` |
| `tournamentStatusSchema` | `tournaments.status` (enum) | `upcoming`, `active`, `completed` | `20260608100000_baseline_professional_schema.sql` |
| `matchStatusSchema` | `matches.status` (enum) | `scheduled`, `in_progress`, `pending_confirmation`, `completed`, `disputed` | `20260608100000_baseline_professional_schema.sql` |
| `roundStatusSchema` | `rounds.status` (enum) | `pending`, `active`, `completed` | `20260608100000_baseline_professional_schema.sql` |
| `seasonFormatTypeSchema` | `seasons.format_type` (enum) | `singles`, `doubles`, `draft`, `evolution_point_buy`, `custom` | `20260608100000_baseline_professional_schema.sql`; `20260727000000_evolution_point_buy.sql` and `20261024100000_season_format_type_custom.sql` added the last two values |
| `seasonStatusSchema` | `seasons.status` (enum) | `upcoming`, `active`, `completed` | `20260608100000_baseline_professional_schema.sql` |
| `routeThemeSchema` | `seasons.route_theme` (text with a CHECK, not a DB enum) | `auto`, `plaza`, `sakura`, `mountain`, `clouds` | `20260917000000_seasons_route_theme.sql` |
| `teamVisibilitySchema` | `tournaments.team_visibility` (enum) | `hidden_until_match`, `always_public` | `20260608100000_baseline_professional_schema.sql` |
| `gameSourceSchema` | `games.source` (enum) | `ps_replay`, `manual`, `champions` | `20260608100000_baseline_professional_schema.sql` |
| `aggregateScopeSchema` | `aggregates.scope_type`, `player_aggregates.scope_type` (enum) | `tournament`, `league`, `all_time` | `20260608100000_baseline_professional_schema.sql` |
| `draftPoolStatusSchema` | `draft_pools.status` (enum) | `pending`, `in_progress`, `complete` | `20260608100000_baseline_professional_schema.sql` |
| `draftTypeSchema` | `draft_pools.draft_type` (enum) | `snake`, `auction`, `budget` | `20260608100000_baseline_professional_schema.sql` |
| `draftPickOrderSchema` | `draft_pools.pick_order` (text with a CHECK) | `snake`, `linear`, `free` | `20261013124630_draft_pools_pick_order.sql` |
| `teamImportSourceSchema` | `teams.import_source`, `match_prep_teams.import_source` (enum) | `pokepastes`, `manual`, `ps_text` | `20260608100000_baseline_professional_schema.sql` |

- **`battleStatPokemonKey(name)`** — an index entry, not a schema: the key (`name.trim().toLowerCase()`) the request schemas compare Pokémon names by within one game and player. It must equal the unique index `battle_stats_game_player_pokemon_key` (rebuilt by `supabase/migrations/20261021100200_battle_stats_pokemon_key_js_trim.sql`). The contract has one owner: [`match.md`](./match.md) (the battle-stats key rule).
- **Domain enums** — `contentLanguageSchema` (the `LOCALES`, a league's content language) and `webhookLanguageSchema` (`league` or one of the `LOCALES`), `achievementCategorySchema`, `achievementTierSchema`, `wikiEntityTypeSchema`, `wikiScopeTypeSchema`, `webhookScopeTypeSchema`, `socialProviderSchema`, `adminResourceTypeSchema`, `confirmActionSchema`, `poolModeSchema`, `teamSizeModeSchema`, `discordEventTypeSchema`, `pokemonTypeSchema` (18 standard types), `routeThemeSchema` (`auto` + the registered 3D world themes; `seasons.route_theme` is a text column with a CHECK, not a DB enum, though the schema sits in the database-enum block; used by `seasonCreateSchema` / `seasonUpdateSchema`). Defined next to their entity schemas: `adminPlayerImportModeSchema`, `wikiReportStatusSchema`, `agentPersonaSchema`, `agentAnalysisTypeSchema`, `agentReportTypeSchema`.
- **Field/format validators** — `discordWebhookUrlSchema` (regex), `discordIdSchema`, `emailSchema`, `passwordSchema` (min 8 / max 72).
- **Auth schemas** — `signupSchema`, `resendVerificationSchema`, `forgotPasswordSchema`, `confirmEmailSchema`, `resetPasswordSchema`, `linkEmailSchema`.
- **Entity schemas** — request bodies for players, tournaments, seasons, matches/replays, rulesets, achievements, webhooks, wiki, draft pools, teams, avatars, cast sessions, AI/agent analysis, broadcasts, storylines, team library/share/fork, and more (e.g. `tournamentCreateSchema`, `parseReplaySchema`, `validateTeamSchema`, `paginationQuerySchema`).
- **Evolution point-buy / redraft schemas** — `pointBuyListCreateSchema`, `pointBuyListEntrySchema`, `formatRulesSchema`, `teamRoleImportSchema`, `pointBuyXlsxImportOptionsSchema`. These are exported from `schemas.ts` directly and are **not** part of the `index.ts` barrel.
- **`bestOfSchema`** — an odd integer from 1 to 15 (`z.number().int().min(1).max(15)` refined to odd; an even value fails with `best of must be an odd number`). Used for `best_of_default` (`tournamentCreateSchema` with `.default(1)`, `tournamentUpdateSchema`; `phaseCreateSchema` inherits it), the values of `bo_overrides` in those, `roundUpdateSchema.best_of` and `manualRoundSchema.best_of`. `phaseUpdateSchema` takes any integer from 1 to 15 for both fields, because the phase form sends the stored values back; the phase `PATCH` route then refuses an even value the phase does not already hold (`newEvenBestOfIssues`, `src/lib/tournament/best-of.ts`). The pickers share the list in `src/lib/tournament/best-of.ts`. Season date order is deliberately not a schema refine: Zod 4 refuses `.extend()` on a refined object and the season PATCH route extends `seasonUpdateSchema`, so the order is checked in the routes.
- **Inferred types** — `export type XInput = z.infer<typeof xSchema>` for every schema, so routes get typed payloads without duplication.

### `formatZodErrors(error: z.ZodError): string`
Flattens Zod issues into a single `"path: message; …"` string (using `root` for top-level issues). Intended for `400` error responses.

### `index.ts` — public barrel
Re-exports the curated set of schemas, all inferred `*Input` types, and `formatZodErrors`. Import path: `@/lib/validation`.

## Data Flows
- **Input**: Parsed JSON request body / query params in an API route.
- **Processing**:
  1. Route calls `<schema>.safeParse(body)`.
  2. On failure, return `400` with `formatZodErrors(result.error)` (or `result.error.flatten()`).
  3. On success, use `result.data` as a fully-typed, trimmed/normalized payload.
- **Output**: Validated, typed data; or a flat, human-readable validation error string.

## Dependencies
- **External Libraries**: `zod`
- **Internal Modules**:
  - [Security Patterns](./security-patterns.md) — defines the manual whitelist-enum/type-guard validation pattern for routes that do *not* use these schemas; this module is the noted exception ("Zod is used in `src/lib/validation/schemas.ts`").
  - [PKMN](./pkmn.md) — game-logic set/team validation lives in `src/lib/pkmn/validation.ts`, not here.

## Usage Example

```typescript
import { parseReplaySchema, formatZodErrors } from '@/lib/validation';

const result = parseReplaySchema.safeParse(body);
if (!result.success) {
  return NextResponse.json(
    { success: false, error: formatZodErrors(result.error) },
    { status: 400 },
  );
}
const data = result.data; // typed ParseReplayInput
```

## Testing
- **Test Files**: the 13 files of `src/lib/validation/__tests__/`: `battle-stats-pokemon-key.test.ts` (the key and the duplicate refusal), `best-of-schema.test.ts`, `discord-webhook-url.test.ts`, `format-rules-schema.test.ts`, `manual-result-moments.test.ts`, `manual-result-stats.test.ts`, `match-admin-schemas.test.ts`, `round-update-schema.test.ts`, `schemas-draft-points.test.ts`, `schemas-language.test.ts`, `schemas-season-format.test.ts`, `season-clone-schema.test.ts` and `team-schema.test.ts`. Route tests of the API routes exercise the schemas they use.
- **Testing Approach**: Schema-level unit tests (accepted and refused payloads, error messages, normalised output). `scripts/__tests__/public-docs.test.mjs` checks the catalogue above against `schemas.ts`.

## Related Modules
- [Security Patterns](./security-patterns.md) — input-validation rules and the `safeErrorResponse()` error-handling pattern.
- [PKMN](./pkmn.md) — Pokémon set/team constraint validation (`pkmn/validation.ts`).
- [API error handling — see security-patterns](./security-patterns.md)
