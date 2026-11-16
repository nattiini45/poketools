---
status: accepted
date: 2026-11-16
---

# League phases get their own data model, separate from tournaments

A league phase is stored as a `tournaments` row with `season_id` set, so the same row means two different things: phase results reach league-wide tables that only ever meant tournaments, and players read a phase as a tournament because that is what the schema, the routes and the types call it. We decided a phase becomes its own concept with its own data model, and a tournament row keeps meaning a tournament; the shape of that model — keys, scoping, and how existing rows migrate — is decided in a separate scoping pass, not here.

## Considered options

- Keep one table and filter by `season_id IS NULL` wherever a query means tournaments. Rejected: every existing query would have to remember the filter, and one that forgets it silently returns phases, which is the leak we are removing.
- Add a discriminator column and keep the shared table. Rejected for the same reason one level down: two meanings in one row, a `WHERE` clause away from leaking again.

## Consequences

- Until the scoping pass lands, phases keep living in `tournaments` rows. This ADR fixes the direction, not the schema, and a new league-facing query must treat `season_id` as part of what it means.
- The league admin's phase routes (`/api/seasons/[id]/phases`) and the tournament routes stay separate entry points, since they already create different things.