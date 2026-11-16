---
status: accepted
date: 2026-11-16
---

# League phases get their own data model, separate from tournaments

A league phase is stored as a `tournaments` row with `season_id` set, so the same row means two different things: phase results reach league-wide tables that only ever meant tournaments, and players read a phase as a tournament because that is what the schema, the routes and the types call it. We decided on full separation: a phase becomes its own concept with its own data model, and everything a phase owns moves with it — its rounds, matches, participants, groups and brackets go to phase-owned tables instead of hanging off a tournament row, and tournament tables keep meaning tournaments only. Phase pages move under their league, `/leagues/<id>/phases/<phase>`, and the old `/tournaments/<id>` links redirect to them. The shape of the new tables — keys, scoping and the migration of existing rows — is decided in a separate scoping pass.

## Considered options

- Keep one table and filter by `season_id IS NULL` wherever a query means tournaments. Rejected: every existing query would have to remember the filter, and one that forgets it silently returns phases, which is the leak we are removing.
- Add a discriminator column and keep the shared table. Rejected for the same reason one level down: two meanings in one row, a `WHERE` clause away from leaking again.
- Shallow separation: move the phase row and leave its rounds, matches, participants, groups and brackets on the tournament side. Rejected: those rows carry the same two meanings, so the leak survives in every table that joins them.
- Leave phase pages at `/tournaments/<id>`. Rejected: a URL is part of what a thing is called, and the old address would keep teaching players that a phase is a tournament.

## Consequences

- A phase's rounds, matches, participants, groups and brackets are read through phase-owned tables; no league-wide query has to exclude phases.
- The old `/tournaments/<id>` addresses for phases stay reachable as redirects, so shared links and bookmarks keep working.
- Until the scoping pass lands, phases keep living in `tournaments` rows. This ADR fixes the direction and the boundary, not the schema.